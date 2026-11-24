const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function page(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window: dom.window, document: dom.window.document, core: dom.window.ChatSavorCore, docx: dom.window.ChatSavorDocx };
}

async function blobBytes(blob, window) {
  const buf = await new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

test('T3.3 docx builder produces a valid ZIP with OOXML parts', async t => {
  const p = page(t);
  assert.ok(p.docx, 'ChatSavorDocx should be loaded from manifest');
  const blob = p.docx.build('# Heading\n\n**bold** and *italic* text\n\n| A | B |\n|---|---|\n| 1 | 2 |');
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const bytes = await blobBytes(blob, p.window);
  assert.equal(bytes[0], 0x50, 'PK signature');
  assert.equal(bytes[1], 0x4B);
  // Parse central directory names from raw bytes (Store mode, no compression).
  const text = Buffer.from(bytes).toString('latin1');
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/document.xml']) {
    assert.ok(text.includes(part), `docx should contain ${part}`);
  }
  assert.ok(text.includes('<w:pStyle w:val="Heading1"/>'));
  assert.ok(text.includes('<w:tbl>'));
});

test('T3.3 single-file HTML export includes inline CSS and sanitized body', async t => {
  const p = page(t);
  let captured = null;
  const orig = p.window.URL.createObjectURL;
  p.window.URL.createObjectURL = function (blob) { captured = blob; return 'blob:x'; };
  const origClick = p.window.HTMLAnchorElement.prototype.click;
  p.window.HTMLAnchorElement.prototype.click = function () {};
  t.after(() => { p.window.URL.createObjectURL = orig; p.window.HTMLAnchorElement.prototype.click = origClick; });
  p.core.showPreviewModal('# Hello');
  const shadow = p.document.querySelector('.ai-saver-modal-host').shadowRoot;
  [...shadow.querySelectorAll('button')].find(b => b.textContent === '.html').click();
  assert.ok(captured);
  const html = await new Promise((resolve, reject) => {
    const reader = new p.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(captured);
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /<h1[^>]*>Hello<\/h1>/);
  assert.doesNotMatch(html, /<script/i);
});

test('T3.3 print page assets exist and background handles print message', async t => {
  const html = fs.readFileSync(path.join(root, 'src/export/print.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'src/export/print.js'), 'utf8');
  assert.match(html, /@media print/);
  assert.match(html, /break-inside: avoid/);
  assert.match(js, /storage\.session\.get/);
  const bg = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
  assert.match(bg, /CHATSAVOR_OPEN_PRINT/);
  assert.match(bg, /print\.html\?id=/);
});
