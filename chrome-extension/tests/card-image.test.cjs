const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
function cardPage(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root, 'src/lib/card-image.js'), 'utf8'));
  return dom.window;
}

test('U5 three themes expose distinct palettes', t => {
  const w = cardPage(t);
  const th = w.ChatSavorCardImage.THEMES;
  assert.ok(th.light && th.dark && th.paper);
  assert.equal(th.light.bg, '#ffffff');
  assert.equal(th.dark.bg, '#0f172a');
  assert.equal(th.paper.bg, '#fbf8f1');
  assert.match(th.paper.titleFont, /Georgia/);
});

test('U5 strict XHTML serialization is valid XML with void tags and MathML/SVG preserved', t => {
  const w = cardPage(t);
  const holder = w.document.createElement('div');
  holder.innerHTML = '<p>line<br>break<hr><img src="data:image/png;base64,AAAA"><input type="checkbox" checked disabled></p>' +
    '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math>' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"></circle></svg>';
  const xhtml = w.ChatSavorCardImage.serializeStrictXhtml(holder);
  const parsed = new w.DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  assert.equal(parsed.querySelector('parsererror'), null, 'strict XHTML has no parse errors');
  assert.ok(parsed.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'mi').length >= 1, 'MathML namespace preserved');
  assert.ok(parsed.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'circle').length >= 1, 'SVG namespace preserved');
});

test('U5 buildCardSlicesDom produces valid XHTML per slice for complex html', t => {
  const w = cardPage(t);
  const html = '<p>段落一</p><pre><code>x = 1</code></pre><p>段落二<br>换行</p><img src="data:image/png;base64,AAAA"><blockquote>引用</blockquote>';
  const slices = w.ChatSavorCardImage.buildCardSlicesDom(html, { title: '标题', platform: 'ChatGPT', datetime: '2026-11-24' }, { theme: 'paper' });
  assert.ok(slices.length >= 1);
  slices.forEach(slice => {
    const parsed = new w.DOMParser().parseFromString(slice.xhtml, 'application/xhtml+xml');
    assert.equal(parsed.querySelector('parsererror'), null, 'slice XHTML valid');
    assert.ok(slice.svgDataUrl.startsWith('data:image/svg+xml'));
  });
});

test('U5 computeSlices cuts only between blocks, never inside one', t => {
  const w = cardPage(t);
  const blocks = [];
  for (let i = 0; i < 20; i++) blocks.push({ index: i, top: i * 500, bottom: i * 500 + 480, height: 480 });
  const slices = w.ChatSavorCardImage.computeSlices(blocks, 7200);
  assert.ok(slices.length >= 2, 'long content split');
  const seen = new Set();
  slices.forEach(s => s.forEach(b => { assert.ok(!seen.has(b.index)); seen.add(b.index); }));
  assert.equal(seen.size, blocks.length, 'every block appears exactly once');
  slices.forEach(s => assert.ok(s.reduce((sum, b) => sum + b.height, 0) <= 7200 || s.length === 1, 'no slice exceeds limit unless single block'));
  const single = w.ChatSavorCardImage.computeSlices([{ index: 0, height: 9000 }], 7200);
  assert.equal(single.length, 1, 'single oversized block stands alone');
});

test('C1 SVG viewport has zero hardcoded 600px and preserves 1:1 aspect ratio', t => {
  const w = cardPage(t);
  const html = '<h1>标题</h1>' + Array.from({ length: 20 }, (_, i) => `<p>这是第 ${i} 段正文，用于撑起足够的高度。</p>`).join('') +
    '<pre><code>const x = 1;</code></pre>' + '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
    '<div class="chatsavor-math">$E=mc^2$</div>';
  const slices = w.ChatSavorCardImage.buildCardSlicesDom(html, { title: '标题', platform: 'ChatGPT' }, { theme: 'light' });
  assert.ok(slices.length >= 1);
  slices.forEach(slice => {
    const svgText = decodeURIComponent(slice.svgDataUrl.split(',')[1]);
    const parsed = new w.DOMParser().parseFromString(svgText, 'image/svg+xml');
    assert.equal(parsed.querySelector('parsererror'), null);
    const svg = parsed.documentElement;
    assert.notEqual(svg.getAttribute('height'), '600', 'no hardcoded 600px height');
    assert.equal(svg.getAttribute('height'), String(slice.pixelHeight));
    assert.equal(svg.getAttribute('width'), String(slice.pixelWidth));
    assert.equal(svg.getAttribute('viewBox'), '0 0 ' + slice.outerWidth + ' ' + slice.outerHeight);
    const fo = svg.getElementsByTagName('foreignObject')[0];
    assert.equal(fo.getAttribute('width'), String(slice.outerWidth));
    assert.equal(fo.getAttribute('height'), String(slice.outerHeight));
    assert.ok(Math.abs((slice.pixelWidth / slice.pixelHeight) - (slice.outerWidth / slice.outerHeight)) < 0.002);
  });
});

test('C1 serialized XHTML contains .cs-card-stage root and never relies on missing <body>', t => {
  const w = cardPage(t);
  const slices = w.ChatSavorCardImage.buildCardSlicesDom('<p>正文</p><table><tr><th>H</th></tr><tr><td>V</td></tr></table>', { title: 'T', platform: 'ChatGPT' }, { theme: 'dark' });
  slices.forEach(slice => {
    const parsed = new w.DOMParser().parseFromString(slice.xhtml, 'application/xhtml+xml');
    assert.equal(parsed.querySelector('parsererror'), null);
    assert.ok(slice.xhtml.includes('class="cs-card-stage"'));
    assert.ok(slice.xhtml.includes('class="card"'));
    const style = parsed.getElementsByTagName('style')[0];
    const css = style.textContent;
    assert.match(css, /\.cs-card-stage/);
    assert.match(css, /\.card/);
    assert.match(css, /table/);
    assert.match(css, /th,\s*td/);
    assert.doesNotMatch(css, /body\s*\{/);
  });
});

test('C1 whitespace newline text nodes between blocks do not inflate height', t => {
  const w = cardPage(t);
  const compact = '<p>段落A</p><p>段落B</p><p>段落C</p>';
  const padded = '<p>段落A</p>\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n<p>段落B</p>\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n<p>段落C</p>';
  const s1 = w.ChatSavorCardImage.buildCardSlicesDom(compact, { title: 'T' }, { theme: 'light' });
  const s2 = w.ChatSavorCardImage.buildCardSlicesDom(padded, { title: 'T' }, { theme: 'light' });
  assert.equal(s1[0].outerHeight, s2[0].outerHeight, 'whitespace newlines must not inflate height');
});

test('C1 prepareHtmlForCard normalizes viewBox-only SVG data URIs and neutralizes external images', t => {
  const w = cardPage(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 680 510"><text>Stage 1</text></svg>';
  const b64 = Buffer.from(svg).toString('base64');
  const html = '<img src="data:image/svg+xml;base64,' + b64 + '"><img src="https://example.com/fail.png" alt="示意图">';
  const out = w.ChatSavorCardImage.prepareHtmlForCard(html);
  const holder = w.document.createElement('div');
  holder.innerHTML = out;
  const svgImg = holder.querySelector('img[src^="data:image/svg+xml"]');
  assert.ok(svgImg);
  assert.equal(svgImg.getAttribute('width'), '680');
  assert.equal(svgImg.getAttribute('height'), '510');
  assert.ok(svgImg.classList.contains('svg-diagram-img'));
  // Decode the rewritten data URI and verify the inner <svg> has width/height.
  const decoded = Buffer.from(svgImg.getAttribute('src').split(',')[1], 'base64').toString('utf8');
  assert.match(decoded, /width="680"/);
  assert.match(decoded, /height="510"/);
  // External image replaced by fallback, no http img remains.
  assert.equal(holder.querySelectorAll('img[src^="https://"]').length, 0);
  assert.ok(holder.querySelector('.img-fallback'));
  assert.ok(holder.querySelector('.img-fallback').textContent.includes('示意图'));
});

test('C1 renderToBlobs draws onto exact pixelWidth x pixelHeight canvas without stretching', async t => {
  const w = cardPage(t);
  const draws = [];
  w.Image = function () {
    const img = {};
    img.setAttribute = () => {};
    img.style = {};
    Object.defineProperty(img, 'src', { set(val) { setTimeout(() => img.onload && img.onload(), 0); } });
    return img;
  };
  const origCreate = w.document.createElement;
  const canvases = [];
  w.document.createElement = function (tag) {
    const el = origCreate.call(this, tag);
    if (tag === 'canvas') {
      canvases.push(el);
      const ctx = {
        fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: '',
        fillRect: (x, y, ww, hh) => draws.push({ op: 'fillRect', x, y, w: ww, h: hh }),
        drawImage: (img, x, y, dw, dh) => draws.push({ op: 'drawImage', dw, dh }),
      };
      el.getContext = () => ctx;
      el.toBlob = (cb) => cb(new w.Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    }
    return el;
  };
  const result = await w.ChatSavorCardImage.renderToBlobs('# 测试标题\n\n正文第一段\n\n| A | B |\n|---|---|\n| 1 | 2 |', { title: '测试', platform: 'ChatGPT' }, { theme: 'dark' });
  assert.ok(result.slices.length >= 1);
  const slice = result.slices[0];
  const canvas = canvases.find(c => c.width === slice.pixelWidth && c.height === slice.pixelHeight);
  assert.ok(canvas, 'canvas created at exact pixel dimensions');
  const draw = draws.find(d => d.op === 'drawImage');
  assert.ok(draw);
  assert.equal(draw.dw, slice.pixelWidth);
  assert.equal(draw.dh, slice.pixelHeight);
  assert.equal(canvas.width, slice.pixelWidth);
  assert.equal(canvas.height, slice.pixelHeight);
  const fill = draws.find(d => d.op === 'fillRect');
  assert.ok(fill, 'canvas background filled before draw');
  assert.equal(fill.w, slice.pixelWidth);
  assert.equal(fill.h, slice.pixelHeight);
  w.document.createElement = origCreate;
});
