const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function setup(t, title = 'My Chat - ChatGPT') {
  const dom = new JSDOM(`<!doctype html><html><head><title>${title}</title></head><body><main></main></body></html>`, {
    url: 'https://chatgpt.com/c/secret-id?token=xyz#frag', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window: dom.window, document: dom.window.document, meta: dom.window.ChatSavorMeta, core: dom.window.ChatSavorCore };
}

test('T3.1 getPageMeta strips platform suffix and keeps origin+pathname only', t => {
  const page = setup(t);
  const meta = page.meta.getPageMeta('chatgpt', '# My Title\nbody');
  assert.equal(meta.title, 'My Chat');
  assert.equal(meta.platform, 'ChatGPT');
  assert.equal(meta.url, 'https://chatgpt.com/c/secret-id');
  assert.doesNotMatch(meta.url, /token|frag/);
  assert.match(meta.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(meta.datetime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('T3.1 generic title falls back to markdown heading', t => {
  const page = setup(t, 'ChatGPT');
  const meta = page.meta.getPageMeta('chatgpt', '## 用户的问题\n\n更多内容');
  assert.equal(meta.title, '用户的问题');
});

test('T3.1 buildFilename sanitizes illegal characters and truncates', t => {
  const page = setup(t);
  const name = page.meta.buildFilename({ title: 'a/b:c*?"<>| 很长的标题 '.repeat(6), platform: 'ChatGPT', date: '2026-11-24' }, 'md');
  assert.match(name, /^2026-11-24_ChatGPT_/);
  assert.match(name, /\.md$/);
  assert.doesNotMatch(name, /[<>:"\/\\|?*]/);
  assert.ok(name.length < 120);
});

test('T3.1 withFrontmatter escapes quotes and backslashes, disabled returns original', t => {
  const page = setup(t);
  const meta = { title: 'Say "hi" \\ path', platform: 'ChatGPT', platformId: 'chatgpt', url: 'https://x/y', datetime: '2026-11-24 10:30' };
  const on = page.meta.withFrontmatter('# Body', meta, true);
  assert.match(on, /^---\ntitle: "Say \\"hi\\" \\\\ path"/);
  assert.match(on, /platform: ChatGPT/);
  assert.match(on, /exported_at: 2026-11-24 10:30/);
  assert.match(on, /  - chatgpt\n---/);
  assert.equal(page.meta.withFrontmatter('# Body', meta, false), '# Body');
});

test('T3.1 preview modal exposes frontmatter toggle and md download uses smart filename', t => {
  const page = setup(t);
  let captured = null;
  const orig = page.window.URL.createObjectURL;
  page.window.URL.createObjectURL = function (blob) { captured = blob; return 'blob:x'; };
  let downloadedName = null;
  const origClick = page.window.HTMLAnchorElement.prototype.click;
  page.window.HTMLAnchorElement.prototype.click = function () { downloadedName = this.getAttribute('download'); };
  t.after(() => { page.window.URL.createObjectURL = orig; page.window.HTMLAnchorElement.prototype.click = origClick; });
  page.core.showPreviewModal('# Body text');
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const toggle = shadow.querySelector('.frontmatter-toggle input');
  assert.ok(toggle, 'frontmatter checkbox should exist');
  toggle.checked = true;
  toggle.dispatchEvent(new page.window.Event('change'));
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '.md').click();
  assert.match(downloadedName, /^2026-\d{2}-\d{2}_ChatGPT_My-Chat\.md$/);
});
