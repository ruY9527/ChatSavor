const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function fullPage(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    w.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return w;
}

test('D1 Recharts SVG with existing style never gains a duplicate style attribute', t => {
  const w = fullPage(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" style="width:100%;height:100%;display:block"><rect width="10" height="10" fill="var(--color-text-prose)"/><text x="1" y="1">1</text><text x="2" y="2">2</text></svg>';
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const holder = w.document.createElement('div');
  holder.innerHTML = '<img src="' + uri + '">';
  const out = w.ChatSavorMarkdown.extract(holder);
  assert.ok(out.markdown.includes('data:image/svg+xml;base64,'));
  const b64 = out.markdown.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)[1];
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  const styleCount = (decoded.match(/ style=/g) || []).length;
  assert.ok(styleCount <= 1, 'no duplicate style attribute');
  const parsed = new w.DOMParser().parseFromString(decoded, 'image/svg+xml');
  assert.equal(parsed.querySelector('parsererror'), null, 'SVG XML parses cleanly');
  assert.match(decoded, /#1f2937/, 'CSS variable frozen');
});

test('D2 a literal leading \\[ does not swallow following sections', t => {
  const w = fullPage(t);
  const md = '\\[8 × 8\\] · **（16 × 16）** · （32 × 32）\n\n## 后续章节\n\n这是第二节正文，不应被吞进公式。\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  const xml = w.ChatSavorDocx.markdownToDocumentXml(md);
  assert.ok(xml.includes('后续章节'), 'second heading preserved');
  assert.ok(xml.includes('第二节正文'), 'body preserved');
  assert.ok(xml.includes('<w:tbl>'), 'table preserved');
  assert.doesNotMatch(xml, /\$\$8 × 8/, 'no stray $$ wrapper');
});

test('D3 block math wraps <m:oMathPara><m:oMath> and sum absorbs operand', t => {
  const w = fullPage(t);
  const omml = w.ChatSavorOmml.latexToOmml('\\sum_{i=1}^{N} E_i^2', true);
  assert.ok(omml.startsWith('<m:oMathPara><m:oMath>'), 'oMathPara contains oMath');
  assert.ok(omml.endsWith('</m:oMath></m:oMathPara>'));
  assert.ok(omml.includes('<m:nary>'));
  assert.ok(omml.includes('<m:chr m:val="∑"/>'));
  // The operand E_i^2 must be inside <m:e> (absorbed), not floating after the nary.
  const eIdx = omml.indexOf('<m:e>');
  const eEnd = omml.indexOf('</m:e>', eIdx);
  assert.ok(eIdx >= 0 && eEnd > eIdx);
  const eContent = omml.slice(eIdx + '<m:e>'.length, eEnd);
  assert.ok(eContent.includes('<m:sSubSup>') || eContent.includes('E'), 'operand absorbed into <m:e>');
  assert.match(eContent, /E/);
  // hat accent
  const hat = w.ChatSavorOmml.latexToOmml('\\hat{x}', false);
  assert.match(hat, /<m:acc>/);
});

test('D4 buildAsync embeds word/media/*.png with no Base64 leak in document.xml', async t => {
  const w = fullPage(t);
  // Mock Image + canvas rasterization (JSDOM has no real image decode).
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1]);
  w.Image = function () {
    const img = {};
    Object.defineProperty(img, 'src', { set(v) { setTimeout(() => { img.naturalWidth = 200; img.naturalHeight = 100; img.onload && img.onload(); }, 0); } });
    return img;
  };
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = function (tag) {
    const el = origCreate(tag);
    if (tag === 'canvas') {
      const ctx = { fillStyle: '', fillRect() {}, drawImage() {} };
      el.getContext = () => ctx;
      el.toBlob = (cb) => cb(new w.Blob([pngBytes], { type: 'image/png' }));
    }
    return el;
  };
  t.after(() => { try { w.document.createElement = origCreate; } catch (ignored) {} });
  // SVG image forces async pipeline.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text x="1" y="1">a</text><text x="2" y="2">b</text></svg>';
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const md = '# 标题\n\n正文\n\n![图表](' + uri + ')';
  assert.equal(w.ChatSavorDocx.needsAsyncMedia(md), true);
  const blob = await w.ChatSavorDocx.buildAsync(md);
  const bytes = await new Promise((resolve) => { const r = new w.FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('word/media/image1.png'), 'media part present');
  assert.ok(text.includes('word/_rels/document.xml.rels'), 'image relationship present');
  assert.ok(!text.includes('data:image/svg+xml;base64'), 'no Base64 leak in whole zip');
  assert.match(text, /<w:drawing>/);
  assert.match(text, /wp:inline/);
});

test('D5 table uses 9026 dxa total width and <w:br/> for breaks', t => {
  const w = fullPage(t);
  const md = '| A | B | C | D |\n|---|---|---|---|\n| 1<br>2 | 3 | 4 | 5 |\n\n---\n\n后续段落';
  const xml = w.ChatSavorDocx.markdownToDocumentXml(md);
  assert.match(xml, /<w:tblW w:w="9026"/);
  assert.ok(xml.includes('<w:br/>'), 'literal <br> becomes w:br');
  assert.doesNotMatch(xml, /&lt;br&gt;/, 'no escaped br');
  assert.match(xml, /<w:pBdr>/, 'horizontal rule becomes border');
  assert.doesNotMatch(xml, /<w:t[^>]*>---<\/w:t>/, 'no literal ---');
});

test('D6 ChatGPT grid preserves SVGs, separates multi-line cards and skips all-empty rows', t => {
  const dom = new JSDOM('<!doctype html><html><head><title>ChatGPT</title></head><body><main><article data-message-author-role="assistant">' + [
    '<div data-d-component="grid" style="grid-template-columns: repeat(2, 1fr)">',
    '<div><div class="card-title">方法A</div><div class="card-body">第一行文字</div><div>第二行文字</div></div>',
    '<div><div class="card-title">方法B</div><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg></div></div>',
    '</article></main></body></html>'].join(''), {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    w.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  // Load chatgpt.js adapter directly.
  w.eval(fs.readFileSync(path.join(root, 'src/content/platforms/chatgpt.js'), 'utf8'));
  const adapter = w.ChatSavorChatGPTAdapter;
  assert.ok(adapter);
  const result = adapter.extractMarkdown(adapter.getResponses()[0]);
  assert.match(result.markdown, /方法A/);
  assert.match(result.markdown, /方法B/);
  assert.match(result.markdown, /data:image\/svg\+xml/, 'grid SVG preserved as image');
  assert.doesNotMatch(result.markdown, /第一行文字第二行文字/, 'multi-line divs not concatenated');
  assert.doesNotMatch(result.markdown, /\|\s*\|\s*\|\s*\|/, 'no all-empty row');
});
