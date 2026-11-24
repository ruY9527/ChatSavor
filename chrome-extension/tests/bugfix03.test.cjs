const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function loadPage(t, rules, hostname = 'chat.example.com') {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main><div class="my-custom-ai-reply">Custom Reply</div></main></body></html>', {
    url: `https://${hostname}/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  const store = { customRules: JSON.stringify(rules) };
  window.chrome = {
    storage: { local: {
      get(key, cb) { const out = {}; out[key] = store[key]; setImmediate(() => cb(out)); },
      set() {},
    } },
  };
  for (const script of manifest.content_scripts[0].js) {
    if (script.includes('/platforms/')) continue; // exercise the generic path only
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  // Ensure content.js's DOMContentLoaded handler has run before returning.
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document: window.document, store, main: window.document.querySelector('main') };
}

const flush = () => new Promise(r => setImmediate(r));

test('BUG-03 customRules responseSelector really drives the generic adapter', async t => {
  const p = loadPage(t, [{ hostPattern: 'chat.example.com', responseSelector: '.my-custom-ai-reply' }]);
  // Default GENERIC_SELECTORS cannot match .my-custom-ai-reply.
  await flush(); await flush();
  const res = p.window.ChatSavorBridge.handle('SCAN');
  assert.equal(res.status.adapter, 'generic');
  assert.equal(res.status.responseCount, 1, 'custom rule must be applied after async storage read');
  assert.equal(p.document.querySelectorAll('.ai-saver-host').length, 1);
  const btn = p.document.querySelector('.ai-saver-host');
  assert.ok(btn.previousElementSibling && btn.previousElementSibling.classList.contains('my-custom-ai-reply'),
    'button mounted right after the custom reply node');
});

test('BUG-03 hostPattern does not substring-match unrelated hosts', async t => {
  const p = loadPage(t, [{ hostPattern: 'example.com', responseSelector: '.my-custom-ai-reply' }], 'notexample.com.evil.org');
  await flush(); await flush();
  const res = p.window.ChatSavorBridge.handle('SCAN');
  assert.equal(res.status.responseCount, 0, 'loose substring must not apply a rule');
});

test('BUG-03 forceReplace disposes the stale adapter and installs the custom one', async t => {
  const p = loadPage(t, [{ hostPattern: 'chat.example.com', responseSelector: '.my-custom-ai-reply' }]);
  // Synchronous start() has already created the default generic adapter here.
  const stale = p.window.ChatSavorAdapters.generic;
  assert.ok(stale);
  let disposed = false;
  const orig = stale.dispose;
  stale.dispose = function () { disposed = true; return orig.apply(this, arguments); };
  await flush(); await flush(); // async customRules callback must force-replace it
  assert.equal(disposed, true, 'stale generic adapter must be disposed on forced replace');
  const res = p.window.ChatSavorBridge.handle('SCAN');
  assert.equal(res.status.responseCount, 1);
  assert.notEqual(p.window.ChatSavorAdapters.generic, stale);
});
