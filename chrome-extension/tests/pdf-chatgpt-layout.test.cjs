const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function loadScripts(window, filter) {
  for (const script of manifest.content_scripts[0].js) {
    if (filter && !filter(script)) continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
}

// ── Group 1: single tilde is literal; only ~~...~~ becomes <del> ──
test('L1 single-tilde ranges stay literal; only double-tilde becomes <del>', t => {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  loadScripts(dom.window, s => s !== 'src/content/content.js' && !s.includes('/platforms/'));
  const md = '506M token 大约相当于 1~2 GB 的清洗后纯文本（动辄 1T~10T tokens，比它大 3~4 个数量级），保留真正的 ~~已废弃方案~~。';
  const html = dom.window.ChatSavorMarkdown.render(md);
  assert.ok(html.includes('1~2 GB'), '1~2 GB intact');
  assert.ok(html.includes('1T~10T'), '1T~10T intact');
  assert.ok(html.includes('3~4'), '3~4 intact');
  const holder = dom.window.document.createElement('div');
  holder.innerHTML = html;
  const dels = holder.querySelectorAll('del');
  assert.equal(dels.length, 1, 'exactly one <del>');
  assert.equal(dels[0].textContent, '已废弃方案');
});

// ── Group 2: print CSS specificity / no overflow / print typography ──
test('L2 print.html has high-specificity margins, fixed table layout and typography', t => {
  const html = fs.readFileSync(path.join(root, 'src/export/print.html'), 'utf8');
  assert.match(html, /\.print-frame\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(html, /\.print-frame\s*\{[^}]*max-width:\s*100%/);
  assert.match(html, /\.print-frame\s*>\s*tbody\s*>\s*tr\s*>\s*td\.page-body-cell\s*\{\s*padding:\s*0 18mm\s*!important/);
  assert.match(html, /#content img\s*\{[^}]*max-width:\s*100%/);
  assert.match(html, /#content th[^{]*\{[^}]*text-align:\s*left|#content th,\s*#content td\s*\{[^}]*text-align:\s*left/);
  assert.match(html, /#content th\s*\{[^}]*background:\s*#f8fafc/);
  assert.match(html, /#content pre[^{]*#content tr[^{]*#content blockquote[^{]*#content img\s*\{[^}]*break-inside:\s*avoid/);
  assert.match(html, /#content table\s*\{[^}]*border-collapse:\s*collapse/);
  assert.match(html, /@media print/);
  assert.match(html, /@page\s*\{[^}]*margin:\s*0/);
});

// ── Group 3: Doubao 5-level nested table decoration header ──
test('L3 Doubao strips 表格 header through 3+ nested wrappers', t => {
  const dom = new JSDOM('<!doctype html><html><head><title>豆包</title></head><body><main><div data-message-list-item-id="block_9"><div class="relative flex-row flex w-full" data-message-id="9"><div class="mdbox-table-container"><div class="mdbox-table-header"><div class="title">表格</div><div class="icons"><svg></svg></div></div><div class="mdbox-table-body"><div class="scroll-area"><div class="inner"><table><thead><tr><th>维度</th><th>换算结果</th></tr></thead><tbody><tr><td>中文汉字</td><td>约 5 亿</td></tr></tbody></table></div></div></div></div></div></div></main></body></html>', {
    url: 'https://www.doubao.com/chat/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  loadScripts(dom.window, s => s === 'src/content/dom.js' || s.includes('/platform-base.js') || s.includes('/doubao.js') || s.endsWith('markdown.js') || s.endsWith('core.js') || s.endsWith('turndown.js') || s.endsWith('marked.js') || s.endsWith('katex.js'));
  const adapter = dom.window.ChatSavorAdapters.doubao;
  assert.ok(adapter);
  const reply = adapter.getResponses()[0];
  assert.ok(reply);
  const result = adapter.extractMarkdown(reply);
  assert.match(result.markdown, /\| 维度 \| 换算结果 \|/);
  assert.doesNotMatch(result.markdown, /^\s*表格\s*$/m);
});

// ── Group 4: safe SVG data URI preserved + malicious stripped ──
test('L4 valid data:image/svg+xml survives with CSS vars replaced; malicious src stripped', t => {
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  loadScripts(dom.window, s => s !== 'src/content/content.js' && !s.includes('/platforms/'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><g transform="translate(10,20)"><text fill="var(--color-text-prose)">32.0</text><text fill="var(--color-text-prose)">39.5</text></g></svg>';
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const main = dom.window.document.querySelector('main');
  main.innerHTML = '<img data-d-component="svg" src="' + uri + '">';
  const result = dom.window.ChatSavorMarkdown.extract(main);
  assert.match(result.markdown, /data:image\/svg\+xml;base64,/);
  const html = dom.window.ChatSavorMarkdown.render(result.markdown);
  const holder = dom.window.document.createElement('div');
  holder.innerHTML = html;
  const img = holder.querySelector('img[src^="data:image/svg+xml;base64,"]');
  assert.ok(img, 'base64 SVG image present');
  const svgText = atob(img.getAttribute('src').split(',')[1]);
  assert.ok(svgText.includes('32.0') && svgText.includes('39.5'));
  assert.ok(svgText.includes('#1f2937'), 'CSS variable replaced');
  assert.ok(!svgText.includes('var(--color-text-prose)'));
  // Malicious SVG must lose its src.
  const evil = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>x</text></svg>');
  const evilHtml = dom.window.ChatSavorMarkdown.render('![x](data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') + ')');
  assert.doesNotMatch(evilHtml, /<script/i);
  const evilHolder = dom.window.document.createElement('div');
  evilHolder.innerHTML = evilHtml;
  const evilImg = evilHolder.querySelector('img');
  if (evilImg) assert.doesNotMatch(evilImg.getAttribute('src') || '', /data:image\/svg\+xml/);
});

// ── Group 5: ChatGPT data-d-component cards ──
test('L5 segmented control, grid table with real headers and merged row', t => {
  const dom = new JSDOM('<!doctype html><html><head><title>ChatGPT</title></head><body><main><article data-message-author-role="assistant">' + [
    '<div data-d-component="segmented-control">',
    '<button role="radio" aria-checked="false">8 × 8</button>',
    '<button role="radio" aria-checked="true">16 × 16</button>',
    '<button role="radio" aria-checked="false">32 × 32</button></div>',
    '<div data-d-component="grid" style="grid-template-columns: repeat(2, 1fr)">',
    '<div><h4>Patch 总数量</h4><span>16</span></div>',
    '<div><h4>每个 Patch 像素数</h4><span>256</span></div></div>',
    '<div data-d-component="row"><span>数据集</span><span>ImageNet</span><span>准确率 82.4%</span></div>',
    '<div data-d-component="slider"><span></span></div>',
    '</article></main></body></html>'].join(''), {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  loadScripts(dom.window, null); // all scripts including chatgpt.js
  const adapter = dom.window.ChatSavorChatGPTAdapter;
  assert.ok(adapter);
  const result = adapter.extractMarkdown(adapter.getResponses()[0]);
  // D-02: segmented control now renders real DOM with fullwidth brackets, never a
  // leading \[ that could be misparsed as a display-math opener.
  assert.ok(result.markdown.includes('（8 × 8）'));
  assert.ok(result.markdown.includes('【✓ 16 × 16】'));
  assert.ok(result.markdown.includes('（32 × 32）'));
  assert.match(result.markdown, /Patch 总数量/);
  assert.match(result.markdown, /每个 Patch 像素数/);
  assert.doesNotMatch(result.markdown, /Column 1/);
  assert.match(result.markdown, /数据集\s*·\s*ImageNet\s*·\s*准确率 82\.4%/);
});

// ── Group 6: pending images delay auto-print ──
test('L6 pending images delay auto print until all loaded', async t => {
  const printHtml = fs.readFileSync(path.join(root, 'src/export/print.html'), 'utf8');
  const printJs = fs.readFileSync(path.join(root, 'src/export/print.js'), 'utf8');
  const dom = new JSDOM(printHtml, {
    url: 'https://chrome-extension.test/print.html?id=print_1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const prints = [];
  window.print = () => prints.push(1);
  const session = { print_1: { html: '<p>doc</p>', title: 'Doc' } };
  window.chrome = {
    storage: {
      session: { get(k, cb) { const o = {}; o.print_1 = session.print_1; cb(o); }, remove() {} },
      // No local: print.js must degrade safely.
    },
  };
  // Inject a not-yet-complete image after print.js renders content via a MutationObserver-free hook:
  // override DOMParser result so the imported node includes a pending image.
  const originalParse = window.DOMParser.prototype.parseFromString;
  window.DOMParser.prototype.parseFromString = function(markup, type) {
    if (type === 'text/html' && markup.includes('<p>doc</p>')) markup = '<p>doc</p><img id="slow" src="https://example.org/big.png">';
    return originalParse.call(this, markup, type);
  };
  window.eval(printJs);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  const img = window.document.getElementById('slow');
  assert.ok(img);
  Object.defineProperty(img, 'complete', { configurable: true, get: () => false });
  await new Promise(r => setTimeout(r, 700));
  assert.equal(prints.length, 0, 'no auto print while image pending');
  assert.match(window.document.getElementById('status').textContent, /正在加载图片/);
  img.dispatchEvent(new window.Event('load'));
  await new Promise(r => setTimeout(r, 700));
  assert.equal(prints.length, 1, 'auto print after image load');
});
