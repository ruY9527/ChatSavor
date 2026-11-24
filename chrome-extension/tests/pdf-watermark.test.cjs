const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/export/print.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/export/print.js'), 'utf8');

function printPage(t, opts = {}) {
  const dom = new JSDOM(html, {
    url: 'https://chrome-extension.test/src/export/print.html?id=print_abc123',
    runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.clearTimeout && dom.window.close());
  const { window } = dom;
  const prints = [];
  window.print = () => prints.push(Date.now());
  const localStore = {};
  const sessionStore = {
    print_abc123: {
      html: '<h1>Doc Title</h1><p>Body</p>',
      title: 'Doc Title', platform: 'DeepSeek', datetime: '2026-11-24 14:30',
    },
  };
  const prefs = Object.assign({}, opts.prefs);
  window.chrome = {
    storage: {
      session: {
        get(key, cb) { const out = {}; Object.keys(key).forEach(k => { out[k] = sessionStore[k]; }); cb(out); },
        remove(key) { delete sessionStore[key]; },
      },
      local: {
        get(key, cb) { const out = {}; out[key] = prefs[key] !== undefined ? JSON.stringify(prefs[key]) : undefined; setImmediate(() => cb(out)); },
        set(obj, cb) { Object.assign(localStore, obj); if (obj.prefs) Object.assign(prefs, JSON.parse(obj.prefs)); if (cb) cb(); },
      },
    },
  };
  window.eval(js);
  return { window, document: window.document, prints, prefs, localStore, sessionStore };
}

const flush = () => new Promise(r => setImmediate(r));
async function loaded(t, opts) {
  const p = printPage(t, opts);
  await flush(); await flush();
  return p;
}

test('P-01 default @page margin 0 and print-frame skeleton do not style outer frame', t => {
  assert.match(html, /@page\s*\{[^}]*margin:\s*0/, 'default @page margin 0 hides chrome-extension URL footer');
  assert.match(html, /@media print/);
  assert.match(html, /break-inside: avoid/);
  assert.match(html, /class="print-frame"/);
  const frameHtml = html.match(/<table class="print-frame"[\s\S]*?<\/table>/)[0];
  assert.match(frameHtml, /<thead>/);
  assert.match(frameHtml, /<tfoot>/);
  assert.match(frameHtml, /id="running-header"/);
  assert.match(frameHtml, /id="running-footer"/);
  assert.match(frameHtml, /id="content"/);
  // Only #content tables get borders/break-inside, never .print-frame.
  assert.match(html, /#content table\s*\{[^}]*border-collapse/);
  assert.doesNotMatch(html, /\.print-frame[^@]*break-inside/);
});

test('P-01 footer modes none / source / custom update live', async t => {
  const p = await loaded(t);
  const d = p.document;
  const footer = d.getElementById('running-footer');
  const header = d.getElementById('running-header');
  assert.equal(footer.textContent, '');
  const mode = d.getElementById('footerMode');
  mode.value = 'source';
  mode.dispatchEvent(new p.window.Event('change'));
  assert.match(header.textContent, /Doc Title/);
  assert.match(footer.textContent, /来源：DeepSeek/);
  assert.match(footer.textContent, /2026-11-24 14:30/);
  mode.value = 'custom';
  mode.dispatchEvent(new p.window.Event('change'));
  const text = d.getElementById('footerText');
  assert.notEqual(text.style.display, 'none', 'custom text input shows');
  text.value = '内部资料 · 第 1 版';
  text.dispatchEvent(new p.window.Event('input'));
  assert.equal(footer.textContent, '内部资料 · 第 1 版');
  mode.value = 'none';
  mode.dispatchEvent(new p.window.Event('change'));
  assert.equal(footer.textContent, '');
});

test('P-01 SVG watermark renders safely and opacity updates live', async t => {
  const p = await loaded(t);
  const d = p.document;
  const layer = d.getElementById('watermark-layer');
  assert.equal(layer.querySelectorAll('svg').length, 0, 'no watermark by default');
  const mode = d.getElementById('watermarkMode');
  mode.value = 'tiled';
  mode.dispatchEvent(new p.window.Event('change'));
  const text = d.getElementById('watermarkText');
  text.value = '内部资料 <script>alert(1)</script>';
  text.dispatchEvent(new p.window.Event('input'));
  assert.equal(layer.querySelectorAll('svg').length, 1);
  assert.equal(layer.querySelectorAll('pattern').length, 1);
  assert.equal(layer.querySelectorAll('script').length, 0, 'XSS payload is inert text, never an element');
  const label = layer.querySelector('pattern text');
  assert.equal(label.textContent, '内部资料 <script>alert(1)</script>');
  const before = parseFloat(label.getAttribute('fill-opacity'));
  const opacity = d.getElementById('watermarkOpacity');
  opacity.value = '0.15';
  opacity.dispatchEvent(new p.window.Event('input'));
  assert.equal(parseFloat(layer.querySelector('pattern text').getAttribute('fill-opacity')), 0.15);
  assert.ok(parseFloat(layer.querySelector('pattern text').getAttribute('fill-opacity')) > before);
  mode.value = 'corner';
  mode.dispatchEvent(new p.window.Event('change'));
  assert.equal(layer.querySelectorAll('svg').length, 0, 'corner mode uses a lightweight corner badge');
  assert.ok(layer.textContent.includes('内部资料'));
});

test('P-01 user interaction cancels auto print, prefs persist, manual print still works', async t => {
  const p = await loaded(t);
  const p0 = p.prints.length;
  await new Promise(r => setTimeout(r, 700));
  assert.equal(p.prints.length, p0 + 1, 'auto print fired when untouched');
  // A fresh page: interact before the 600ms timer fires.
  const p2 = await loaded(t);
  const mode = p2.document.getElementById('watermarkMode');
  mode.value = 'tiled';
  mode.dispatchEvent(new p2.window.Event('change'));
  const text = p2.document.getElementById('watermarkText');
  text.value = '机密';
  text.dispatchEvent(new p2.window.Event('input'));
  const footer = p2.document.getElementById('footerMode');
  footer.value = 'source';
  footer.dispatchEvent(new p2.window.Event('change'));
  await new Promise(r => setTimeout(r, 700));
  assert.equal(p2.prints.length, 0, 'user interaction cancelled the auto-print timer');
  await flush();
  assert.equal(p2.prefs.pdfWatermarkMode, 'tiled');
  assert.equal(p2.prefs.pdfWatermarkText, '机密');
  assert.equal(p2.prefs.pdfFooterMode, 'source');
  p2.document.getElementById('print').dispatchEvent(new p2.window.MouseEvent('click', { bubbles: true }));
  assert.equal(p2.prints.length, 1, 'manual print button still works');
});
