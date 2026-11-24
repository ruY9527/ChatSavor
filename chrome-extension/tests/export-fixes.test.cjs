const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function setup(t, html = '') {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  const { window } = dom;
  const container = window.document.querySelector('main');
  container.innerHTML = html;
  return { window, document: window.document, container, tools: window.ChatSavorMarkdown, core: window.ChatSavorCore };
}

test('T1.4 task list checkboxes survive render as disabled inputs', t => {
  const page = setup(t);
  const html = page.tools.render('- [x] done task\n- [ ] todo task');
  const holder = page.document.createElement('div');
  holder.innerHTML = html;
  const boxes = holder.querySelectorAll('input[type="checkbox"]');
  assert.equal(boxes.length, 2);
  boxes.forEach(box => assert.equal(box.hasAttribute('disabled'), true));
});

test('T1.4 \\[...\\] block math renders as standalone div, not wrapped in p', t => {
  const page = setup(t);
  const html = page.tools.render('before text\n\\[ a^2 + b^2 = c^2 \\]\n\nafter text');
  const holder = page.document.createElement('div');
  holder.innerHTML = html;
  const math = holder.querySelector('div.chatsavor-math');
  assert.ok(math, 'block math should render as div.chatsavor-math');
  assert.equal(math.parentElement.tagName, 'DIV');
  assert.equal(math.parentElement.closest('p'), null);
});

test('T1.4 extract() exposes html as a lazy getter', t => {
  const page = setup(t, '<p>lazy content</p>');
  const result = page.tools.extract(page.container);
  const descriptor = Object.getOwnPropertyDescriptor(result, 'html');
  assert.equal(typeof descriptor.get, 'function');
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.writable, undefined);
  assert.equal(typeof result.markdown, 'string');
  assert.ok(result.html.includes('lazy content'));
  assert.equal(result.html, result.html);
});

test('T1.4 safe base64 bitmap data URL is preserved while svg and js URLs are stripped', t => {
  const page = setup(t);
  const html = page.tools.render('![ok](data:image/png;base64,AAAA) ![bad](data:image/svg+xml;base64,PHN2Zz4=) [x](javascript:alert(1))');
  assert.match(html, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(html, /data:image\/svg\+xml/);
  assert.doesNotMatch(html, /javascript:/);
});

test('T1.4 markdown with no parentElement text node does not crash protectMath', t => {
  const page = setup(t, '<p>plain</p>');
  const detached = page.document.createTextNode('detached');
  detached.remove();
  const result = page.tools.extract(page.container);
  assert.ok(result && typeof result.markdown === 'string');
});

test('T1.5 injectButtonAfter returns false for detached nodes', t => {
  const page = setup(t);
  const detached = page.document.createElement('div');
  assert.equal(page.core.injectButtonAfter(detached, () => {}), false);
});

test('T1.5 consecutive preview modals leave a single keydown handler', t => {
  const page = setup(t);
  const events = [];
  page.document.addEventListener('keydown', () => events.push('external'));
  page.core.showPreviewModal('first');
  page.core.showPreviewModal('second');
  assert.equal(page.document.querySelectorAll('.ai-saver-modal-host').length, 1);
  page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(page.document.querySelectorAll('.ai-saver-modal-host').length, 0);
  assert.equal(events.length, 1, 'external listener must still fire exactly once');
  page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(page.document.querySelectorAll('.ai-saver-modal-host').length, 0);
});

test('T1.5 downloadDocx output is sanitized against script and onerror payloads', async t => {
  const page = setup(t);
  let captured = null;
  const originalCreate = page.window.URL.createObjectURL;
  page.window.URL.createObjectURL = function (blob) { captured = blob; return 'blob:fake'; };
  t.after(() => { page.window.URL.createObjectURL = originalCreate; });
  page.core.downloadDocx('<script>alert(1)</script><img src=x onerror=alert(1)>\n\ntext');
  assert.ok(captured, 'a Blob should be created');
  const content = await new Promise((resolve, reject) => {
    const reader = new page.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(captured);
  });
  assert.doesNotMatch(content, /<script/i);
  assert.doesNotMatch(content, /onerror\s*=/i);
  assert.match(content, /text/);
});

test('T1.5 PDF button shows progress then restores label', t => {
  const page = setup(t);
  page.core.showPreviewModal('content');
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const pdf = [...shadow.querySelectorAll('button')].find(b => b.textContent === '.pdf');
  assert.ok(pdf);
  let resolveDownload;
  page.window.ChatSavorPdf = { downloadMarkdownPdf: () => new Promise(resolve => { resolveDownload = resolve; }) };
  pdf.click();
  assert.equal(pdf.disabled, true);
  assert.match(pdf.textContent, /正在生成/);
  resolveDownload();
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    assert.equal(pdf.disabled, false);
    assert.equal(pdf.textContent, '.pdf');
  });
});
