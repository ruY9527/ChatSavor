const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
function evalLib(w, file) { w.eval(fs.readFileSync(path.join(root, file), 'utf8')); }

function fullPage(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chatgpt.com/c/1', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  ['src/lib/katex.js', 'src/lib/zip.js', 'src/lib/omml.js', 'src/lib/docx-builder.js',
    'src/lib/turndown.js', 'src/lib/marked.js', 'src/content/markdown.js', 'src/lib/latex-builder.js'].forEach(f => evalLib(w, f));
  return w;
}

test('U2 complex markdown yields valid OOXML with native OMML nodes and no annotation leak', t => {
  const w = fullPage(t);
  const md = [
    'Intro $E = mc^2$ text.',
    '$$\\text{Attention}(Q,K,V) = \\text{Softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$',
    '$$\\sum_{i=1}^{N} E_i^2$$',
    'Inline $\\hat{X}_t$ and $\\sqrt{x}$ and $\\begin{matrix}a & b\\\\ c & d\\end{matrix}$.',
  ].join('\n\n');
  const xml = w.ChatSavorDocx.markdownToDocumentXml(md);
  assert.match(xml, /xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/);
  assert.match(xml, /<m:oMathPara>/);
  assert.match(xml, /<m:oMath>/);
  assert.match(xml, /<m:f>/, 'fraction');
  assert.match(xml, /<m:rad>/, 'radical');
  assert.match(xml, /<m:sSup>|<m:sSub>/, 'script');
  assert.match(xml, /<m:nary>/, 'sum operator');
  assert.match(xml, /<m:acc>/, 'hat accent');
  assert.doesNotMatch(xml, /<annotation|application\/x-tex/, 'no TeX annotation leak');
  const parsed = new w.DOMParser().parseFromString(xml, 'application/xml');
  assert.equal(parsed.querySelector('parsererror'), null, 'generated XML is well formed');
});

test('U2 docx-builder standalone eval fallback keeps legacy API', t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  evalLib(dom.window, 'src/lib/docx-builder.js'); // no katex/omml/zip
  const api = dom.window.ChatSavorDocx;
  assert.ok(api && api.build && api.crc32 && api.zip && api.markdownToDocumentXml && api.stylesXml);
  const xml = api.markdownToDocumentXml('plain $x$ text');
  assert.match(xml, /\$x\$/, 'inline math falls back to literal text');
  assert.equal(new dom.window.DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'), null);
});

test('U3 latex export escapes text, preserves math and emits longtable', t => {
  const w = fullPage(t);
  const md = [
    '# 中文标题 % & $ # _ { } ~ ^ \\',
    '正文含 50% & 90% 与 a_b^c #tag。',
    '$D_{KL}(P\\|Q) = \\sum_i P_i \\log \\frac{P_i}{Q_i}$',
    '$$E = mc^2$$',
    '| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |',
    '```python\n# 中文注释\nx = 1\n```',
  ].join('\n\n');
  const tex = w.ChatSavorLatex.build(md, { title: '标题 % 测试', datetime: '2026-11-24 10:00' });
  assert.match(tex, /% !TEX program = xelatex/);
  assert.match(tex, /\\documentclass\[11pt,a4paper\]\{ctexart\}/);
  assert.match(tex, /50\\% \\& 90\\%/);
  // escapeText itself must handle _ and ^ in one pass (standalone assertion).
  assert.equal(w.ChatSavorLatex.escapeText('a_b^c'), 'a\\_b\\textasciicircum{}c');
  assert.ok(tex.includes('D_{KL}(P\\|Q) = \\sum_i P_i \\log \\frac{P_i}{Q_i}'), 'math source unmodified');
  assert.match(tex, /\\begin\{equation\*\}/);
  assert.match(tex, /\\begin\{longtable\}/);
  assert.match(tex, /\\toprule/); assert.match(tex, /\\midrule/); assert.match(tex, /\\bottomrule/);
  assert.match(tex, /\\begin\{verbatim\}/, 'CJK code block uses verbatim');
  // escapeText single-pass: backslash replacement must not re-escape its braces.
  assert.equal(w.ChatSavorLatex.escapeText('\\'), '\\textbackslash{}');
});
