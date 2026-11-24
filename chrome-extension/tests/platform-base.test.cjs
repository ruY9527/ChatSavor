const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const extensionRoot = path.resolve(__dirname, '..');
const platformBaseSource = fs.readFileSync(path.join(extensionRoot, 'src/content/platform-base.js'), 'utf8');

function createHarness(t, html = '<!doctype html><html><body><div id="app"></div></body></html>', url = 'https://gemini.google.com/c/test') {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  window.HTMLElement.prototype.getClientRects = function () {
    if (!this.isConnected || window.getComputedStyle(this).display === 'contents') return [];
    for (let node = this; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return [];
    }
    return [{ width: 200, height: 20 }];
  };
  window.Date.now = () => now;
  window.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; };
  window.setInterval = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay, repeat: delay }); return id; };
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  window.eval(platformBaseSource);
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      if (timer.repeat) timers.set(id, { ...timer, at: now + timer.repeat });
      timer.callback();
    }
    now = target;
  }
  return { window, document: window.document, timers, advance, now: () => now };
}

function installCore(window, buttons) {
  window.ChatSavorBridge = { version: '2.0.6', register(adapter) { this.adapter = adapter; }, recordError() {} };
  window.ChatSavorCore = {
    injectButtonAfter(el) {
      const host = window.document.createElement('div');
      host.className = 'ai-saver-host';
      if (el.nextSibling) el.parentElement.insertBefore(host, el.nextSibling);
      else el.parentElement.appendChild(host);
      buttons.push(host);
      return true;
    },
    extractMarkdown(el) { return { markdown: el.textContent.trim() }; },
    showPreviewModal(markdown) { this.lastPreview = markdown; },
  };
}

test('T1.1 platform registers with bridge and reports status counts', t => {
  const h = createHarness(t, '<!doctype html><html><body><div id="app"><model-response>Hello world</model-response></div></body></html>');
  installCore(h.window, []);
  const adapter = h.window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: host => host === 'gemini.google.com',
    responseSelectors: ['model-response'],
    initialDelayMs: 0,
    scanIntervalMs: 100,
  });
  assert.equal(h.window.ChatSavorBridge.adapter, adapter);
  assert.equal(adapter.platform, 'gemini');
  assert.equal(adapter.getResponses().length, 1);
  assert.equal(adapter.getResponses()[0].textContent, 'Hello world');
});

test('T1.1 streaming node does not accumulate timers or duplicate buttons', t => {
  const buttons = [];
  const h = createHarness(t, '<!doctype html><html><body><div id="app"><model-response>stream</model-response></div></body></html>');
  installCore(h.window, buttons);
  h.window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: host => host === 'gemini.google.com',
    responseSelectors: ['model-response'],
    initialDelayMs: 0,
    scanIntervalMs: 100,
  });
  const response = h.document.querySelector('model-response');
  h.advance(0); // consume the initial-delay timer before sampling the steady-state count
  const before = h.timers.size;
  for (let i = 0; i < 8; i++) { response.textContent = 'stream ' + i; h.advance(100); }
  assert.equal(h.timers.size, before);
  assert.equal(buttons.length, 0);
  h.advance(1600);
  assert.equal(buttons.length, 1);
});

test('T1.1 button removed by re-render is reinjected on next scan', t => {
  const buttons = [];
  const h = createHarness(t);
  installCore(h.window, buttons);
  h.document.querySelector('#app').innerHTML = '<model-response>stable reply</model-response>';
  h.window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: host => host === 'gemini.google.com',
    responseSelectors: ['model-response'],
    initialDelayMs: 0,
    scanIntervalMs: 100,
  });
  h.advance(1600);
  assert.equal(buttons.length, 1);
  buttons[0].remove();
  h.advance(100);
  assert.equal(buttons.length, 2);
});

test('T1.1 hot reload disposes previous timers and reuses existing adapter', t => {
  const buttons = [];
  const h = createHarness(t, '<!doctype html><html><body><div id="app"><model-response>reply one</model-response></div></body></html>');
  installCore(h.window, buttons);
  const first = h.window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: host => host === 'gemini.google.com',
    responseSelectors: ['model-response'],
    initialDelayMs: 0,
    scanIntervalMs: 100,
  });
  const timersBefore = h.timers.size;
  const reused = h.window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: host => host === 'gemini.google.com',
    responseSelectors: ['model-response'],
    initialDelayMs: 0,
    scanIntervalMs: 100,
  });
  assert.equal(reused, first);
  assert.equal(h.timers.size, timersBefore);
  h.window.ChatSavorBridge.version = '2.0.7';
  const second = h.window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: host => host === 'gemini.google.com',
    responseSelectors: ['model-response'],
    initialDelayMs: 0,
    scanIntervalMs: 100,
  });
  assert.notEqual(second, first);
  assert.equal(h.timers.size, timersBefore);
});

test('T1.1 watchRoute enters active route and scans', t => {
  const buttons = [];
  const h = createHarness(t, '<!doctype html><html><body><div id="app"><div class="reply">grok answer</div></div></body></html>', 'https://x.com/home');
  installCore(h.window, buttons);
  h.window.ChatSavorPlatform.create({
    id: 'grok',
    matchHost: host => host === 'x.com',
    isActiveRoute: loc => loc.pathname.indexOf('/i/grok') === 0,
    watchRoute: true,
    responseSelectors: ['.reply'],
    initialDelayMs: 50,
    scanIntervalMs: 100,
  });
  h.advance(200);
  assert.equal(buttons.length, 0);
  h.window.history.pushState({}, '', '/i/grok');
  h.window.dispatchEvent(new h.window.Event('popstate'));
  h.advance(1600);
  assert.equal(buttons.length, 1);
});
