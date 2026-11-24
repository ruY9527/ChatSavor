// ChatSavor — zero-dependency OOXML .docx builder (native JS, no build step)
// Exposed as window.ChatSavorDocx. Produces a valid Word .docx Blob from Markdown.
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
      else if (code < 0x800) { out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F)); }
      else { out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)); }
    }
    return new Uint8Array(out);
  }

  function zip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var encoder = utf8;
    files.forEach(function(file) {
      var name = encoder(file.name);
      var data = encoder(file.data);
      var crc = crc32(data);
      var local = new Uint8Array(30 + name.length + data.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); // version
      dv.setUint16(6, 0, true); // flags
      dv.setUint16(8, 0, true); // stored
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true); // time/date
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      chunks.push(local);

      var cd = new Uint8Array(46 + name.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
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
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Minimal inline formatter: **bold**, *italic*, `code`, ~~strike~~, [text](url)
  function inline(text) {
    var out = '';
    var pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
    var last = 0;
    var match;
    function run(value, styles) {
      var t = value;
      if (/^\*\*/.test(t)) return { text: t.slice(2, -2), styles: styles.concat(['b']) };
      if (/^\*/.test(t)) return { text: t.slice(1, -1), styles: styles.concat(['i']) };
      if (/^`/.test(t)) return { text: t.slice(1, -1), styles: styles.concat(['code']) };
      if (/^~~/.test(t)) return { text: t.slice(2, -2), styles: styles.concat(['strike']) };
      var link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      // Preserve the target URL in the visible text; a full OOXML hyperlink needs
      // relationship parts, and losing the URL entirely is worse for the reader.
      return { text: link ? link[1] + ' (' + link[2] + ')' : t, styles: styles };
    }
    function emit(value, styles) {
      var item = run(value, styles);
      var rpr = item.styles.indexOf('b') !== -1 ? '<w:b/>' : '';
      rpr += item.styles.indexOf('i') !== -1 ? '<w:i/>' : '';
      rpr += item.styles.indexOf('strike') !== -1 ? '<w:strike/>' : '';
      rpr += item.styles.indexOf('code') !== -1 ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '';
      out += '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(item.text) + '</w:t></w:r>';
    }
    while ((match = pattern.exec(text))) {
      emit(text.slice(last, match.index), []);
      emit(match[0], []);
      last = match.index + match[0].length;
    }
    if (last < text.length) emit(text.slice(last), []);
    return out || '<w:r><w:t xml:space="preserve"></w:t></w:r>';
  }

  function paragraph(text, style) {
    var ppr = style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '';
    return '<w:p>' + ppr + inline(text) + '</w:p>';
  }

  function markdownToDocumentXml(markdown) {
    var lines = String(markdown || '').split(/\r?\n/);
    var body = '';
    var i = 0;
    var inCode = false;
    var openFenceLen = 0;
    var codeLines = [];
    function flushCode() {
      codeLines.forEach(function(codeLine) {
        body += '<w:p><w:pPr><w:shd w:val="clear" w:fill="F4F4F4"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">' + esc(codeLine) + '</w:t></w:r></w:p>';
      });
      codeLines = [];
    }
    while (i < lines.length) {
      var line = lines[i];
      // Code fences: record the opening length; only a pure run of >= that many
      // backticks closes it (so a 4-backtick fence can contain ``` blocks).
      var fence = /^(`{3,})/.exec(line.trim());
      if (fence) {
        if (inCode) {
          if (fence[1].length >= openFenceLen && line.trim() === fence[1]) {
            flushCode();
            inCode = false;
          } else {
            codeLines.push(line);
          }
        } else {
          inCode = true;
          openFenceLen = fence[1].length;
        }
        i++; continue;
      }
      if (inCode) { codeLines.push(line); i++; continue; }
      var heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) { var level = Math.min(6, heading[1].length); body += paragraph(heading[2], 'Heading' + level); i++; continue; }
      if (/^\s*[-*+]\s+/.test(line)) { body += paragraph('• ' + line.replace(/^\s*[-*+]\s+/, ''), 'ListParagraph'); i++; continue; }
      var ordered = /^\s*(\d+\.)\s+(.*)$/.exec(line);
      if (ordered) { body += paragraph(ordered[1] + ' ' + ordered[2], 'ListParagraph'); i++; continue; }
      if (/^\s*\|/.test(line)) {
        var tableLines = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { tableLines.push(lines[i]); i++; }
        var rows = tableLines.filter(function(row) { return !/^\s*\|[\s:|-]+\|\s*$/.test(row); })
          .map(function(row) {
            return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
              .replace(/\\\|/g, '\u0000') // protect escaped pipes inside cells (e.g. $\|x\|$)
              .split('|')
              .map(function(c) { return c.trim().replace(/\u0000/g, '\\|'); });
          });
        if (rows.length) {
          body += '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr>';
          rows.forEach(function(row, r) {
            body += '<w:tr>';
            row.forEach(function(cell) {
              var tcPr = '<w:tcPr><w:tcW w:w="2400" w:type="dxa"/>' + (r === 0 ? '<w:shd w:val="clear" w:fill="F0F0F0"/>' : '') + '</w:tcPr>';
              body += '<w:tc>' + tcPr + paragraph(cell, r === 0 ? 'TableHeader' : null) + '</w:tc>';
            });
            body += '</w:tr>';
          });
          body += '</w:tbl>';
        }
        continue;
      }
      if (!line.trim()) { i++; continue; }
      body += paragraph(/^>\s?/.test(line) ? line.replace(/^>\s?/, '') : line, /^>\s?/.test(line) ? 'Quote' : null);
      i++;
    }
    if (inCode) {
      codeLines.forEach(function(codeLine) { body += '<w:p><w:pPr><w:shd w:val="clear" w:fill="F4F4F4"/></w:pPr><w:r><w:t xml:space="preserve">' + esc(codeLine) + '</w:t></w:r></w:p>'; });
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  }

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      [1, 2, 3, 4, 5, 6].map(function(n) { return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:rPr><w:b/><w:sz w:val="' + (32 - n * 2) + '"/></w:rPr></w:style>'; }).join('') +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style></w:styles>';
  }

  function build(markdown) {
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var styles = stylesXml();
    return zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/document.xml', data: markdownToDocumentXml(markdown) },
    ]);
  }

  window.ChatSavorDocx = { build: build, crc32: crc32, zip: zip, markdownToDocumentXml: markdownToDocumentXml, stylesXml: stylesXml };
})();
