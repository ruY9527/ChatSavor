const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function setup(t, html = '') {
  const dom = new JSDOM('<!doctype html><main></main>', {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only',
    virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js' || script.includes('/platforms/')) continue;
    dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  const { window } = dom;
  const { document } = window;
  const container = document.querySelector('main');
  container.innerHTML = html;
  const tools = window.ChatSavorMarkdown;
  return {
    window, document, tools, container,
    extract: () => tools.extract(container),
    rendered: markdown => {
      const result = document.createElement('div');
      result.innerHTML = tools.render(markdown);
      return result;
    },
  };
}

function formulas(page, markdown) {
  return JSON.parse(JSON.stringify(page.tools.getFormulas(markdown)));
}

test('recovers KaTeX source once and preserves subscripts, powers and TeX backslashes', t => {
  const page = setup(t);
  const latex = String.raw`x_i^2 + \frac{\alpha}{\sqrt{1+\beta}}`;
  page.container.innerHTML = '<p>公式 ' + page.window.katex.renderToString(latex) + ' 是原始结果。</p>';
  const output = page.extract();
  assert.equal(output.markdown, `公式 $${latex}$ 是原始结果。`);
  assert.deepEqual(formulas(page, output.markdown), [{ latex, display: false }]);
  const rendered = page.rendered(output.markdown);
  assert.equal(rendered.querySelectorAll('math').length, 1);
  assert.equal(rendered.querySelectorAll('.math-error').length, 0);
  assert.equal(rendered.querySelector('annotation').textContent, latex);
  assert.doesNotMatch(output.markdown, /katex|CHATSAVORMATH|<math/);
});

test('preserves multiline aligned equations and matrix row separators in display math', t => {
  const page = setup(t);
  const latex = String.raw`\begin{aligned}
A &= \begin{bmatrix}1 & 2\\3 & 4\end{bmatrix}\\
f(x) &= \frac{1}{2}x^2
\end{aligned}`;
  page.container.innerHTML = page.window.katex.renderToString(latex, { displayMode: true });
  const { markdown } = page.extract();
  assert.equal(markdown, `$$\n${latex}\n$$`);
  const rendered = page.rendered(markdown);
  assert.equal(rendered.querySelector('math').getAttribute('display'), 'block');
  assert.equal(rendered.querySelector('annotation').textContent, latex);
});

test('normalizes raw parentheses, brackets and dollar delimiters outside code only', t => {
  const page = setup(t, String.raw`<p>行内 \(a_i^2\)、$b_j$。</p><p>\[\frac{a}{b}\]</p><p>$$c^2$$</p>
    <pre><code class="language-tex">\(do_not_convert\) $$code$$</code></pre><p><code>$also_code$</code></p>`);
  const { markdown } = page.extract();
  assert.match(markdown, /行内 \$a_i\^2\$、\$b_j\$/);
  assert.match(markdown, /\$\$\n\\frac\{a\}\{b\}\n\$\$/);
  assert.match(markdown, /```tex\n\\\(do_not_convert\\\) \$\$code\$\$/);
  assert.match(markdown, /`\$also_code\$`/);
  assert.deepEqual(formulas(page, markdown).map(f => f.latex), [String.raw`a_i^2`, 'b_j', String.raw`\frac{a}{b}`, 'c^2']);
});

test('extracts MathJax 2 script sources without exporting its preview twice', t => {
  const page = setup(t, String.raw`<p><span class="MathJax_Preview">visual preview</span><span class="MathJax">rendered duplicate</span><script type="math/tex">\sum_{i=1}^n i</script></p>
    <div class="MathJax_Display">display duplicate</div><script type="math/tex; mode=display">\int_0^1 x\,dx</script>`);
  const { markdown } = page.extract();
  assert.deepEqual(formulas(page, markdown), [
    { latex: String.raw`\sum_{i=1}^n i`, display: false },
    { latex: String.raw`\int_0^1 x\,dx`, display: true },
  ]);
  assert.doesNotMatch(markdown, /duplicate|preview|script/);
});

test('extracts MathJax containers, TeX attributes and MathML alttext', t => {
  const page = setup(t, String.raw`<p><mjx-container data-tex="\theta_i"><svg><text>wrong visual</text></svg></mjx-container>
    <span data-latex="\mathbb{R}^n">wrong visual</span>
    <math alttext="\gamma"><mi>γ</mi></math></p>`);
  const { markdown } = page.extract();
  assert.deepEqual(formulas(page, markdown).map(f => f.latex), [String.raw`\theta_i`, String.raw`\mathbb{R}^n`, String.raw`\gamma`]);
  assert.doesNotMatch(markdown, /wrong visual/);
});

test('preserves source-less MathML with a visible compatibility warning', t => {
  const page = setup(t, '<p>Unknown source <math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>.</p>');
  const { markdown } = page.extract();
  assert.match(markdown, /data-chatsavor-unconverted-math/);
  assert.match(markdown, /<mfrac>/);
  page.window.ChatSavorCore.showPreviewModal(markdown);
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.match(shadow.querySelector('.compatibility').textContent, /缺少 LaTeX 源码/);
});

test('table formulas, norms and pipe characters survive Markdown parsing', t => {
  const page = setup(t, String.raw`<table><tr><th>公式</th><th>内容</th></tr><tr>
    <td><span data-latex="\left|x\right|+\|v\|">visual</span></td>
    <td><code>a|b</code><br><strong>bold</strong> <a href="https://example.com">link</a></td></tr></table>`);
  const { markdown } = page.extract();
  const rendered = page.rendered(markdown);
  assert.equal(rendered.querySelectorAll('tbody tr td').length, 2);
  assert.equal(rendered.querySelectorAll('math').length, 1);
  const latex = rendered.querySelector('annotation').textContent;
  assert.equal(latex, String.raw`\left|x\right|+\Vert v\Vert`);
  assert.equal(rendered.querySelector('code').textContent, 'a|b');
  assert.equal(rendered.querySelector('strong').textContent, 'bold');
  assert.equal(rendered.querySelector('a').getAttribute('href'), 'https://example.com');
});

test('display formulas inside table cells become valid inline math and retain array separators', t => {
  const page = setup(t, String.raw`<table><tr><th>matrix</th></tr><tr><td><span class="katex-display" data-latex="\begin{array}{|c|}a\\b\end{array}">visual</span></td></tr></table>`);
  const { markdown } = page.extract();
  assert.doesNotMatch(markdown, /\$\$/);
  assert.deepEqual(formulas(page, markdown), [{ latex: String.raw`\begin{array}{|c|}a\\b\end{array}`, display: false }]);
  assert.equal(page.rendered(markdown).querySelectorAll('.math-error').length, 0);
});

test('merged table cells become rectangular Markdown without dropping cell content', t => {
  const page = setup(t, '<table><tr><th colspan="2">Title</th><th>Value</th></tr><tr><td rowspan="2">A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr></table>');
  const { markdown } = page.extract();
  assert.equal(markdown, '| Title |  | Value |\n| --- | --- | --- |\n| A | B | C |\n|  | D | E |');
  assert.equal(page.rendered(markdown).querySelectorAll('td').length, 6);
});

test('currency and prose backslashes stay literal while actual formulas remain math', t => {
  const page = setup(t, String.raw`<p>Price $10 and $20; path C:\temp\notes; math $x_1$.</p>`);
  const { markdown } = page.extract();
  assert.match(markdown, /Price \\\$10 and \\\$20/);
  const rendered = page.rendered(markdown);
  assert.match(rendered.textContent, /Price \$10 and \$20; path C:\\temp\\notes/);
  assert.deepEqual(formulas(page, markdown), [{ latex: 'x_1', display: false }]);
});

test('code containing fences and literal math delimiters stays executable source', t => {
  const page = setup(t);
  const code = 'print("$x_i$")\n```markdown\n\\[raw\\]\n```\n';
  const pre = page.document.createElement('pre');
  const source = page.document.createElement('code');
  source.className = 'language-python'; source.textContent = code;
  pre.appendChild(source); page.container.appendChild(pre);
  const { markdown } = page.extract();
  assert.ok(markdown.startsWith('````python\n'));
  assert.equal(page.rendered(markdown).querySelector('code').textContent, code);
  assert.equal(formulas(page, markdown).length, 0);
});

test('block formulas remain inside blockquotes and list items', t => {
  const page = setup(t, String.raw`<blockquote><p>Quote</p><span class="katex-display" data-latex="\frac{a}{b}">visual</span></blockquote>
    <ol><li><p>List item</p><span class="katex-display" data-latex="x^2">visual</span></li></ol>`);
  const rendered = page.rendered(page.extract().markdown);
  assert.equal(rendered.querySelectorAll('blockquote math').length, 1);
  assert.equal(rendered.querySelectorAll('li math').length, 1);
});

test('unsupported TeX is retained as source with an error instead of a blank preview', t => {
  const page = setup(t, String.raw`<span data-latex="\unknowncommand{x_i}">visual</span>`);
  const { markdown } = page.extract();
  assert.equal(markdown, String.raw`$\unknowncommand{x_i}$`);
  page.window.ChatSavorCore.showPreviewModal(markdown);
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.equal(shadow.querySelector('.math-error').textContent, markdown);
  assert.match(shadow.querySelector('.compatibility').textContent, /1 个公式无法预览/);
  assert.equal(shadow.querySelector('.formula-item pre').textContent, String.raw`\unknowncommand{x_i}`);
});

test('plain Markdown and individual Notion equation copying preserve exact TeX', async t => {
  const page = setup(t);
  const copied = [];
  Object.defineProperty(page.window.navigator, 'clipboard', { value: { writeText: async value => copied.push(value) } });
  const latex = String.raw`\frac{a_i}{b^2}`;
  const markdown = `## Formula\n\n$${latex}$`;
  page.window.ChatSavorCore.showPreviewModal(markdown);
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  const buttons = [...shadow.querySelectorAll('button')];
  buttons.find(button => button.textContent === '复制 Markdown').click();
  await new Promise(resolve => setImmediate(resolve));
  buttons.find(button => button.textContent === '复制 LaTeX').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copied, [markdown, latex]);
});

test('rich copying writes HTML plus lossless Markdown to the same clipboard item', async t => {
  const page = setup(t);
  let clipboardItem;
  page.window.Blob = Blob;
  page.window.ClipboardItem = class { constructor(data) { this.data = data; } };
  Object.defineProperty(page.window.navigator, 'clipboard', { value: { write: async items => { clipboardItem = items[0]; } } });
  const markdown = String.raw`# Heading

Math $x_i^2$ and **bold**.`;
  assert.equal(await page.tools.copy(markdown, true), true);
  assert.equal(await clipboardItem.data['text/plain'].text(), markdown);
  const html = await clipboardItem.data['text/html'].text();
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<math/);
  assert.match(html, /<annotation encoding="application\/x-tex">x_i\^2<\/annotation>/);
});

test('rejected rich clipboard writes fall back to Markdown and report the fallback', async t => {
  const page = setup(t);
  const copied = [];
  page.window.ClipboardItem = class {};
  Object.defineProperty(page.window.navigator, 'clipboard', { value: {
    write: async () => { throw new Error('HTML not supported'); },
    writeText: async text => copied.push(text),
  } });
  page.window.ChatSavorCore.showPreviewModal('$x$');
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  [...shadow.querySelectorAll('button')].find(button => button.textContent === '复制富文本').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copied, ['$x$']);
  assert.match(shadow.querySelector('.copy-status').textContent, /已改为复制 Markdown/);
});

test('failed clipboard access shows a useful error and leaves source available', async t => {
  const page = setup(t);
  Object.defineProperty(page.window.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } });
  page.document.execCommand = () => false;
  page.window.ChatSavorCore.showPreviewModal('$x$');
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  [...shadow.querySelectorAll('button')].find(button => button.textContent === '复制 Markdown').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(shadow.querySelector('.copy-status').textContent, /复制失败/);
  assert.equal(shadow.querySelector('.raw-md').textContent, '$x$');
  assert.equal(page.document.querySelectorAll('textarea').length, 0);
});

test('rendered rich text excludes executable source while keeping mathematical comparisons', t => {
  const page = setup(t);
  const rendered = page.rendered(String.raw`Math $x < y$.

<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="java&#10;script:alert(1)">bad link</a>`);
  assert.equal(rendered.querySelector('script'), null);
  assert.equal(rendered.querySelector('[onerror]'), null);
  assert.equal(rendered.querySelector('a').getAttribute('href'), null);
  assert.equal(rendered.querySelectorAll('math').length, 1);
});
