const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function page(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  const previews = [];
  window.ChatSavorCore.showPreviewModal = (md, opts) => previews.push({ md, opts });
  const main = window.document.querySelector('main');
  return { window, document: window.document, previews, main };
}

function makeTurns(window, main, specs) {
  return specs.map(spec => {
    const el = window.document.createElement('div');
    el.textContent = spec.text || '';
    main.appendChild(el);
    return { role: spec.role, element: el, thinking: spec.thinking };
  });
}

test('BUG-08 EXPORT_ALL skips empty turns and never writes the domain into the body', t => {
  const p = page(t);
  const turns = makeTurns(p.window, p.main, [
    { role: 'user', text: 'question' },
    { role: 'assistant', text: '' }, // empty extraction
  ]);
  p.window.ChatSavorBridge.register({
    platform: 'chatgpt',
    getTurns: () => turns,
    getResponses: () => [],
    extractMarkdown: el => ({ markdown: el.textContent }),
  });
  p.window.ChatSavorBridge.handle('EXPORT_ALL');
  assert.equal(p.previews.length, 1);
  assert.match(p.previews[0].md, /question/);
  assert.doesNotMatch(p.previews[0].md, /chatgpt\.com/);
});

test('BUG-08 LATEST passes thinking into the preview so CoT selector appears', t => {
  const p = page(t);
  const turns = makeTurns(p.window, p.main, [{ role: 'assistant', text: 'answer', thinking: 'reasoning trace' }]);
  p.window.ChatSavorBridge.register({
    platform: 'chatgpt',
    getTurns: () => turns,
    getResponses: () => [turns[0].element],
    extractMarkdown: el => ({ markdown: el.textContent, thinking: el === turns[0].element ? 'reasoning trace' : '' }),
  });
  p.window.ChatSavorBridge.handle('LATEST');
  assert.equal(p.previews.length, 1);
  assert.equal(p.previews[0].opts.thinking, 'reasoning trace');
});

test('BUG-08 multi-select export keeps document order after reverse clicking', t => {
  const p = page(t);
  const turns = makeTurns(p.window, p.main, [
    { role: 'assistant', text: 'FIRST reply' },
    { role: 'assistant', text: 'SECOND reply' },
  ]);
  p.window.ChatSavorBridge.register({
    platform: 'chatgpt',
    getTurns: () => turns,
    getResponses: () => turns.map(x => x.element),
    extractMarkdown: el => ({ markdown: el.textContent }),
  });
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  const marks = p.document.querySelectorAll('.ai-saver-select-mark');
  marks[1].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true })); // click 2nd first
  marks[0].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  [...p.document.querySelector('.ai-saver-select-host').shadowRoot.querySelectorAll('button')]
    .find(b => b.textContent === '导出选中').click();
  assert.equal(p.previews.length, 1);
  assert.ok(p.previews[0].md.indexOf('FIRST reply') < p.previews[0].md.indexOf('SECOND reply'),
    'document order preserved regardless of click order');
});
