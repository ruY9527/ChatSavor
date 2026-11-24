const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function popup(t, options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'src/popup/popup.html'), 'utf8'), {
    runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(dom.window.close.bind(dom.window));
  const calls = { injections: [], commands: [], copied: [], closed: false };
  let connected = options.connected !== false;
  const status = {
    version: manifest.version, host: 'chatgpt.com', coreReady: true, markdownReady: true,
    adapter: 'chatgpt', responseCount: options.responseCount || 0, buttonCount: 0,
    counts: { assistantRoles: 0 }, errors: [],
  };
  if (options.partial) { status.coreReady = false; status.adapter = null; }
  if (options.pageVersion) status.version = options.pageVersion;
  dom.window.close = () => { calls.closed = true; };
  dom.window.chrome = {
    runtime: { getManifest: () => manifest },
    tabs: {
      query: async () => [{ id: 42, url: options.url || 'https://chatgpt.com/c/PRIVATE-CONVERSATION-ID' }],
      sendMessage: async (id, message) => {
        calls.commands.push(message.command);
        if (!connected) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (message.command === 'SELECTION') return { ok: false, error: '请先在网页中选中要转换的回复内容。' };
        return { ok: true, status, converted: message.command === 'LATEST' };
      },
    },
    scripting: {
      executeScript: async request => {
        if (request.func) return [{ frameId: 0, result: connected ? { ok: true, status } : null }];
        calls.injections.push(request);
        if (options.injectionError) throw new Error(options.injectionError);
        connected = true;
        status.coreReady = true;
        status.adapter = 'chatgpt';
        status.version = manifest.version;
        return [{ frameId: 0 }];
      },
    },
  };
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => calls.copied.push(text) } });
  dom.window.eval(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(root, 'src/popup/controller.js'), 'utf8'));
  await flush();
  return { document: dom.window.document, calls, status };
}

test('popup reconnects an already open page when its content scripts are missing', async t => {
  const page = await popup(t, { connected: false });
  assert.equal(page.calls.injections.length, 1);
  assert.equal(page.calls.injections[0].target.tabId, 42);
  assert.deepEqual([...page.calls.injections[0].files], manifest.content_scripts[0].js);
  assert.match(page.document.getElementById('page-status').textContent, /暂未识别到回复/);
  assert.equal(page.document.getElementById('version').textContent, manifest.version);
});

test('manual reconnection injects before scanning and restores enabled controls', async t => {
  const page = await popup(t, { responseCount: 2 });
  page.document.getElementById('scan-page').click();
  await flush();
  assert.equal(page.calls.injections.length, 1);
  assert.equal(page.calls.commands.at(-1), 'SCAN');
  assert.match(page.document.getElementById('page-status').textContent, /2 条回复/);
  assert.equal(page.document.getElementById('scan-page').disabled, false);
});

test('restricted browser pages show a useful message without trying to inject', async t => {
  const page = await popup(t, { url: 'chrome://extensions/' });
  assert.equal(page.calls.injections.length, 0);
  assert.equal(page.calls.commands.length, 0);
  assert.match(page.document.getElementById('page-detail').textContent, /请先切换到.*ChatGPT/);
});

test('injection failures are displayed instead of being reported as successful connection', async t => {
  const page = await popup(t, { connected: false, injectionError: 'Cannot access contents of the page.' });
  assert.match(page.document.getElementById('page-status').textContent, /操作未完成/);
  assert.match(page.document.getElementById('page-detail').textContent, /Cannot access/);
  assert.equal(page.calls.injections.length, 2);
});

test('manual conversion errors keep the popup open with an actionable explanation', async t => {
  const page = await popup(t);
  page.document.getElementById('convert-selection').click();
  await flush();
  assert.match(page.document.getElementById('page-detail').textContent, /先在网页中选中/);
  assert.equal(page.calls.closed, false);
});

test('successful conversion closes the popup so the page preview is visible', async t => {
  const page = await popup(t);
  page.document.getElementById('convert-latest').click();
  await flush();
  assert.equal(page.calls.closed, true);
  assert.equal(page.calls.commands.at(-1), 'LATEST');
});

test('copied diagnostics identify extension and page script versions without leaking the conversation URL', async t => {
  const page = await popup(t);
  page.document.getElementById('copy-diagnostics').click();
  await flush();
  const copied = JSON.parse(page.calls.copied[0]);
  assert.equal(copied.extensionVersion, manifest.version);
  assert.equal(copied.page.version, manifest.version);
  assert.doesNotMatch(page.calls.copied[0], /PRIVATE-CONVERSATION-ID/);
});

test('partial script loading is repaired even when the diagnostic bridge still answers', async t => {
  const page = await popup(t, { partial: true });
  assert.equal(page.calls.injections.length, 1);
  assert.doesNotMatch(page.document.getElementById('page-status').textContent, /加载不完整/);
});

test('a stale page script version is upgraded instead of being treated as a healthy connection', async t => {
  const page = await popup(t, { pageVersion: '1.0.0' });
  assert.equal(page.calls.injections.length, 1);
  assert.match(page.document.getElementById('page-detail').textContent, new RegExp(manifest.version.replace(/\./g, '\\.')));
});

test('failed page connections can still be copied as diagnostics', async t => {
  const page = await popup(t, { connected: false, injectionError: 'Cannot access https://chatgpt.com/c/PRIVATE-CONVERSATION-ID' });
  page.document.getElementById('copy-diagnostics').click();
  await flush();
  assert.equal(page.calls.copied.length, 1);
  assert.match(page.calls.copied[0], /Cannot access/);
  assert.doesNotMatch(page.calls.copied[0], /PRIVATE-CONVERSATION-ID/);
});

test('the actual probe collects only message structure and retains it for copied diagnostics', async t => {
  const dom = new JSDOM(`<main><section data-turn-key="PRIVATE-TURN-ID">
    <div data-content-search-unit-key="PRIVATE-TURN-ID:2:assistant"><p>PRIVATE REPLY TEXT</p></div>
    <button aria-label="Copy response">Copy</button>
  </section></main><script id="client-bootstrap">PRIVATE BOOTSTRAP TOKEN</script>`, {
    url: 'https://chatgpt.com/c/PRIVATE-CONVERSATION-ID', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const status = () => ({ version: manifest.version, host: 'chatgpt.com', coreReady: true, markdownReady: true, adapter: 'chatgpt', responseCount: 0, buttonCount: 0 });
  dom.window.ChatSavorBridge = { handle: () => ({ ok: true, status: status() }) };
  const api = {
    runtime: { getManifest: () => manifest },
    scripting: { executeScript: async request => [{ frameId: 0, result: dom.window.eval('(' + request.func.toString() + ')()') }] },
    tabs: { sendMessage: async () => ({ ok: true, status: status() }) },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'));
  const report = await dom.window.ChatSavorConnection(api).connect(42, { command: 'STATUS' });
  assert.ok(report.status.markup.samples.length);
  const serialized = JSON.stringify(report);
  assert.match(serialized, /data-content-search-unit-key/);
  assert.match(serialized, /…:assistant/);
  assert.match(serialized, /Copy response/);
  assert.doesNotMatch(serialized, /PRIVATE/);
});
