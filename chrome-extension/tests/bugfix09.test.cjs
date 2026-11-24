const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function page(t, prefs) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat - ChatGPT</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const store = { prefs: JSON.stringify(Object.assign({ frontmatter: true, historyEnabled: true }, prefs)) };
  const setCalls = [];
  window.chrome = {
    storage: { local: {
      get(k, cb) { const o = {}; o[k] = store[k]; setImmediate(() => cb(o)); },
      set(obj, cb) { setCalls.push(obj); Object.assign(store, obj); if (cb) cb(); },
    }, onChanged: { addListener() {} } },
  };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window, document: window.document, store, setCalls };
}

const flush = () => new Promise(r => setImmediate(r));
async function openModal(p, md, opts) {
  p.window.ChatSavorCore.showPreviewModal(md, opts);
  await flush(); await flush();
  return p.document.querySelector('.ai-saver-modal-host').shadowRoot;
}

test('BUG-09 Obsidian content carries YAML frontmatter when enabled', async t => {
  const p = page(t, { frontmatter: true });
  await flush();
  const meta = p.window.ChatSavorMeta.getPageMeta('chatgpt', '# Body');
  const withFm = p.window.ChatSavorMeta.withFrontmatter('# Body', meta, true);
  assert.match(withFm, /^---\ntitle:/);
  // The button path uses the same withFrontmatter + buildObsidianUri helpers.
  const uri = p.window.ChatSavorCore.buildObsidianUri(withFm, meta);
  assert.match(decodeURIComponent(new URL(uri).searchParams.get('content')), /^---\ntitle:/);
});

test('BUG-09 HTML and DOCX exports never render raw YAML frontmatter lines', async t => {
  const p = page(t, { frontmatter: true });
  const shadow = await openModal(p, '# Visible heading\n\nBody text');
  let captured = [];
  const origCreate = p.window.URL.createObjectURL;
  p.window.URL.createObjectURL = blob => { captured.push(blob); return 'blob:x'; };
  const origClick = p.window.HTMLAnchorElement.prototype.click;
  p.window.HTMLAnchorElement.prototype.click = function () {};
  t.after(() => { p.window.URL.createObjectURL = origCreate; p.window.HTMLAnchorElement.prototype.click = origClick; });
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '.html').click();
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '.docx').click();
  assert.equal(captured.length, 2);
  for (const blob of captured) {
    const text = await new Promise((resolve, reject) => {
      const r = new p.window.FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(blob);
    });
    assert.doesNotMatch(text, /exported_at:/, 'no raw YAML key in exported document');
    assert.doesNotMatch(text, /\ntitle: /);
  }
});

test('BUG-09 switching CoT with a formula rebuilds the formula tab and list', async t => {
  const p = page(t, { frontmatter: false });
  const shadow = await openModal(p, 'plain answer', { thinking: 'thinking has $x^2$ formula' });
  const select = shadow.querySelector('select.cot-mode');
  assert.ok(select);
  select.value = 'details';
  select.dispatchEvent(new p.window.Event('change'));
  const formulaTab = [...shadow.querySelectorAll('.tab')].find(b => b.textContent.startsWith('公式'));
  assert.ok(formulaTab, 'formula tab shown now that thinking text contains math');
  assert.match(formulaTab.textContent, /公式 \(1\)/);
  assert.equal(shadow.querySelectorAll('.formula-item').length, 1);
  assert.equal(shadow.querySelector('.formula-item pre').textContent, 'x^2');
});

test('BUG-09 every export path records history', async t => {
  const p = page(t, { frontmatter: false, historyEnabled: true });
  const shadow = await openModal(p, '# Record me');
  const origCreate = p.window.URL.createObjectURL;
  p.window.URL.createObjectURL = () => 'blob:x';
  const origClick = p.window.HTMLAnchorElement.prototype.click;
  p.window.HTMLAnchorElement.prototype.click = function () {};
  t.after(() => { p.window.URL.createObjectURL = origCreate; p.window.HTMLAnchorElement.prototype.click = origClick; });
  for (const label of ['.md', '.html', '.docx']) {
    [...shadow.querySelectorAll('button')].find(b => b.textContent === label).click();
  }
  await new Promise(r => setTimeout(r, 30));
  const hist = JSON.parse(p.store.history || '[]');
  assert.equal(hist.length, 3, 'md/html/docx each appended one history entry');
});
