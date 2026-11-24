const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function page(t, html = '<main><div data-message-author-role="user">Hello question</div><div data-message-author-role="assistant">**Answer** text</div></main>') {
  const dom = new JSDOM(`<!doctype html><html><head><title>Chat</title></head><body>${html}</body></html>`, {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  window.setTimeout = window.setInterval = () => 0;
  let previews = [];
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  // Register a simple adapter exposing getTurns through the base-like contract.
  const adapter = {
    platform: 'chatgpt',
    getTurns() {
      const turns = [];
      window.document.querySelectorAll('[data-message-author-role]').forEach(el => {
        turns.push({ role: el.getAttribute('data-message-author-role'), element: el });
      });
      return turns;
    },
    getResponses() { return [...window.document.querySelectorAll('[data-message-author-role="assistant"]')]; },
    extractMarkdown(el) { return { markdown: (el.textContent || '').trim() }; },
  };
  window.ChatSavorBridge.register(adapter);
  window.ChatSavorCore.showPreviewModal = function (md, opts) { previews.push({ md, opts }); };
  return { window, document: window.document, previews: () => previews, adapter };
}

test('T3.2 EXPORT_ALL builds a conversation markdown with separators', t => {
  const p = page(t);
  const res = p.window.ChatSavorBridge.handle('EXPORT_ALL');
  assert.equal(res.ok, true);
  assert.equal(res.turnsCount, 2);
  assert.equal(p.previews().length, 1);
  assert.match(p.previews()[0].md, /## 👤 User\n\nHello question/);
  assert.match(p.previews()[0].md, /## 🤖 Assistant\n\n\*\*Answer\*\* text/);
  assert.match(p.previews()[0].md, /\n\n---\n\n/);
  assert.equal(p.previews()[0].opts.mode, 'conversation');
});

test('T3.2 TOGGLE_SELECT_MODE injects marks and cleans up on cancel', t => {
  const p = page(t);
  const on = p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  assert.equal(on.ok, true);
  assert.equal(p.document.querySelectorAll('.ai-saver-select-host').length, 1);
  assert.equal(p.document.querySelectorAll('.ai-saver-select-mark').length, 2);
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  assert.equal(p.document.querySelectorAll('.ai-saver-select-host').length, 0);
  assert.equal(p.document.querySelectorAll('.ai-saver-select-mark').length, 0);
});

test('T3.2 selecting AI only and exporting opens preview then clears marks', t => {
  const p = page(t);
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  const shadow = p.document.querySelector('.ai-saver-select-host').shadowRoot;
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '仅选 AI 回复').click();
  assert.match(shadow.querySelector('.cs-count').textContent, /已选中 1 \/ 2 条/);
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '导出选中').click();
  assert.equal(p.previews().length, 1);
  assert.match(p.previews()[0].md, /## 🤖 Assistant/);
  assert.doesNotMatch(p.previews()[0].md, /## 👤 User/);
  assert.equal(p.document.querySelectorAll('.ai-saver-select-mark').length, 0);
});

test('T3.2 popup exposes export-all and multi-select buttons', () => {
  const html = fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8');
  assert.match(html, /id="export-all"/);
  assert.match(html, /id="multi-select"/);
});
