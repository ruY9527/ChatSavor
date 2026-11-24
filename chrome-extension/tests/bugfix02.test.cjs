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
  const turns = [
    { role: 'assistant', element: window.document.createElement('div') },
    { role: 'user', element: window.document.createElement('div') },
  ];
  turns[0].element.textContent = 'AI reply';
  turns[1].element.textContent = 'User question';
  const main = window.document.querySelector('main');
  turns.forEach(t2 => main.appendChild(t2.element));
  window.ChatSavorBridge.register({
    platform: 'chatgpt',
    getTurns: () => turns,
    getResponses: () => [turns[0].element],
    extractMarkdown: el => ({ markdown: el.textContent }),
  });
  window.ChatSavorCore.showPreviewModal = () => {};
  return { window, document: window.document, turns, main };
}

test('BUG-02 multi-select marks have visible inline styles, role and aria state', t => {
  const p = page(t);
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  const marks = p.document.querySelectorAll('.ai-saver-select-mark');
  assert.equal(marks.length, 2);
  marks.forEach(mark => {
    assert.equal(mark.style.position, 'absolute');
    assert.equal(mark.style.width, '20px');
    assert.equal(mark.style.height, '20px');
    assert.equal(mark.style.display, 'flex');
    assert.equal(mark.getAttribute('role'), 'checkbox');
    assert.equal(mark.getAttribute('aria-checked'), 'false');
    assert.equal(mark.textContent, '');
  });
  marks[0].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  assert.equal(marks[0].textContent, '✓');
  assert.equal(marks[0].getAttribute('aria-checked'), 'true');
  assert.equal(marks[0].style.background, 'rgb(102, 126, 234)');
  marks[0].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  assert.equal(marks[0].textContent, '');
  assert.equal(marks[0].getAttribute('aria-checked'), 'false');
});

test('BUG-02 leaving multi-select restores turn position and removes all marks', t => {
  const p = page(t);
  const before = p.turns.map(x => x.element.style.position);
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  assert.ok(p.document.querySelectorAll('.ai-saver-select-mark').length === 2);
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE'); // off
  assert.equal(p.document.querySelectorAll('.ai-saver-select-mark').length, 0);
  p.turns.forEach((x, i) => assert.equal(x.element.style.position, before[i]));
});

test('BUG-02 select marks are excluded from extracted markdown', t => {
  const p = page(t);
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  const mark = p.document.querySelector('.ai-saver-select-mark');
  mark.textContent = '✓ SELECTED MARK';
  const result = p.window.ChatSavorMarkdown.extract(p.turns[0].element);
  assert.doesNotMatch(result.markdown, /SELECTED MARK/);
});
