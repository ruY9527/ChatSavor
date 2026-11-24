const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function setup(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window: dom.window, document: dom.window.document, md: dom.window.ChatSavorMarkdown, core: dom.window.ChatSavorCore };
}

test('T3.4 applyThinkingMode supports omit/details/callout', t => {
  const p = setup(t);
  const thinking = '第一步\n第二步';
  assert.equal(p.md.applyThinkingMode('body', thinking, 'omit'), 'body');
  const details = p.md.applyThinkingMode('body', thinking, 'details');
  assert.match(details, /<details><summary>思考过程<\/summary>/);
  assert.match(details, /第一步\n第二步/);
  assert.match(details, /body$/);
  const callout = p.md.applyThinkingMode('body', thinking, 'callout');
  assert.match(callout, /> \[!abstract\]- 思考过程/);
  assert.match(callout, /> 第一步\n> 第二步/);
});

test('T3.4 collectCitations and footnotes produce numbered sources', t => {
  const p = setup(t);
  p.document.querySelector('main').innerHTML = '<a href="https://example.com/a">Source A</a> <a href="https://example.com/a">dup</a> <a href="https://x.org/b">Source B</a>';
  const citations = p.md.collectCitations(p.document.querySelector('main'));
  assert.equal(citations.length, 2);
  assert.equal(citations[0].index, 1);
  assert.equal(citations[0].title, 'Source A');
  const notes = p.md.footnotes(citations);
  assert.match(notes, /\[\^1\]: \[Source A\]\(https:\/\/example\.com\/a\)/);
  assert.match(notes, /\[\^2\]: \[Source B\]\(https:\/\/x\.org\/b\)/);
});

test('T3.4 preview modal exposes CoT selector and switching re-renders preview', t => {
  const p = setup(t);
  p.core.showPreviewModal('answer body', { thinking: 'reasoning trace' });
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const select = shadow.querySelector('select.cot-mode');
  assert.ok(select, 'CoT selector should appear when thinking is provided');
  assert.equal(select.value, 'omit');
  assert.doesNotMatch(shadow.querySelector('.raw-md').textContent, /reasoning trace/);
  select.value = 'callout';
  select.dispatchEvent(new p.window.Event('change'));
  assert.match(shadow.querySelector('.raw-md').textContent, /\[!abstract\]- 思考过程/);
  assert.match(shadow.querySelector('.preview').innerHTML, /思考过程/);
  select.value = 'omit';
  select.dispatchEvent(new p.window.Event('change'));
  assert.doesNotMatch(shadow.querySelector('.raw-md').textContent, /reasoning trace/);
});

test('T3.4 no CoT selector without thinking', t => {
  const p = setup(t);
  p.core.showPreviewModal('plain');
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.equal(shadow.querySelector('select.cot-mode'), null);
});
