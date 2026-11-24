const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const bridgeSource = fs.readFileSync(path.join(root, 'src/content/bridge.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function bridgePage(t) {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const listeners = new Set();
  const runtime = {
    getManifest: () => manifest,
    onMessage: {
      addListener: listener => listeners.add(listener),
      removeListener: listener => listeners.delete(listener),
      hasListener: listener => listeners.has(listener),
    },
  };
  dom.window.chrome = { runtime };
  dom.window.setTimeout = dom.window.setInterval = () => 0;
  dom.window.eval(bridgeSource);
  return { window: dom.window, listeners, runtime };
}

test('reinjection restores a lost runtime listener even when the old bridge marker remains', t => {
  const page = bridgePage(t);
  assert.equal(page.listeners.size, 1);
  page.listeners.clear();
  page.window.eval(bridgeSource);
  assert.equal(page.listeners.size, 1);
  page.window.eval(bridgeSource);
  assert.equal(page.listeners.size, 1, 'reconnecting must not accumulate duplicate listeners');
});

test('page diagnostics report the version of executed code, not a later manifest version', t => {
  const page = bridgePage(t);
  const executedVersion = page.window.ChatSavorBridge.status().version;
  assert.equal(executedVersion, manifest.version);
  page.runtime.getManifest = () => ({ version: '99.0.0' });
  assert.equal(page.window.ChatSavorBridge.status().version, executedVersion);
});

test('diagnostics remain readable when the previous extension context is invalidated', t => {
  const page = bridgePage(t);
  page.runtime.getManifest = () => { throw new Error('Extension context invalidated.'); };
  assert.equal(page.window.ChatSavorBridge.status().version, manifest.version);
});

function serviceWorker(options = {}) {
  const listeners = { installed: [], startup: [], updated: [], removed: [], message: [] };
  const calls = { injections: [], commands: [], queries: [] };
  let connected = options.connected || false;
  const event = name => ({ addListener: listener => listeners[name].push(listener) });
  const status = { version: manifest.version, coreReady: true, markdownReady: true, adapter: 'chatgpt' };
  const context = vm.createContext({
    URL, console: { warn() {}, error() {} },
    chrome: {
      runtime: { getManifest: () => manifest, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
      tabs: {
        query: async request => { calls.queries.push(request); return [{ id: 10, url: 'https://chatgpt.com/c/test' }]; },
        sendMessage: async (id, message) => {
          calls.commands.push(message.command);
          if (!connected) throw new Error('Receiving end does not exist.');
          return { ok: true, status };
        },
        onUpdated: event('updated'), onRemoved: event('removed'),
      },
      scripting: { executeScript: async request => {
        if (request.func) return [{ frameId: 0, result: connected ? { ok: true, status } : null }];
        calls.injections.push(request);
        if (options.injectionError) throw new Error(options.injectionError);
        connected = true;
        return [{ frameId: 0 }];
      } },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/background.js'), 'utf8'), context);
  return { listeners, calls };
}

test('reloading the extension restores scripts in already open ChatGPT tabs', async () => {
  const worker = serviceWorker();
  assert.equal(worker.listeners.installed.length, 1);
  worker.listeners.installed[0]({ reason: 'update' });
  await flush();
  assert.equal(worker.calls.injections.length, 1);
  assert.equal(worker.calls.injections[0].target.tabId, 10);
  assert.ok(worker.calls.commands.includes('CONNECT'));
});

test('an extension update replaces even an old page that incorrectly reports the new version', async () => {
  const worker = serviceWorker({ connected: true });
  worker.listeners.installed[0]({ reason: 'update' });
  await flush();
  assert.equal(worker.calls.injections.length, 1);
  assert.ok(worker.calls.commands.includes('CONNECT'));
});

test('upgrading from a legacy bridge removes the old floating control, including late reinsertion', async t => {
  const page = bridgePage(t);
  page.window.ChatSavorBridge.dispose();
  page.window.ChatSavorBridge = { version: '2.0.3' };
  const legacy = page.window.document.createElement('div');
  legacy.id = 'chatsavor-launcher';
  page.window.document.documentElement.appendChild(legacy);
  page.window.eval(bridgeSource);
  assert.equal(page.window.document.getElementById('chatsavor-launcher'), null);
  const late = page.window.document.createElement('div');
  late.id = 'chatsavor-launcher';
  page.window.document.documentElement.appendChild(late);
  await flush();
  assert.equal(page.window.document.getElementById('chatsavor-launcher'), null);
});

test('healthy tabs are not reinjected on an unrelated browser update event', async () => {
  const worker = serviceWorker({ connected: true });
  assert.equal(worker.listeners.updated.length, 1);
  worker.listeners.updated[0](10, { status: 'complete' }, { url: 'https://chatgpt.com/c/test' });
  await flush();
  assert.equal(worker.calls.injections.length, 0);
});

test('background recovery ignores unsupported pages and restores all supported domains', async () => {
  const worker = serviceWorker();
  assert.equal(worker.listeners.updated.length, 1);
  worker.listeners.updated[0](11, { status: 'complete' }, { url: 'https://example.com/' });
  worker.listeners.updated[0](12, { status: 'complete' }, { url: 'https://chatgpt.com.example.com/' });
  await flush();
  assert.equal(worker.calls.injections.length, 0);
  assert.equal(worker.calls.commands.length, 0);
  const supported = ['https://chatgpt.com/c/x', 'https://chat.openai.com/c/x', 'https://chat.deepseek.com/a', 'https://gemini.google.com/app'];
  for (let i = 0; i < supported.length; i++) {
    const before = worker.calls.commands.length;
    worker.listeners.updated[0](20 + i, { status: 'complete' }, { url: supported[i] });
    await flush();
    assert.ok(worker.calls.commands.length > before, `${supported[i]} should trigger a connection attempt`);
  }
});

test('actual manifest scripts restore per-reply buttons after an extension reload with stale globals', async t => {
  const page = bridgePage(t);
  page.window.document.querySelector('main').innerHTML = '<article data-turn="assistant">First response.</article><article data-turn="assistant">Second response.</article>';
  page.window.HTMLElement.prototype.getClientRects = function() { return this.isConnected ? [{ width: 200, height: 40 }] : []; };
  let now = 1000;
  page.window.Date.now = () => now;
  // The DOM/global marker survives, while the previous runtime listener is gone.
  page.listeners.clear();
  const installed = [];
  const event = { addListener() {} };
  function sendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      let answered = false;
      for (const listener of page.listeners) listener(message, {}, response => { answered = true; resolve(response); });
      if (!answered) reject(new Error('Receiving end does not exist.'));
    });
  }
  const context = vm.createContext({ URL, console, chrome: {
    runtime: { getManifest: () => manifest, onInstalled: { addListener: listener => installed.push(listener) }, onStartup: event, onMessage: event },
    tabs: { query: async () => [{ id: 10, url: 'https://chatgpt.com/c/test' }], sendMessage, onUpdated: event, onRemoved: event },
    scripting: { executeScript: async request => {
      if (request.func) return [{ frameId: 0, result: page.window.eval('(' + request.func.toString() + ')()') }];
      for (const file of request.files) page.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
      return [{ frameId: 0 }];
    } },
  } });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/background.js'), 'utf8'), context);
  await installed[0]({ reason: 'update' });
  assert.equal(page.listeners.size, 1);
  assert.ok(page.window.ChatSavorChatGPTAdapter);
  now = 4000;
  const response = await sendMessage(10, { type: 'CHATSAVOR_COMMAND', command: 'CONNECT' });
  assert.equal(response.status.responseCount, 2);
  assert.equal(response.status.buttonCount, 2);
  assert.equal(page.window.document.getElementById('chatsavor-launcher'), null);
  const buttons = page.window.document.querySelectorAll('.ai-saver-host');
  assert.equal(buttons[0].previousElementSibling.textContent, 'First response.');
  assert.equal(buttons[1].previousElementSibling.textContent, 'Second response.');
});

test('manifest reinjection upgrades a 2.0.5 adapter reporting zero replies on the new layout', t => {
  const page = bridgePage(t);
  page.window.document.querySelector('main').innerHTML = `<ol data-conversation-transcript>
    <li data-message-role="user"><button data-user-message-bubble>A prompt</button></li>
    <li data-message-role="assistant"><div data-assistant-markdown>First answer.</div></li>
  </ol><div data-turn-key="a-turn">
    <div data-content-search-unit-key="a:0:user"><div data-user-message-bubble>Another prompt</div></div>
    <div data-content-search-unit-key="a:1:assistant"><div data-markdown-text-style="assistant-message">Second answer.</div></div>
  </div>`;
  page.window.HTMLElement.prototype.getClientRects = function() { return this.isConnected ? [{ width: 200, height: 40 }] : []; };
  page.window.eval(bridgeSource.replace(/var SCRIPT_VERSION = '[^']+';/, "var SCRIPT_VERSION = '2.0.5';"));
  let disposed = false;
  const oldAdapter = { version: '2.0.5', core: null, platform: 'chatgpt', getResponses: () => [], scan() {}, dispose() { disposed = true; } };
  page.window.ChatSavorChatGPTAdapter = oldAdapter;
  page.window.ChatSavorBridge.register(oldAdapter);
  assert.equal(page.window.ChatSavorBridge.status().responseCount, 0);
  assert.equal(page.window.ChatSavorBridge.status().version, '2.0.5');
  for (const file of manifest.content_scripts[0].js) page.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const response = page.window.ChatSavorBridge.handle('SCAN');
  assert.ok(disposed);
  assert.equal(page.listeners.size, 1);
  assert.equal(response.status.version, manifest.version);
  assert.equal(response.status.responseCount, 2);
  assert.equal(response.status.buttonCount, 2);
  assert.equal(page.window.ChatSavorBridge.handle('SCAN').status.buttonCount, 2);
  for (const button of page.window.document.querySelectorAll('.ai-saver-host')) {
    assert.ok(button.parentElement.matches('[data-message-role="assistant"], [data-content-search-unit-key$=":assistant"]'));
    assert.equal(button, button.parentElement.lastElementChild);
  }
});
