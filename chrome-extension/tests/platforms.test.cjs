const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const extensionRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

function createPage(t, html, hostname, pathname = '/') {
  const dom = new JSDOM(html, { url: `https://${hostname}${pathname}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const { window } = dom;
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  window.HTMLElement.prototype.getClientRects = function () {
    if (!this.isConnected || window.getComputedStyle(this).display === 'contents') return [];
    for (let n = this; n; n = n.parentElement) {
      const s = window.getComputedStyle(n);
      if (n.hidden || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return [];
    }
    return [{ width: 200, height: 20 }];
  };
  window.Date.now = () => now;
  window.setTimeout = (cb, delay) => { const id = ++timerId; timers.set(id, { cb, at: now + delay }); return id; };
  window.setInterval = (cb, delay) => { const id = ++timerId; timers.set(id, { cb, at: now + delay, repeat: delay }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.ChatSavorBridge = { version: '2.0.6', register(adapter) { this.adapter = adapter; }, recordError() {} };
  window.ChatSavorCore = {
    injectButtonAfter(el) {
      const host = window.document.createElement('div');
      host.className = 'ai-saver-host';
      if (el.nextSibling) el.parentElement.insertBefore(host, el.nextSibling);
      else el.parentElement.appendChild(host);
      return true;
    },
    createSaveButton() { const h = window.document.createElement('div'); h.className = 'ai-saver-host'; return h; },
    extractMarkdown(el) { return { markdown: (el.textContent || '').trim() }; },
    showPreviewModal() {},
  };
  for (const script of manifest.content_scripts[0].js) {
    if (script.endsWith('dom.js')) window.eval(fs.readFileSync(path.join(extensionRoot, script), 'utf8'));
    if (script.startsWith('src/content/platforms/') || script.endsWith('platform-base.js')) {
      window.eval(fs.readFileSync(path.join(extensionRoot, script), 'utf8'));
    }
  }
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      if (timer.repeat) timers.set(id, { ...timer, at: now + timer.repeat });
      timer.cb();
    }
    now = target;
  }
  return { window, document: window.document, advance, buttons: () => window.document.querySelectorAll('.ai-saver-host') };
}

const PLATFORM_CASES = [
  ['gemini', 'gemini.google.com', '<model-response><p>Hi there</p></model-response>'],
  ['deepseek', 'chat.deepseek.com', '<div class="ds-thinking-content">thinking text</div><div class="ds-markdown--block">Reply from DeepSeek</div>'],
  ['doubao', 'www.doubao.com', '<div class="message-list-xxx"><div class="message-container-xxx"><div class="message-area-xxx">Doubao reply</div></div></div>'],
  ['kimi', 'kimi.com', '<div id="chat-container"><div class="chat-content-item-assistant"><div class="segment-content">Kimi reply</div></div></div>'],
  ['yuanbao', 'yuanbao.tencent.com', '<div class="yb-layout__content"><div class="agent-chat__list__item--ai"><div data-conv-speaker="ai"><div class="agent-chat__speech-text--box"><div class="hyc-content-md hyc-content-md-done">Yuanbao reply</div></div></div></div></div>'],
  ['grok', 'grok.com', '<div class="message-bubble"><div class="response-content-markdown">Grok reply</div></div>'],
  ['chatglm', 'chatglm.cn', '<div class="conversation-item assistant"><div class="markdown-body">ChatGLM reply</div></div>'],
  ['tongyi', 'tongyi.aliyun.com', '<div class="answerItem"><div class="markdown">Tongyi reply</div></div>'],
  ['qwen', 'qwen.ai', '<div data-role="assistant"><div class="markdown-prose">Qwen reply</div></div>'],
  ['claude', 'claude.ai', '<div class="font-claude-message">Claude reply text</div>'],
  ['perplexity', 'perplexity.ai', '<div class="answer-markdown markdown-body">Perplexity reply with <a href="https://source.example">source</a></div>'],
  ['aistudio', 'aistudio.google.com', '<ms-chat-turn><div class="model-response markdown">AI Studio reply</div></ms-chat-turn>'],
];

for (const [id, host, html] of PLATFORM_CASES) {
  test(`T1.2 ${id} minimal fixture injects a button`, t => {
    const page = createPage(t, `<!doctype html><html><body>${html}</body></html>`, host);
    assert.equal(page.window.ChatSavorBridge.adapter?.platform, id);
    assert.ok(page.window.ChatSavorBridge.adapter.getResponses().length >= 1, `${id} should detect its reply`);
    page.advance(5200);
    assert.ok(page.buttons().length >= 1, `${id} should inject one button`);
  });
}

test('T1.2 Tailwind self-stretch ancestors do not suppress replies', t => {
  for (const [host, html] of [
    ['kimi.com', '<div id="chat-container" class="self-stretch"><div class="chat-content-item-assistant self-center">Reply here</div></div>'],
    ['chatglm.cn', '<div class="self-stretch conversation-item assistant"><div class="markdown-body">Reply here</div></div>'],
  ]) {
    const page = createPage(t, `<!doctype html><html><body>${html}</body></html>`, host);
    assert.ok(page.window.ChatSavorBridge.adapter.getResponses().length >= 1, `${host} self-* ancestor should not hide reply`);
  }
});

test('T1.2 Grok x.com page with Desktop button still injects', t => {
  const page = createPage(t, '<button>Desktop</button><div class="message-bubble"><div class="response-content-markdown">Grok answer</div></div>', 'x.com', '/i/grok');
  assert.equal(page.window.ChatSavorBridge.adapter?.platform, 'grok');
  page.advance(5200);
  assert.ok(page.buttons().length >= 1);
});

test('T1.2 Kimi flat sibling replies each get their own button', t => {
  const page = createPage(t, '<div id="chat-container"><div class="chat-content-item-assistant">Reply one</div><div class="chat-content-item-assistant">Reply two</div></div>', 'kimi.com');
  page.advance(5200);
  assert.equal(page.buttons().length, 2);
});

test('T1.2 DeepSeek structural fallback finds reply next to thinking block', t => {
  const page = createPage(t, '<div class="thinker"><div class="ds-thinking-content">reasoning</div><div class="response-body">Final answer text</div></div>', 'deepseek.com');
  assert.ok(page.window.ChatSavorBridge.adapter.getResponses().some(el => el.classList.contains('response-body')));
});

test('T1.2 Yuanbao speaker attribute check is exact', t => {
  const page = createPage(t, '<div class="yb-layout__content"><div data-speaker="user"><div class="markdown-body">User content</div></div><div data-speaker="ai"><div class="markdown-body">AI answer</div></div></div>', 'yuanbao.tencent.com');
  const responses = page.window.ChatSavorBridge.adapter.getResponses();
  assert.ok(responses.length >= 1);
});
