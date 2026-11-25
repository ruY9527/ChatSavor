const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function contentPage(t, html = '<main><div data-message-author-role="assistant">reply text</div></main>') {
  const dom = new JSDOM(`<!doctype html><html><head><title>Chat</title></head><body>${html}</body></html>`, {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window: dom.window, document: dom.window.document, core: dom.window.ChatSavorCore };
}

test('UI-01 reply action pill renders preview button and 1-click copy MD button', t => {
  const p = contentPage(t);
  const replyEl = p.document.querySelector('[data-message-author-role="assistant"]');
  let onClicked = false;
  p.core.injectButtonAfter(replyEl, () => { onClicked = true; });
  const host = p.document.querySelector('.ai-saver-host');
  assert.ok(host);
  const shadow = host.shadowRoot;
  const saveBtn = shadow.querySelector('.save-btn');
  const copyBtn = shadow.querySelector('.quick-copy-btn');
  assert.ok(saveBtn, '.save-btn present');
  assert.ok(copyBtn, '.quick-copy-btn present');
  saveBtn.click();
  assert.equal(onClicked, true);
  // Copy button feedback.
  copyBtn.click();
  assert.match(copyBtn.querySelector('.btn-label').textContent, /已复制|复制 MD/);
});

test('UI-02 preview modal preserves 12 button textContent contracts with two-tier footer and wide toggle', t => {
  const p = contentPage(t);
  p.core.showPreviewModal('# 标题\n\n正文 $E=mc^2$', { thinking: '思考内容' });
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.ok(shadow.querySelector('.footer-row-top'));
  assert.ok(shadow.querySelector('.card-capsule'));
  assert.ok(shadow.querySelector('.card-capsule select.card-theme-select'));
  assert.ok(shadow.querySelector('.footer-row-bottom'));
  const labels = ['复制 Markdown', '复制富文本', '发送到 Obsidian', '保存到本地库', '复制长图', '下载长图', '.md', '.pdf', '.docx', '.tex', '.html', '.zip (离线含图)'];
  labels.forEach(label => {
    const found = [...shadow.querySelectorAll('button')].find(b => b.textContent === label);
    assert.ok(found, `button "${label}" must have exact textContent (icon pollution check)`);
  });
  const expandBtn = shadow.querySelector('.expand-btn');
  assert.ok(expandBtn);
  expandBtn.click();
  assert.equal(shadow.querySelector('.modal').classList.contains('expanded'), true);
  expandBtn.click();
  assert.equal(shadow.querySelector('.modal').classList.contains('expanded'), false);
});

test('UI-02 Ctrl+Shift+C inside preview modal copies markdown', async t => {
  const p = contentPage(t);
  let copied = null;
  p.window.ChatSavorMarkdown.copy = (md) => { copied = md; return Promise.resolve(false); };
  p.core.showPreviewModal('# 标题');
  p.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, bubbles: true }));
  assert.ok(copied && copied.includes('# 标题'), 'markdown copied via shortcut');
});

test('UI-03 multi-select Escape exits and restores host positions', t => {
  const p = contentPage(t, '<main><div data-message-author-role="user">Q</div><div data-message-author-role="assistant">A</div></main>');
  const turns = [...p.document.querySelectorAll('[data-message-author-role]')].map((el, i) => ({ role: i === 0 ? 'user' : 'assistant', element: el }));
  p.window.ChatSavorBridge.register({
    platform: 'chatgpt',
    getTurns: () => turns,
    getResponses: () => [turns[1].element],
    extractMarkdown: el => ({ markdown: el.textContent }),
  });
  p.window.ChatSavorBridge.handle('TOGGLE_SELECT_MODE');
  assert.equal(p.document.querySelectorAll('.ai-saver-select-mark').length, 2);
  p.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.document.querySelectorAll('.ai-saver-select-mark').length, 0);
  assert.equal(p.document.querySelectorAll('.ai-saver-select-host').length, 0);
});

test('UI-04 popup exposes open-options and status-dot data-state', async t => {
  const html = fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const { window } = dom;
  let opened = false;
  const manifest2 = manifest;
  window.chrome = {
    runtime: { getManifest: () => manifest2, openOptionsPage: () => { opened = true; }, getURL: p => 'chrome-extension://id/' + p },
    tabs: { query: async () => [{ id: 1, url: 'https://chatgpt.com/c/1' }] },
    storage: { local: { get: () => {}, set: () => {} } },
  };
  // ChatSavorConnection is not available here; controller.js needs it. Provide a stub.
  window.ChatSavorConnection = () => ({ connect: async () => ({ ok: true, status: { version: manifest2.version, host: 'chatgpt.com', coreReady: true, markdownReady: true, adapter: 'chatgpt', responseCount: 2, buttonCount: 2 } }) });
  window.eval(fs.readFileSync(path.join(root, 'src/popup/controller.js'), 'utf8'));
  // controller runs an async STATUS query on load.
  await new Promise(r => setTimeout(r, 20));
  const dot = window.document.getElementById('status-dot');
  assert.equal(dot.dataset.state, 'ready');
  window.document.getElementById('open-options').click();
  assert.equal(opened, true);
});

test('UI-05 options history empty state and per-item md download & copy feedback', async t => {
  const html = fs.readFileSync(path.join(root, 'src/options/options.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://chrome-extension.test/options.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  const { window } = dom;
  const store = { history: JSON.stringify([]) };
  window.chrome = { storage: { local: {
    get(key, cb) { const out = {}; out[key] = store[key]; setImmediate(() => cb(out)); },
    set(obj, cb) { Object.assign(store, obj); if (cb) cb(); },
  } } };
  window.eval(fs.readFileSync(path.join(root, 'src/options/options.js'), 'utf8'));
  await new Promise(r => setTimeout(r, 20));
  const list = window.document.getElementById('historyList');
  assert.ok(list.querySelector('.history-empty'), 'empty state rendered');
  // Now seed one history item and re-render.
  store.history = JSON.stringify([{ title: '我的笔记', platform: 'ChatGPT', time: '2026-11-24 10:00', markdown: '# 内容' }]);
  window.ChatSavorOptions.renderHistory('');
  await new Promise(r => setTimeout(r, 20));
  const item = list.querySelector('.history-item');
  assert.ok(item);
  const downloadBtn = [...item.querySelectorAll('button')].find(b => b.textContent === '下载 .md');
  assert.ok(downloadBtn);
  const copyBtn = [...item.querySelectorAll('button')].find(b => b.textContent === '复制');
  assert.ok(copyBtn);
  copyBtn.click();
  assert.equal(copyBtn.textContent, '✓ 已复制');
});
