const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/export/print.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/export/print.js'), 'utf8');

function printPage(t, id) {
  const dom = new JSDOM(html, {
    url: 'https://chrome-extension.test/src/export/print.html?id=' + encodeURIComponent(id),
    runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.print = () => {};
  const removed = [];
  const payload = { [id]: { html: '<h1>Print Title</h1><p>body text</p>', title: 'My Doc' } };
  window.chrome = {
    storage: { session: {
      get(key, cb) { const out = {}; Object.keys(key).forEach(k => { out[k] = payload[k]; }); cb(out); },
      remove(key) { removed.push(key); },
    } },
  };
  window.eval(js);
  return { window, document: window.document, removed };
}

test('BUG-12 print.js removes the one-shot storage.session key after rendering', t => {
  const p = printPage(t, 'print_123');
  assert.deepEqual(p.removed, ['print_123'], 'temporary print payload removed');
  assert.equal(p.document.getElementById('content').querySelector('h1').textContent, 'Print Title');
  assert.equal(p.document.title, 'My Doc');
  // Rendering remains available for repeated manual prints after cache removal.
  assert.equal(p.document.getElementById('content').querySelector('p').textContent, 'body text');
});

test('BUG-12 no id renders the fallback message without touching storage', t => {
  const p = printPage(t, '');
  assert.equal(p.removed.length, 0);
  assert.match(p.document.getElementById('content').textContent, /无法读取打印内容/);
});
