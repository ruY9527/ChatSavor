// ChatSavor — dependency-free Store-mode ZIP packer (MV3 compatible).
// Exposed as globalThis.ChatSavorZip. Supports mixed text/binary entries and
// always sets the UTF-8 filename flag (0x0800) so CJK names survive extraction.
(function () {
  'use strict';

  function crc32(bytes) {
    var table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      else { out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)); }
    }
    return new Uint8Array(out);
  }

  function toBytes(data) {
    // Duck typing: cross-realm Uint8Array (JSDOM vs Node) fails instanceof.
    if (data && typeof data === 'object' && typeof data.length === 'number' && typeof data.BYTES_PER_ELEMENT === 'number') return new Uint8Array(data);
    if (data && Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data);
    return utf8(String(data == null ? '' : data));
  }

  function normName(name) {
    return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  // entries: [{ name: string, data: string | Uint8Array | ArrayBuffer }]
  function packBytes(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;
    (entries || []).forEach(function(entry) {
      var name = utf8(normName(entry.name));
      var data = toBytes(entry.data);
      var crc = crc32(data);
      var flag = 0x0800; // Bit 11: UTF-8 filename

      var local = new Uint8Array(30 + name.length + data.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);   // version needed
      lv.setUint16(6, flag, true); // general purpose bit flag
      lv.setUint16(8, 0, true);    // stored, no compression
      lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      chunks.push(local);

      var cd = new Uint8Array(46 + name.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, flag, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);
      offset += local.length;
    });
    var centralSize = central.reduce(function(sum, part) { return sum + part.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    var all = chunks.concat(central, [end]);
    var total = all.reduce(function(sum, part) { return sum + part.length; }, 0);
    var result = new Uint8Array(total);
    var pos = 0;
    all.forEach(function(part) { result.set(part, pos); pos += part.length; });
    return result;
  }

  function pack(entries, mimeType) {
    return new Blob([packBytes(entries)], { type: mimeType || 'application/zip' });
  }

  globalThis.ChatSavorZip = { crc32: crc32, utf8: utf8, packBytes: packBytes, pack: pack };
})();
