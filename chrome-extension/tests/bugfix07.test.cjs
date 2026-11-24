const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function deepseekPage(t, extra) {
  const dom = new JSDOM(`<!doctype html><html><head><title>D</title></head><body><main><div class="ds-thinking-content">thought</div><div class="ds-markdown--block">Final answer</div>${extra}</main></body></html>`, {
    url: 'https://chat.deepseek.com/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
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
      now = timer.at; timers.delete(key);
      if (timer.repeat) timers.set(key, { ...timer, at: now + timer.repeat });
      timer.cb();
    }
    now = target;
  }
  return { window, document: window.document, advance };
}

test('BUG-07 a button whose class merely contains "stop" does not block DeepSeek injection', t => {
  const p = deepseekPage(t, '<button class="nonstop-switch stopwatch-toggle">切换</button>');
  const adapter = p.window.ChatSavorAdapters.deepseek;
  assert.ok(adapter);
  adapter.scan(true);
  assert.equal(p.document.querySelectorAll('.ai-saver-host').length, 1, 'unrelated stop-substring button must not be treated as generating');
});

test('BUG-07 a real stop button still blocks injection', t => {
  const p = deepseekPage(t, '<button data-testid="stop-button">停止生成</button>');
  const adapter = p.window.ChatSavorAdapters.deepseek;
  // isVisible requires getClientRects (stubbed above); use scan(false) with stability delay.
  p.advance(5200);
  assert.equal(p.document.querySelectorAll('.ai-saver-host').length, 0, 'real stop button keeps reply in generating state');
});
