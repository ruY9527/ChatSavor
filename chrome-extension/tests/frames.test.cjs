const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function connection(options = {}) {
  const calls = { files: [], messages: [], probes: [] };
  const top = { version: manifest.version, host: 'chatgpt.com', coreReady: true, markdownReady: true, adapter: 'chatgpt', responseCount: options.topReplies || 0, buttonCount: 0 };
  const child = { ...top, responseCount: options.childReplies === undefined ? 2 : options.childReplies, selectionAvailable: !!options.childSelection };
  let childLoaded = !options.childMissing;
  const api = {
    runtime: { getManifest: () => manifest },
    scripting: { executeScript: async request => {
      if (options.blockFrames && request.target.allFrames) throw new Error('A cross-origin frame is inaccessible.');
      if (request.files) { calls.files.push(request); childLoaded = true; return [{ frameId: 0 }, { frameId: 7 }]; }
      calls.probes.push(request.target);
      const probeTop = options.markup ? { ...top, markup: options.markup } : top;
      const result = [{ frameId: 0, result: { ok: true, status: probeTop } }];
      if (request.target.allFrames) result.push({ frameId: 7, result: childLoaded ? { ok: true, status: child } : { ok: false, unconnected: true, host: 'chatgpt.com' } });
      return result;
    } },
    tabs: { sendMessage: async (tabId, message, target) => {
      assert.ok(Number.isInteger(target.frameId), 'commands must target an explicit frame');
      calls.messages.push({ command: message.command, frameId: target.frameId });
      return { ok: true, status: target.frameId === 7 ? child : top, converted: message.command === 'LATEST' || message.command === 'SELECTION' };
    } },
  };
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'), context);
  return { client: context.ChatSavorConnection(api), calls };
}

test('conversion targets the child containing replies instead of an empty outer document', async () => {
  const { client, calls } = connection();
  const response = await client.connect(42, { command: 'LATEST' });
  assert.equal(response.frameId, 7);
  assert.equal(response.status.responseCount, 2);
  assert.deepEqual(calls.messages.at(-1), { command: 'LATEST', frameId: 7 });
  assert.equal(calls.files.length, 0);
});

test('an unconnected child frame is injected even when the empty top frame looks healthy', async () => {
  const { client, calls } = connection({ childMissing: true });
  const response = await client.connect(42, { command: 'STATUS' });
  assert.equal(calls.files.length, 1);
  assert.equal(calls.files[0].target.allFrames, true);
  assert.equal(response.frameId, 7);
  assert.equal(response.status.responseCount, 2);
});

test('selected text routes to its frame rather than a different frame with more replies', async () => {
  const { client, calls } = connection({ topReplies: 10, childReplies: 0, childSelection: true });
  const response = await client.connect(42, { command: 'SELECTION' });
  assert.equal(response.frameId, 7);
  assert.deepEqual(calls.messages.at(-1), { command: 'SELECTION', frameId: 7 });
});

test('an inaccessible third-party frame does not break the permitted main document', async () => {
  const { client } = connection({ topReplies: 1, blockFrames: true });
  const response = await client.connect(42, { command: 'STATUS' });
  assert.equal(response.frameId, 0);
  assert.equal(response.status.responseCount, 1);
});

test('manifest injects into matching and related frames without expanding host permissions', () => {
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, true);
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});

test('unrecognized-page diagnostics retain probe markup after CONNECT and manual SCAN replies', async () => {
  const markup = { samples: [{ textLength: 50, ancestors: [{ tag: 'section', classes: 'new-message' }] }] };
  const { client } = connection({ blockFrames: true, markup });
  const status = await client.connect(42, { command: 'STATUS' });
  assert.deepEqual(status.status.markup, markup);
  const scan = await client.connect(42, { command: 'SCAN' });
  assert.deepEqual(scan.status.markup, markup);
});
