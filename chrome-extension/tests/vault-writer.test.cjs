const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');

// In-memory FileSystemDirectoryHandle mock.
function dirHandle(name) {
  const dirs = new Map();
  const files = new Map();
  return {
    name, dirs, files,
    async getDirectoryHandle(seg, opts) {
      if (seg === '..' || seg === '.' || seg.includes('\\')) throw new Error('bad segment');
      if (!dirs.has(seg)) dirs.set(seg, dirHandle(seg));
      return dirs.get(seg);
    },
    async getFileHandle(n, opts) {
      if (n.includes('/') || n === '..') throw new Error('bad file');
      return {
        name: n,
        async createWritable() {
          return {
            async write(data) { files.set(n, data); },
            async close() {},
          };
        },
      };
    },
  };
}

function fsPage(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root, 'src/lib/fs-vault.js'), 'utf8'));
  return dom.window;
}

test('U4 writeBundleToDirectory creates nested dirs, prefixes assets and rejects ..', async t => {
  const w = fsPage(t);
  const vault = w.ChatSavorFsVault;
  assert.deepEqual(Array.from(vault.safeSegments('Notes/AI/../../evil')), ['Notes', 'AI', 'evil']);
  const rootHandle = dirHandle('Vault');
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
  await vault.writeBundleToDirectory(rootHandle, 'Notes/AI', 'note.md', 'img ![](./assets/fig_01.png)', [
    { name: 'fig_01.png', bytes: png, originalPath: './assets/fig_01.png' },
  ], 'note');
  const notes = rootHandle.dirs.get('Notes');
  assert.ok(notes, 'Notes dir created');
  const ai = notes.dirs.get('AI');
  assert.ok(ai, 'AI dir created');
  assert.ok(ai.files.has('note.md'), 'markdown written');
  assert.equal(ai.files.get('note.md'), 'img ![](./assets/note_fig_01.png)', 'prefixed asset path');
  const assets = ai.dirs.get('assets');
  assert.ok(assets && assets.files.has('note_fig_01.png'), 'prefixed image written');
  assert.equal(assets.files.get('note_fig_01.png')[1], 0x50);
});

test('C2 writeBundleToDirectory rewrites ./assets/fig_01.png without ././assets/ double prefix', async t => {
  const w = fsPage(t);
  const vault = w.ChatSavorFsVault;
  const rootHandle = dirHandle('Vault');
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
  await vault.writeBundleToDirectory(rootHandle, '', 'note.md', '正文 ![图](./assets/fig_01.png)', [
    { name: 'fig_01.png', bytes: png, originalPath: 'assets/fig_01.png' },
  ], 'note');
  const md = rootHandle.files.get('note.md');
  assert.ok(md.includes('(./assets/note_fig_01.png)'), 'clean rewritten path');
  assert.ok(!md.includes('././assets/'), 'no double prefix');
  const assets = rootHandle.dirs.get('assets');
  assert.ok(assets && assets.files.has('note_fig_01.png'));
});

test('U4 background: granted handle writes silently; prompt opens writer.html', async t => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const messages = [];
  const created = [];
  const store = {};
  let handle = null;
  const context = vm.createContext({
    URL, console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout, Promise, Uint8Array, atob,
    chrome: {
      runtime: { getManifest: () => manifest, getURL: p => 'chrome-extension://id/' + p,
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener: fn => messages.push(fn) } },
      tabs: { query: async () => [], create: info => created.push(info), onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
      storage: { session: { set(obj, cb) { Object.assign(store, obj); if (cb) cb(); }, remove() {} } },
      scripting: { executeScript: async () => [] },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/connection.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/lib/fs-vault.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/background.js'), 'utf8'), context);
  context.ChatSavorFsVault.getDirectoryHandle = async () => handle;
  const onMessage = messages[messages.length - 1];

  // granted → silent
  handle = Object.assign(dirHandle('Vault'), { queryPermission: async () => 'granted' });
  let response = null;
  onMessage({ type: 'CHATSAVOR_SAVE_TO_VAULT', subDir: '', filename: 'a.md', markdown: 'body', assets: [] }, {}, r => { response = r; });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(response.mode, 'silent');
  assert.equal(response.ok, true);
  assert.ok(handle.files.has('a.md'), 'silent write happened');

  // prompt → session payload + writer tab
  handle = Object.assign(dirHandle('Vault2'), { queryPermission: async () => 'prompt' });
  onMessage({ type: 'CHATSAVOR_SAVE_TO_VAULT', subDir: 'Notes', filename: 'b.md', markdown: 'body', assets: [] }, {}, r => { response = r; });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(response.mode, 'prompt');
  assert.ok(created.some(c => c.url.includes('writer.html?id=')), 'writer page opened');
  assert.ok(Object.keys(store).some(k => k.startsWith('vault_')), 'payload stored in session');
});
