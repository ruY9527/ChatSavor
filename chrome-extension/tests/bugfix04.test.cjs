const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function grokPage(t) {
  const dom = new JSDOM('<!doctype html><html><head><title>X</title></head><body><main><div class="message-bubble"><div class="response-content-markdown">Grok answer</div></div></main></body></html>', {
    url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 200, height: 20 }] : []; };
  let now = 1000, id = 0;
  const timers = new Map();
  window.Date.now = () => now;
  window.setTimeout = (cb, d) => { const i = ++id; timers.set(i, { cb, at: now + d }); return i; };
  window.setInterval = (cb, d) => { const i = ++id; timers.set(i, { cb, at: now + d, repeat: d }); return i; };
  window.clearTimeout = window.clearInterval = i => timers.delete(i);
  for (const script of manifest.content_scripts[0].js) {
    if (script === 'src/content/content.js') continue;
    window.eval(fs.readFileSync(path.join(root, script), 'utf8'));
  }
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, timer] = next;
      now = timer.at;
      timers.delete(key);
      if (timer.repeat) timers.set(key, { ...timer, at: now + timer.repeat });
      timer.cb();
    }
    now = target;
  }
  return { window, document: window.document, advance };
}

test('BUG-04 grok mounts on x.com/home but exposes no replies and injects no buttons', t => {
  const p = grokPage(t);
  p.window.eval(fs.readFileSync(path.join(root, 'src/content/platforms/grok.js'), 'utf8'));
  const adapter = p.window.ChatSavorAdapters.grok;
  assert.ok(adapter, 'grok must mount on x.com so it can observe SPA route changes');
  assert.equal(adapter.getResponses().length, 0, 'no replies on the inactive /home route');
  assert.equal(p.document.querySelectorAll('.ai-saver-host').length, 0);
});

test('BUG-04 SPA transition from home to grok route activates without popstate', async t => {
  const p = grokPage(t);
  // Mount the adapter while on /home (isActiveRoute=false).
  p.window.eval(fs.readFileSync(path.join(root, 'src/content/platforms/grok.js'), 'utf8'));
  const adapter = p.window.ChatSavorAdapters.grok;
  assert.ok(adapter, 'grok adapter mounted even on inactive route');
  assert.equal(adapter.getResponses().length, 0, 'no replies on x.com/home');
  assert.equal(p.document.querySelectorAll('.ai-saver-host').length, 0);
  // history.pushState fires NO popstate/hashchange — only periodic scan can detect it.
  p.window.history.pushState({}, '', '/i/grok');
  p.advance(5200);
  assert.equal(adapter.getResponses().length, 1, 'route now active, reply recognized');
  assert.ok(p.document.querySelectorAll('.ai-saver-host').length >= 1, 'button injected after SPA nav');
});
