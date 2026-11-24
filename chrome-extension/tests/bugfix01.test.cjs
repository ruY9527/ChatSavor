const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function loadCoreInPage(t, prefs) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat - ChatGPT</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  // Real chrome.storage.local simulation with JSON-stringified prefs.
  const store = {};
  if (prefs) store.prefs = JSON.stringify(prefs);
  const setCalls = [];
  window.chrome = {
    storage: {
      local: {
        get(key, cb) { const out = {}; out[key] = store[key]; cb(out); },
        set(obj, cb) { setCalls.push(obj); Object.assign(store, obj); if (cb) cb(); },
      },
      onChanged: { addListener() {} },
    },
  };
  // Ensure localStorage is truly empty: prefs must come from chrome.storage only.
  window.localStorage.clear();
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window, document: window.document, store, setCalls };
}

const flush = () => new Promise(r => setImmediate(r));

test('BUG-01 preferences from chrome.storage.local drive theme, frontmatter and CoT in the page', async t => {
  const p = loadCoreInPage(t, {
    frontmatter: true, cotMode: 'callout', vault: 'MyVault', vaultDir: 'AI/Notes',
    theme: 'dark', historyEnabled: false,
  });
  p.window.ChatSavorCore.showPreviewModal('answer body', { thinking: 'trace' });
  await flush();
  const host = p.document.querySelector('.ai-saver-modal-host');
  assert.ok(host, 'modal mounted asynchronously after storage read');
  const shadow = host.shadowRoot;
  assert.equal(shadow.querySelector('.modal').classList.contains('dark'), true, 'theme=dark from storage');
  assert.equal(shadow.querySelector('.frontmatter-toggle input').checked, true, 'frontmatter from storage');
  assert.equal(shadow.querySelector('select.cot-mode').value, 'callout', 'cotMode from storage');
});

test('BUG-01 Obsidian URI uses vault and vaultDir from chrome.storage.local', async t => {
  const p = loadCoreInPage(t, { vault: 'MyVault', vaultDir: 'AI/Notes' });
  await new Promise(r => setImmediate(r)); // let the startup syncPrefsFromStorage finish
  const uri = p.window.ChatSavorCore.buildObsidianUri('note body', { title: 'My Note' });
  assert.ok(uri.startsWith('obsidian://new?'));
  const url = new URL(uri);
  assert.equal(url.searchParams.get('vault'), 'MyVault');
  assert.equal(url.searchParams.get('name'), 'AI/Notes/My Note');
  assert.equal(url.searchParams.get('content'), 'note body');
});

test('BUG-01 historyEnabled=false stops saveHistory on export', async t => {
  const p = loadCoreInPage(t, { frontmatter: false, historyEnabled: false });
  // Patch .md download to avoid actual blob work; just trigger the click.
  const origCreate = p.window.URL.createObjectURL;
  p.window.URL.createObjectURL = () => 'blob:x';
  const origClick = p.window.HTMLAnchorElement.prototype.click;
  p.window.HTMLAnchorElement.prototype.click = function () {};
  t.after(() => { p.window.URL.createObjectURL = origCreate; p.window.HTMLAnchorElement.prototype.click = origClick; });
  p.window.ChatSavorCore.showPreviewModal('body');
  await flush();
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '.md').click();
  await flush();
  assert.equal(p.store.history, undefined, 'no history written when disabled');
});

test('BUG-01 storage.onChanged updates cached prefs live without page reload', async t => {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const store = { prefs: JSON.stringify({ theme: 'light' }) };
  let changeListener;
  window.chrome = {
    storage: {
      local: { get(k, cb) { const o = {}; o[k] = store[k]; cb(o); }, set() {} },
      onChanged: { addListener(fn) { changeListener = fn; } },
    },
  };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  // Simulate the Options page saving a new preference in another tab:
  // chrome.storage.onChanged fires AND storage.local reflects the new value.
  const newer = JSON.stringify({ theme: 'dark', frontmatter: true });
  store.prefs = newer;
  changeListener({ prefs: { newValue: newer } }, 'local');
  window.ChatSavorCore.showPreviewModal('body');
  await flush();
  const shadow = window.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.equal(shadow.querySelector('.modal').classList.contains('dark'), true);
  assert.equal(shadow.querySelector('.frontmatter-toggle input').checked, true);
});
