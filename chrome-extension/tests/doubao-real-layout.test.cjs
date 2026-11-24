const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// Real Doubao Samantha/Flow layout fixture (per the implementation spec).
function userTurn(id, text) {
  return `<div class="w-full inner-item-xxx" data-message-list-item-id="block_${id}">
    <div class="w-full"><div class="flex flex-row w-full justify-end">
      <div class="flex flex-col flex-grow max-w-full min-w-0">
        <div class="flex-row flex w-full justify-end" data-message-id="${id}">
          <div class="flex max-w-full flex-col gap-8"><div class="flex justify-end" data-plugin-identifier="block_type:10000">
            <div class="bg-g-send-msg-bubble-bg text-g-send-msg-bubble-text">${text}</div>
          </div></div>
        </div>
        <div class="select-none" data-foundation-type="send-message-action-bar">
          <div class="message-action-bar-xxx flex flex-row w-full group">
            <span>星期日 12:30</span>
            <div class="bp5-overflow-list message-action-button-main"><button aria-label="复制">复制</button></div>
          </div>
        </div>
      </div>
    </div></div>
  </div>`;
}
function aiTurn(id, bodyHtml) {
  return `<div class="w-full inner-item-xxx" data-message-list-item-id="block_${id}">
    <div class="w-full"><div class="flex flex-row w-full group">
      <div class="flex flex-col flex-grow max-w-full min-w-0">
        <div class="relative flex-row flex w-full" data-message-id="${id}">
          <div class="flex w-full flex-col space-y-20"><div data-plugin-identifier="block_type:10000">
            <div class="container-xxx flow-markdown-body mdbox-theme-next">${bodyHtml}</div>
          </div></div>
        </div>
        <div class="flex-row flex max-w-full min-w-0 flex-grow select-none" data-foundation-type="receive-message-action-bar">
          <div class="flex flex-col justify-end h-40 w-full select-none opacity-0 pointer-events-none">
            <div class="message-action-bar-xxx flex flex-row w-full group">
              <div class="bp5-overflow-list message-action-button-main"><button aria-label="复制">复制</button></div>
              <span>星期日 12:30</span>
            </div>
          </div>
        </div>
      </div>
    </div></div>
  </div>`;
}
const AI_BODY = `<div class="paragraph-element">506M token = 5.06 亿个 token</div>
  <div class="table-wrapper"><div class="table-header"><span>表格</span><button>复制</button></div>
  <table><thead><tr><th>维度</th><th>换算结果</th></tr></thead><tbody><tr><td>中文汉字</td><td>约 5 亿</td></tr></tbody></table></div>`;

function page(t, innerHtml) {
  const dom = new JSDOM(`<!doctype html><html><head><title>豆包</title></head><body><main>${innerHtml}</main></body></html>`, {
    url: 'https://www.doubao.com/chat/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  let now = 1000, id = 0;
  const timers = new Map();
  window.Date.now = () => now;
  window.setTimeout = (cb, d) => { const i = ++id; timers.set(i, { cb, at: now + d }); return i; };
  window.setInterval = (cb, d) => { const i = ++id; timers.set(i, { cb, at: now + d, repeat: d }); return i; };
  window.clearTimeout = window.clearInterval = i => timers.delete(i);
  const previews = [];
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js') continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  window.ChatSavorCore.showPreviewModal = (md, opts) => previews.push({ md, opts });
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, timer] = next;
      now = timer.at; timers.delete(key);
      if (timer.repeat) timers.set(key, { ...timer, at: now + timer.repeat });
      timer.cb();
    }
    now = target;
  }
  return { window, document: window.document, previews, advance,
    adapter: () => window.ChatSavorAdapters.doubao };
}

test('D-01 button mounts only after the assistant body, never in the user action bar', t => {
  const p = page(t, userTurn(101, '506M token对应的量是多少') + aiTurn(102, AI_BODY) +
    '<div data-foundation-type="receive-message-suggest-foundation">你是不是想问：更多问题？</div>');
  const responses = p.adapter().getResponses();
  assert.equal(responses.length, 1, 'only the AI reply is a response');
  assert.equal(responses[0].getAttribute('data-message-id'), '102');
  p.advance(5200);
  assert.equal(p.document.querySelectorAll('.ai-saver-host').length, 1);
  const userBar = p.document.querySelector('[data-foundation-type="send-message-action-bar"]');
  assert.equal(userBar.querySelectorAll('.ai-saver-host').length, 0, 'no button inside user action bar');
  const btn = p.document.querySelector('.ai-saver-host');
  assert.equal(btn.previousElementSibling.getAttribute('data-message-id'), '102');
  assert.notEqual(btn.parentElement.getAttribute('data-foundation-type'), 'receive-message-action-bar');
});

test('D-01 extracted markdown keeps body + table but drops timestamp, suggest and 表格 header', t => {
  const p = page(t, userTurn(101, 'question') + aiTurn(102, AI_BODY) +
    '<div data-foundation-type="receive-message-suggest-foundation">你是不是想问：更多问题？</div>');
  const result = p.adapter().extractMarkdown(p.adapter().getResponses()[0]);
  assert.match(result.markdown, /506M token = 5\.06 亿个 token/);
  assert.match(result.markdown, /\| 维度 \| 换算结果 \|/);
  assert.doesNotMatch(result.markdown, /星期日 12:30/);
  assert.doesNotMatch(result.markdown, /更多问题/);
  assert.doesNotMatch(result.markdown, /^\s*表格\s*$/m);
});

test('D-01 EXPORT_ALL separates 2 rounds of user/assistant turns in order', t => {
  const p = page(t,
    userTurn(101, '第一个问题') + aiTurn(102, AI_BODY) +
    userTurn(103, '第二个问题') + aiTurn(104, '<div class="paragraph-element">第二个回答正文</div>'));
  const turns = p.adapter().getTurns();
  assert.equal(turns.length, 4);
  ['user', 'assistant', 'user', 'assistant'].forEach((role, i) => assert.equal(turns[i].role, role));
  p.window.ChatSavorBridge.register(p.adapter());
  p.window.ChatSavorBridge.handle('EXPORT_ALL');
  assert.equal(p.previews.length, 1);
  const md = p.previews[0].md;
  assert.equal((md.match(/👤 User/g) || []).length, 2);
  assert.equal((md.match(/🤖 Assistant/g) || []).length, 2);
  assert.ok(md.indexOf('第一个问题') < md.indexOf('第二个问题'));
  assert.ok(md.indexOf('506M token') < md.indexOf('第二个回答正文'));
  assert.doesNotMatch(md, /星期日 12:30/);
});
