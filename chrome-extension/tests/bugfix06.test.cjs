const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function claudePage(t, html) {
  const dom = new JSDOM(`<!doctype html><html><head><title>C</title></head><body><main>${html}</main></body></html>`, {
    url: 'https://claude.ai/chat/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js') continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  return { window, document: window.document };
}

test('BUG-06 Claude reply with prose plus Artifact keeps both in export', t => {
  const p = claudePage(t, [
    '<div class="font-claude-message">',
    '  <p>Here is the answer you asked for.</p>',
    '  <div class="artifact-card"><div class="artifact-content">const x = 42;</div></div>',
    '</div>',
  ].join(''));
  const adapter = p.window.ChatSavorAdapters.claude;
  assert.ok(adapter);
  const reply = adapter.getResponses()[0];
  assert.ok(reply);
  const result = adapter.extractMarkdown(reply);
  assert.match(result.markdown, /Here is the answer you asked for/);
  assert.match(result.markdown, /const x = 42/);
});

test('BUG-06 Artifact-only reply still exports the Artifact content', t => {
  const p = claudePage(t, '<div class="font-claude-message"><div class="artifact-card"><div class="artifact-content">only artifact text here</div></div></div>');
  const adapter = p.window.ChatSavorAdapters.claude;
  const reply = adapter.getResponses()[0];
  const result = adapter.extractMarkdown(reply);
  assert.match(result.markdown, /only artifact text here/);
});
