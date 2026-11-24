const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat - ChatGPT</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  if (options.dark) dom.window.matchMedia = () => ({ matches: true });
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window: dom.window, document: dom.window.document, core: dom.window.ChatSavorCore };
}

test('T3.5 markdown tab is an editable textarea with debounced live preview', async t => {
  const p = setup(t);
  p.core.showPreviewModal('# Original');
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const editor = shadow.querySelector('textarea.raw-md-editor');
  assert.ok(editor, 'editable textarea should replace the read-only pre');
  assert.equal(editor.value, '# Original');
  editor.value = '# Edited text';
  editor.dispatchEvent(new p.window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.match(shadow.querySelector('.preview').innerHTML, /Edited text/);
  // Export now uses the edited content.
  let captured = null;
  const orig = p.window.URL.createObjectURL;
  p.window.URL.createObjectURL = function (blob) { captured = blob; return 'blob:x'; };
  const origClick = p.window.HTMLAnchorElement.prototype.click;
  p.window.HTMLAnchorElement.prototype.click = function () {};
  t.after(() => { p.window.URL.createObjectURL = orig; p.window.HTMLAnchorElement.prototype.click = origClick; });
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '.md').click();
  const text = await new Promise((resolve, reject) => {
    const reader = new p.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(captured);
  });
  assert.match(text, /# Edited text/);
  assert.doesNotMatch(text, /Original/);
});

test('T3.5 dark mode auto-detection and manual toggle', t => {
  const p = setup(t, { dark: true });
  p.core.showPreviewModal('body');
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const modal = shadow.querySelector('.modal');
  assert.equal(modal.classList.contains('dark'), true);
  const themeBtn = shadow.querySelector('.theme-btn');
  assert.ok(themeBtn);
  themeBtn.click();
  assert.equal(modal.classList.contains('dark'), false);
  assert.equal(p.window.localStorage.getItem('chatsavor_theme'), 'light');
});

test('T3.5 Obsidian button builds URI and warns when too long', t => {
  const p = setup(t);
  p.window.localStorage.setItem('chatsavor_obsidian_vault', 'MyVault');
  p.core.showPreviewModal('short note');
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const btn = [...shadow.querySelectorAll('button')].find(b => b.textContent === '发送到 Obsidian');
  assert.ok(btn);
  // Avoid actually navigating the jsdom window; just confirm the handler path via long-content warning.
  p.core.showPreviewModal('x'.repeat(40000));
  const shadow2 = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  [...shadow2.querySelectorAll('button')].find(b => b.textContent === '发送到 Obsidian').click();
  const status = shadow2.querySelector('.copy-status');
  assert.match(status.textContent, /30,000|URI/);
});
