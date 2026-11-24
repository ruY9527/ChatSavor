const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function contentPage(t, url = 'https://chatgpt.com/c/1') {
  const dom = new JSDOM('<!doctype html><html><head><title>My Chat - ChatGPT</title></head><body><main></main></body></html>', {
    url, runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window: dom.window, document: dom.window.document };
}

test('REG metadata resolves platform from bridge status().adapter string', t => {
  const p = contentPage(t);
  p.window.ChatSavorBridge.status = function () { return { adapter: 'gemini' }; };
  const meta = p.window.ChatSavorMeta.getPageMeta(null, 'body');
  assert.equal(meta.platform, 'Gemini', 'must read the string adapter from status()');
  assert.equal(meta.platformId, 'gemini');
});

test('REG collectCitations does not mutate the host page DOM', t => {
  const p = contentPage(t);
  const main = p.document.querySelector('main');
  main.innerHTML = '<a href="https://example.com/a">Source</a>';
  const before = main.innerHTML;
  p.window.ChatSavorMarkdown.collectCitations(main);
  assert.equal(main.innerHTML, before, 'citation collection must be side-effect free');
});

test('REG editing markdown does not double-wrap thinking block on CoT switch', async t => {
  const p = contentPage(t);
  p.window.ChatSavorCore.showPreviewModal('plain body', { thinking: 'my thought' });
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const select = shadow.querySelector('select.cot-mode');
  select.value = 'details';
  select.dispatchEvent(new p.window.Event('change'));
  const editor = shadow.querySelector('textarea.raw-md-editor');
  const wrapped = editor.value;
  assert.equal((wrapped.match(/<details>/g) || []).length, 1);
  editor.value = 'user edited body';
  editor.dispatchEvent(new p.window.Event('input'));
  await new Promise(r => setTimeout(r, 260));
  assert.equal(shadow.querySelector('.raw-md-editor').textContent, 'user edited body');
  // BUG-09: switching CoT re-applies the mode to the latest edited body,
  // producing exactly one thinking block (never a double wrap).
  select.value = 'callout';
  select.dispatchEvent(new p.window.Event('change'));
  const finalText = shadow.querySelector('.raw-md-editor').value;
  assert.equal((finalText.match(/思考过程/g) || []).length, 1, 'exactly one thinking block');
  assert.ok(finalText.includes('user edited body'), 'edited body preserved');
  assert.match(finalText, /\[!abstract\]- 思考过程/);
});

test('REG print page payload write completes before opening the tab', async t => {
  const calls = [];
  let setCb = null;
  const context = vm.createContext({
    URL, console: { warn() {}, error() {}, log() {} },
    chrome: {
      runtime: {
        getManifest: () => manifest,
        getURL: p => 'chrome-extension://id/' + p,
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener: fn => { calls.push(fn); } },
      },
      tabs: {
        query: async () => [],
        create: info => calls.push({ created: info.url }),
        onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
      },
      storage: { session: { set: (obj, cb) => { setCb = cb; } } },
      scripting: { executeScript: async () => [] },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/background.js'), 'utf8'), context);
  const onMessage = calls[0];
  let responded = false;
  onMessage({ type: 'CHATSAVOR_OPEN_PRINT', payload: { html: '<p>x</p>' } }, {}, () => { responded = true; });
  assert.equal(responded, false, 'must wait for storage.session.set callback');
  assert.ok(setCb, 'storage.session.set must be called');
  setCb();
  assert.equal(responded, true, 'response after persistence');
  assert.ok(calls.some(c => c.created && c.created.includes('print.html?id=')), 'tab opened after write');
});

test('REG grok stays mounted but inactive on x.com/home and activates on /i/grok', t => {
  const dom = new JSDOM('<!doctype html><html><head><title>X</title></head><body><main><div class="message-bubble"><div class="response-content-markdown">Grok answer</div></div></main></body></html>', {
    url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js') continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  const adapter = window.ChatSavorAdapters.grok;
  assert.ok(adapter, 'mounted on x.com/home');
  assert.equal(adapter.getResponses().length, 0, 'inactive route exposes no replies');
  assert.equal(window.document.querySelectorAll('.ai-saver-host').length, 0);
  window.history.pushState({}, '', '/i/grok');
  // Periodic scan detects pushState (no popstate event fired).
  adapter.scan(false);
  assert.equal(adapter.getResponses().length, 1, 'SPA route activation exposes replies');
});

test('REG katex bundle does not warn in quirks-mode blank subframes', t => {
  // No <!DOCTYPE html> -> document.compatMode === "BackCompat" (same as about:blank iframes).
  const dom = new JSDOM('<html><body></body></html>', { url: 'about:blank', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.compatMode, 'BackCompat');
  const warnings = [];
  dom.window.console.warn = (...args) => warnings.push(args.join(' '));
  dom.window.eval(fs.readFileSync(path.join(root, 'src/lib/katex.js'), 'utf8'));
  assert.equal(warnings.length, 0, 'must not emit quirks-mode console.warn in chrome://extensions errors');
  const mathml = dom.window.katex.renderToString('E = mc^2', { output: 'mathml' });
  assert.match(mathml, /<math/);
});
