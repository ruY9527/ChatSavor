const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
function evalLib(window, file) { window.eval(fs.readFileSync(path.join(root, file), 'utf8')); }

function zipPage(t) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  t.after(() => dom.window.close());
  evalLib(dom.window, 'src/lib/zip.js');
  return dom.window;
}

test('U1 zip.packBytes sets UTF-8 flag 0x0800, preserves binary bytes and CRC', t => {
  const w = zipPage(t);
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
  const bytes = w.ChatSavorZip.packBytes([
    { name: '笔记_测试.md', data: '# 中文标题\n内容' },
    { name: 'assets/fig.png', data: png },
  ]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4B);
  // Local header general purpose flag at offset 6 (little endian).
  assert.equal(bytes[6] | (bytes[7] << 8), 0x0800, 'UTF-8 filename flag set in local header');
  assert.equal(w.ChatSavorZip.crc32(png) >>> 0 > 0, true);
  // Decode the stored PNG bytes back out (local header = 30 + nameLen + extraLen).
  const text = Buffer.from(bytes).toString('latin1');
  // PNG magic survives verbatim inside the second stored entry.
  const pngOffset = Buffer.from(bytes).indexOf(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  assert.ok(pngOffset > 0, 'PNG magic present in ZIP');
  for (let i = 0; i < png.length; i++) assert.equal(bytes[pngOffset + i], png[i], 'binary byte preserved');
  assert.ok(Buffer.from(bytes).toString('utf8').includes('笔记_测试.md'), 'CJK name stored as UTF-8');
  // Central directory flag also 0x0800.
  const cdOffset = text.indexOf('PK\x01\x02') >= 0 ? Buffer.from(bytes).indexOf(Buffer.from([0x50, 0x4B, 0x01, 0x02])) : -1;
  assert.ok(cdOffset > 0, 'central directory present');
  assert.equal(bytes[cdOffset + 8] | (bytes[cdOffset + 9] << 8), 0x0800, 'UTF-8 flag in central directory');
});

function assetsPage(t, remoteOk) {
  const dom = new JSDOM('<!doctype html><html><head><title>Chat</title></head><body><main></main></body></html>', {
    url: 'https://chat.example.com/', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.ChatSavorZip = undefined;
  evalLib(w, 'src/lib/zip.js');
  const stored = {};
  w.chrome = { runtime: { sendMessage: (msg, cb) => {
    if (msg.type === 'CHATSAVOR_FETCH_IMAGE') {
      if (msg.url.includes('ok.png')) cb({ ok: true, contentType: 'image/png', base64: Buffer.from([0x89, 0x50, 0x4E, 0x47, 1]).toString('base64') });
      else cb({ ok: false, error: '404' });
    }
  } } };
  // Minimal Meta stub.
  w.ChatSavorMeta = {
    buildFilename: () => '2026-11-24_ChatGPT_test.md',
    withFrontmatter: md => md,
  };
  evalLib(w, 'src/content/assets-packager.js');
  return w;
}

test('U1 assets packager: data URI + fetched remote rewritten, failed URL preserved', async t => {
  const w = assetsPage(t);
  const svgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>').toString('base64');
  const md = [
    '![a](data:image/svg+xml;base64,' + svgB64 + ')',
    '![b](https://img.example/ok.png)',
    '![c](https://img.example/404.png)',
  ].join('\n');
  const result = await w.ChatSavorAssets.collectAndFetchAssets(md);
  assert.equal(result.stats.fetched, 2);
  assert.equal(result.stats.failed, 1);
  assert.ok(result.markdown.includes('./assets/fig_01.svg'));
  assert.ok(result.markdown.includes('./assets/fig_02.png'));
  assert.ok(result.markdown.includes('https://img.example/404.png'), 'failed URL preserved');
  const zip = await w.ChatSavorAssets.buildMarkdownZip(md, { title: 'test' }, false);
  assert.ok(zip.filename.endsWith('.zip'));
  assert.equal(zip.stats.fetched, 2);
});
