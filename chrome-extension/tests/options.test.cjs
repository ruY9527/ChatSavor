const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const optionsHtml = fs.readFileSync(path.join(root, 'src/options/options.html'), 'utf8');
const optionsJs = fs.readFileSync(path.join(root, 'src/options/options.js'), 'utf8');
const contentJs = fs.readFileSync(path.join(root, 'src/content/content.js'), 'utf8');

function optionsPage(t) {
  const dom = new JSDOM(optionsHtml, { url: 'https://chrome-extension.local/options.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const store = {};
  dom.window.chrome = {
    storage: { local: {
      get(key, cb) { const out = {}; out[key] = store[key]; cb(out); },
      set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
    } },
  };
  dom.window.eval(optionsJs);
  return { window: dom.window, document: dom.window.document, store };
}

test('T3.7 manifest declares options page and storage permission', () => {
  assert.equal(manifest.options_page, 'src/options/options.html');
  assert.ok(manifest.permissions.includes('storage'));
});

test('T3.7 options page exposes all preference and history controls', () => {
  for (const id of ['frontmatter', 'cotMode', 'vault', 'vaultDir', 'theme', 'historyEnabled', 'historySearch', 'customRules', 'save', 'clearHistory']) {
    assert.ok(optionsHtml.includes('id="' + id + '"'), `missing #${id}`);
  }
});

test('T3.7 saving preferences mirrors localStorage keys', t => {
  const p = optionsPage(t);
  p.document.getElementById('frontmatter').checked = true;
  p.document.getElementById('cotMode').value = 'details';
  p.document.getElementById('vault').value = 'MyVault';
  p.document.getElementById('theme').value = 'dark';
  p.document.getElementById('save').click();
  assert.equal(p.window.localStorage.getItem('chatsavor_frontmatter'), '1');
  assert.equal(p.window.localStorage.getItem('chatsavor_cot_mode'), 'details');
  assert.equal(p.window.localStorage.getItem('chatsavor_theme'), 'dark');
  assert.equal(p.window.localStorage.getItem('chatsavor_obsidian_vault'), 'MyVault');
  assert.ok(p.store.prefs);
});

test('T3.7 custom rules save and render in options', t => {
  const p = optionsPage(t);
  p.document.getElementById('customRules').value = JSON.stringify([{ hostPattern: 'chat.example.com', responseSelector: '.answer', userSelector: '.user' }]);
  p.document.getElementById('saveRules').click();
  assert.ok(p.store.customRules);
  assert.equal(JSON.parse(p.store.customRules)[0].hostPattern, 'chat.example.com');
});

test('T3.7 generic scanner reads custom rules from storage.local', () => {
  assert.match(contentJs, /customRules/);
  assert.match(contentJs, /responseSelector/);
});

test('T3.7 history list keeps at most 50 entries on export', () => {
  const core = fs.readFileSync(path.join(root, 'src/content/core.js'), 'utf8');
  assert.match(core, /local\.get\('history'/);
  assert.match(core, /slice\(0, 50\)/);
});
