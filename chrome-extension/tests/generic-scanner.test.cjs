const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const extensionRoot = path.resolve(__dirname, '..');

function createGenericPage(t, html, hostname = 'poe.com') {
  const dom = new JSDOM(html, { url: `https://${hostname}/chat`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const { window } = dom;
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  window.HTMLElement.prototype.getClientRects = function () {
    if (!this.isConnected || window.getComputedStyle(this).display === 'contents') return [];
    for (let n = this; n; n = n.parentElement) {
      const s = window.getComputedStyle(n);
      if (n.hidden || s.display === 'none' || s.visibility === 'hidden') return [];
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
    extractMarkdown(el) { return { markdown: (el.textContent || '').trim() }; },
    showPreviewModal() {},
  };
  const load = f => window.eval(fs.readFileSync(path.join(extensionRoot, f), 'utf8'));
  load('src/content/dom.js');
  load('src/content/platform-base.js');
  load('src/content/content.js');
  if (window.document.readyState === 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
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
  return { window, document: window.document, advance, timers, buttons: () => window.document.querySelectorAll('.ai-saver-host') };
}

test('T1.3 three flat replies under one parent each get their own button', t => {
  const page = createGenericPage(t, '<div class="messages"><div class="AssistantMessage">Reply one text</div><div class="AssistantMessage">Reply two text</div><div class="AssistantMessage">Reply three text</div></div>');
  assert.equal(page.window.ChatSavorBridge.adapter?.platform, 'generic');
  assert.equal(page.window.ChatSavorBridge.adapter.getResponses().length, 3);
  page.advance(5200);
  assert.equal(page.buttons().length, 3);
});

test('T1.3 reinjection reuses generic adapter without duplicate timers', t => {
  const page = createGenericPage(t, '<div class="messages"><div class="AssistantMessage">Reply text here</div></div>');
  const first = page.window.ChatSavorBridge.adapter;
  const before = page.timers.size;
  page.window.eval(fs.readFileSync(path.join(extensionRoot, 'src/content/content.js'), 'utf8'));
  assert.equal(page.window.ChatSavorBridge.adapter, first);
  assert.equal(page.timers.size, before);
});

test('T1.3 generic scanner skips dedicated platforms', t => {
  const page = createGenericPage(t, '<div data-message-author-role="assistant">Reply</div>', 'chatgpt.com');
  assert.equal(page.window.ChatSavorBridge.adapter, undefined);
});
