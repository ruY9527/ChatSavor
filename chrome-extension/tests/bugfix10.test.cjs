const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function docx(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  for (const script of manifest.content_scripts[0].js) {
    if (script.endsWith('docx-builder.js')) dom.window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return dom.window.ChatSavorDocx;
}

test('BUG-10 table with escaped pipes keeps 2 cells and header uses TableHeader not Heading2', t => {
  const api = docx(t);
  const xml = api.markdownToDocumentXml('| 范数 | $\\|x\\|_2$ |\n|---|---|\n| value | 3 |');
  const firstRow = xml.match(/<w:tr>(.*?)<\/w:tr>/)[1];
  assert.equal((firstRow.match(/<w:tc>/g) || []).length, 2, 'escaped pipe must not split the cell');
  assert.match(firstRow, /TableHeader/);
  assert.doesNotMatch(xml, /<w:pStyle w:val="Heading2"\/>/);
});

test('BUG-10 4-backtick fence preserves inner 3-backtick code', t => {
  const api = docx(t);
  const xml = api.markdownToDocumentXml('````markdown\n```js\nconst x=1;\n```\n````\n\nAfter text');
  assert.match(xml, /```js/);
  assert.match(xml, /const x=1/);
  assert.match(xml, /After text/);
});

test('BUG-10 ordered list renders with ListParagraph and keeps the number', t => {
  const api = docx(t);
  const xml = api.markdownToDocumentXml('1. First item\n2. Second item');
  assert.equal((xml.match(/ListParagraph/g) || []).length, 2);
  assert.match(xml, /1\. First item/);
  assert.match(xml, /2\. Second item/);
});

test('BUG-10 styles.xml defines TableHeader without outlineLvl', t => {
  const api = docx(t);
  const styles = api.stylesXml();
  assert.match(styles, /w:styleId="TableHeader"/);
  assert.match(styles, /<w:b\/>/);
  assert.doesNotMatch(styles, /outlineLvl/, 'table header must not pollute Word navigation outline');
});
