const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('BUG-05 ctx.host is a function returning the current hostname (no shadowing)', t => {
  const dom = new JSDOM('<!doctype html><html><head><title>T</title></head><body><main><div class="probe">reply text</div></main></body></html>', {
    url: 'https://probe.example.com/', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 100, height: 10 }] : []; };
  for (const script of manifest.content_scripts[0].js) {
    if (script.includes('/platforms/') || script === 'src/content/content.js') continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  let observed = null;
  window.ChatSavorPlatform.create({
    id: 'probe',
    matchHost: host => host === 'probe.example.com',
    responseSelectors: ['.probe'],
    diagnostics: ctx => {
      observed = { type: typeof ctx.host, value: ctx.host ? ctx.host() : null };
      return {};
    },
  });
  const adapter = window.ChatSavorAdapters.probe;
  assert.ok(adapter);
  adapter.diagnostics();
  assert.equal(observed.type, 'function', 'ctx.host must be callable, not a shadowed string');
  assert.equal(observed.value, 'probe.example.com');
});
