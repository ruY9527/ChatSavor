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

  function toBytes(data) {
    // Duck typing for cross-realm Uint8Array (JSDOM vs Node) and ArrayBuffer.
    if (data && typeof data === 'object' && typeof data.length === 'number' && typeof data.BYTES_PER_ELEMENT === 'number') return new Uint8Array(data);
    if (data && Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data);
    return utf8(String(data == null ? '' : data));
  }

  function zip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    files.forEach(function(file) {
      var name = utf8(file.name);
      var data = toBytes(file.data);
      var crc = crc32(data);
      var flag = 0x0800; // UTF-8 filename flag (Bit 11)
      var local = new Uint8Array(30 + name.length + data.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); // version
      dv.setUint16(6, flag, true); // flags
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
      cv.setUint16(8, flag, true); cv.setUint16(10, 0, true);
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
    var all = chunks.concat(central, [end]);
    var total = all.reduce(function(sum, part) { return sum + part.length; }, 0);
    var result = new Uint8Array(total);
    var pos = 0;
    all.forEach(function(part) { result.set(part, pos); pos += part.length; });
    return new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Minimal inline formatter: **bold**, *italic*, `code`, ~~strike~~, [text](url)
  function ommlInline(latex) {
    if (typeof window === 'undefined') return null;
    var api = window.ChatSavorOmml;
    return (api && typeof api.latexToOmml === 'function') ? api.latexToOmml(latex, false) : null;
  }

  function inline(text) {
    var out = '';
    // Inline math: $...$ (not escaped \$) and \(...\). OMML <m:oMath> is a direct
    // child of <w:p>, so callers insert it at paragraph level, not inside <w:r>.
    var mathRe = /(^|[^\\])\$([^\n$]+)\$|\\\(([^)]+)\\\)/g;
    var match;
    var cursor = 0;
    function plainSegment(s) {
      if (!s) return '';
      var sub = '';
      // Convert literal <br> / <br/> into Word line breaks.
      var segments = String(s).split(/<br\s*\/?>/i);
      segments.forEach(function(seg, idx) {
        if (idx > 0) sub += '<w:r><w:br/></w:r>';
        sub += plainSegment2(seg);
      });
      return sub;
    }
    function plainSegment2(s) {
      if (!s) return '';
      var sub = '';
      var pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
      var last = 0;
      function runText(value, styles) {
        var item = parseInlineToken(value, styles);
        var rpr = item.styles.indexOf('b') !== -1 ? '<w:b/>' : '';
        rpr += item.styles.indexOf('i') !== -1 ? '<w:i/>' : '';
        rpr += item.styles.indexOf('strike') !== -1 ? '<w:strike/>' : '';
        rpr += item.styles.indexOf('code') !== -1 ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '';
        return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(item.text) + '</w:t></w:r>';
      }
      var m;
      while ((m = pattern.exec(s))) {
        sub += runText(s.slice(last, m.index), []);
        sub += runText(m[0], []);
        last = m.index + m[0].length;
      }
      if (last < s.length) sub += runText(s.slice(last), []);
      return sub;
    }
    while ((match = mathRe.exec(text))) {
      var latex = match[2] !== undefined ? match[2] : match[3];
      var prefix = match[1] || '';
      var start = match.index + prefix.length;
      out += plainSegment(text.slice(cursor, start));
      var omml = latex && latex.trim() ? ommlInline(latex.trim()) : null;
      if (omml) out += omml;
      else out += plainSegment(match[0]);
      cursor = match.index + match[0].length;
    }
    out += plainSegment(text.slice(cursor));
    return out || '<w:r><w:t xml:space="preserve"></w:t></w:r>';
  }

  function parseInlineToken(t, styles) {
    if (/^\*\*/.test(t)) return { text: t.slice(2, -2), styles: styles.concat(['b']) };
    if (/^\*/.test(t)) return { text: t.slice(1, -1), styles: styles.concat(['i']) };
    if (/^`/.test(t)) return { text: t.slice(1, -1), styles: styles.concat(['code']) };
    if (/^~~/.test(t)) return { text: t.slice(2, -2), styles: styles.concat(['strike']) };
    var link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
    return { text: link ? link[1] + ' (' + link[2] + ')' : t, styles: styles };
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
      // Block math: $$ ... $$ (single line or multi-line) and \[ ... \].
      var blockMath = null;
      var singleDollar = /^\s*\$\$(.+?)\$\$\s*$/.exec(line);
      if (singleDollar && singleDollar[1].trim()) {
        blockMath = singleDollar[1].trim();
        i++;
      } else if (/^\s*\$\$\s*$/.test(line)) {
        var collected = [];
        i++;
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { collected.push(lines[i]); i++; }
        if (i < lines.length) i++;
        if (collected.join('\n').trim()) blockMath = collected.join('\n').trim();
      } else if (/^\s*\\\[\s*/.test(line)) {
        // Display math opener `\[`. Must close with `\]` on the same line, or within
        // a bounded lookahead (max 12 lines) — never swallow the rest of the document
        // when a plain escaped `\[` (e.g. from a segmented-control label) shows up.
        var mOpen = /^\s*\\\[\s*(.*)$/.exec(line);
        var parts = mOpen[1] ? [mOpen[1]] : [];
        var j = i + 1;
        var closed = /\\\]\s*$/.test(line);
        if (!closed) {
          while (j < lines.length && j <= i + 12 && !/\\\]\s*$/.test(lines[j])) { parts.push(lines[j]); j++; }
          if (j < lines.length && /\\\]\s*$/.test(lines[j])) closed = true;
        }
        if (closed) {
          if (j < lines.length) {
            var lastLine2 = lines[j].replace(/\\\]\s*$/, '');
            if (lastLine2.trim()) parts.push(lastLine2);
            j++;
          }
          i = j;
          if (parts.join('\n').trim()) blockMath = parts.join('\n').trim();
        }
        // If not closed, fall through as ordinary text (no i++ here).
      }
      if (blockMath !== null) {
        var omml = (typeof window !== 'undefined' && window.ChatSavorOmml && typeof window.ChatSavorOmml.latexToOmml === 'function')
          ? window.ChatSavorOmml.latexToOmml(blockMath, true) : null;
        if (omml) body += '<w:p>' + omml + '</w:p>';
        else body += '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">' + esc('$$' + blockMath + '$$') + '</w:t></w:r></w:p>';
        continue;
      }
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
          var colCount = Math.max(1, rows.reduce(function(m, r) { return Math.max(m, r.length); }, 0));
          // A4 usable width 9026 dxa (11906 - 2*1440 margins) minus borders, distributed evenly.
          var colWidth = Math.floor(9026 / colCount);
          body += '<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>';
          rows.forEach(function(row, r) {
            body += '<w:tr>';
            row.forEach(function(cell) {
              var tcPr = '<w:tcPr><w:tcW w:w="' + colWidth + '" w:type="dxa"/>' + (r === 0 ? '<w:shd w:val="clear" w:fill="F0F0F0"/>' : '') + '</w:tcPr>';
              body += '<w:tc>' + tcPr + paragraph(cell, r === 0 ? 'TableHeader' : null) + '</w:tc>';
            });
            body += '</w:tr>';
          });
          body += '</w:tbl>';
        }
        continue;
      }
      // Horizontal rule `---` becomes a bottom border (no stray "---" text).
      if (/^\s*-{3,}\s*$/.test(line)) {
        body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="cbd5e1"/></w:pBdr></w:pPr></w:p>';
        i++; continue;
      }
      if (!line.trim()) { i++; continue; }
      var cleanLine = line;
      // Strip Markdown escape backslashes for literal punctuation (not math delimiters).
      cleanLine = cleanLine.replace(/\\([\\`*{}\[\]()#+\-.!_~>])/g, '$1');
      body += paragraph(/^>\s?/.test(cleanLine) ? cleanLine.replace(/^>\s?/, '') : cleanLine, /^>\s?/.test(cleanLine) ? 'Quote' : null);
      i++;
    }
    if (inCode) {
      codeLines.forEach(function(codeLine) { body += '<w:p><w:pPr><w:shd w:val="clear" w:fill="F4F4F4"/></w:pPr><w:r><w:t xml:space="preserve">' + esc(codeLine) + '</w:t></w:r></w:p>'; });
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' + body +
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
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var styles = stylesXml();
    var files = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/document.xml', data: markdownToDocumentXml(markdown) },
    ];
    var mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (typeof window !== 'undefined' && window.ChatSavorZip && typeof window.ChatSavorZip.pack === 'function') {
      return window.ChatSavorZip.pack(files, mime);
    }
    return zip(files);
  }

  // ── Image embedding (defect 1) ──
  function base64ToBytes(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function dataUriToImage(uri) {
    var m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/s.exec(String(uri || '').trim());
    if (!m) return null;
    return { mimeType: m[1].toLowerCase(), bytes: base64ToBytes(m[2]) };
  }

  function svgTextFromUri(uri) {
    try {
      var m = /^data:image\/svg\+xml((?:;[^,]*)?),([\s\S]*)$/i.exec(String(uri || '').trim());
      if (!m) return null;
      if (/;base64/i.test(m[1])) return decodeURIComponent(escape(atob(m[2].replace(/\s+/g, ''))));
      return decodeURIComponent(m[2]);
    } catch (ignored) { return null; }
  }

  function svgDimensions(svgText) {
    var tag = /<svg\b[^>]*>/i.exec(svgText);
    if (!tag) return { w: 600, h: 400 };
    var vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (vb) {
      var nums = vb[1].split(/[\s,]+/).map(Number);
      if (nums.length >= 4 && nums[2] > 0 && nums[3] > 0) return { w: Math.round(nums[2]), h: Math.round(nums[3]) };
    }
    var w = /width\s*=\s*["'](\d+(?:\.\d+)?)["']/i.exec(tag[0]);
    var h = /height\s*=\s*["'](\d+(?:\.\d+)?)["']/i.exec(tag[0]);
    return { w: w ? Math.round(parseFloat(w[1])) : 600, h: h ? Math.round(parseFloat(h[1])) : 400 };
  }

  function rasterizeSvgToPng(svgText, targetScale) {
    return new Promise(function(resolve, reject) {
      try {
        var dims = svgDimensions(svgText);
        var scale = targetScale || 3;
        var img = new Image();
        var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        img.onload = function() {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(dims.w * scale));
            canvas.height = Math.max(1, Math.round(dims.h * scale));
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function(blob) {
              if (!blob || blob.size === 0) { reject(new Error('empty raster')); return; }
              var reader = new FileReader();
              reader.onload = function() { resolve({ bytes: new Uint8Array(reader.result), w: dims.w, h: dims.h }); };
              reader.onerror = reject;
              reader.readAsArrayBuffer(blob);
            }, 'image/png');
          } catch (err) { reject(err); }
        };
        img.onerror = function() { reject(new Error('svg decode failed')); };
        img.src = url;
      } catch (err) { reject(err); }
    });
  }

  function fetchRemoteImage(url) {
    return new Promise(function(resolve, reject) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'CHATSAVOR_FETCH_IMAGE', url: url }, function(response) {
            if (response && response.ok && response.base64) resolve({ bytes: base64ToBytes(response.base64), mimeType: response.contentType || 'image/png' });
            else reject(new Error(response && response.error || 'fetch failed'));
          });
        } else reject(new Error('no fetch channel'));
      } catch (err) { reject(err); }
    });
  }

  function drawingXml(rId, docPrId, cx, cy) {
    return '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + docPrId + '" name="Picture ' + docPrId + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="' + docPrId + '" name="image"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rId + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  }

  // Renders an inline image (standalone <img> or embedded) into media + DrawingML,
  // returning { mediaEntries, relsXml, drawing, alt }.
  function prepareImage(src, alt, docPrId, existingRelsXml) {
    // Existing rels xml already has rId1 for styles; append new image relationships.
    var idx = (existingRelsXml.match(/<Relationship /g) || []).length + 1;
    var rId = 'rId' + idx;
    var ext = 'png';
    var bytes = null;
    var w = 0, h = 0;
    if (/^data:image\/svg\+xml/i.test(src)) {
      var svgText = svgTextFromUri(src);
      if (!svgText) return Promise.resolve(null);
      var dims = svgDimensions(svgText);
      w = dims.w; h = dims.h;
      return rasterizeSvgToPng(svgText, 3).then(function(r) { return { rId: rId, bytes: r.bytes, ext: 'png', w: dims.w, h: dims.h }; });
    }
    if (/^data:image\/(?:png|jpeg|jpg|gif);base64/i.test(src)) {
      var parsed = dataUriToImage(src);
      if (!parsed) return Promise.resolve(null);
      bytes = parsed.bytes;
      ext = parsed.mimeType === 'image/jpeg' ? 'jpeg' : 'png';
      // PNG/JPEG dimensions unknown without decode; assume a sensible aspect via marker, else default.
      return Promise.resolve({ rId: rId, bytes: bytes, ext: ext, w: w || 600, h: h || 400 });
    }
    if (/^data:image\/webp;base64/i.test(src)) {
      return fetchOrDecodeWebp(src, rId);
    }
    if (/^https?:\/\//i.test(src)) {
      return fetchRemoteImage(src).then(function(r) {
        if (r.mimeType === 'image/svg+xml' || /svg/.test(src)) {
          var svgT = svgTextFromUri ? null : null;
          // remote SVG text not available without fetch text; rasterize via img src.
          return rasterizeSvgFromUrl(src, rId);
        }
        return { rId: rId, bytes: r.bytes, ext: r.mimeType === 'image/jpeg' ? 'jpeg' : 'png', w: 600, h: 400 };
      }).catch(function() { return null; });
    }
    return Promise.resolve(null);
  }

  function fetchOrDecodeWebp(src, rId) {
    // WebP must be rasterized via <img> into PNG.
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 600;
        canvas.height = img.naturalHeight || 400;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          if (!blob) { resolve(null); return; }
          var reader = new FileReader();
          reader.onload = function() { resolve({ rId: rId, bytes: new Uint8Array(reader.result), ext: 'png', w: canvas.width, h: canvas.height }); };
          reader.onerror = function() { resolve(null); };
          reader.readAsArrayBuffer(blob);
        }, 'image/png');
      };
      img.onerror = function() { resolve(null); };
      img.src = src;
    });
  }

  function rasterizeSvgFromUrl(url, rId) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 600;
        canvas.height = img.naturalHeight || 400;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          if (!blob) { resolve(null); return; }
          var reader = new FileReader();
          reader.onload = function() { resolve({ rId: rId, bytes: new Uint8Array(reader.result), ext: 'png', w: canvas.width, h: canvas.height }); };
          reader.onerror = function() { resolve(null); };
          reader.readAsArrayBuffer(blob);
        }, 'image/png');
      };
      img.onerror = function() { resolve(null); };
      img.src = url;
    });
  }

  // Detect whether this markdown needs the async image pipeline.
  function needsAsyncMedia(markdown) {
    var md = String(markdown || '');
    return /data:image\/svg\+xml/i.test(md) || /data:image\/webp/i.test(md) || /!\[[^\]]*\]\(https?:\/\//i.test(md) || /<img[^>]+src=["']https?:\/\//i.test(md);
  }

  // Async builder that embeds images as word/media/*.png with DrawingML.
  function buildAsync(markdown) {
    var md = String(markdown || '');
    var imageRefs = [];
    var re = /!\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g;
    var m;
    while ((m = re.exec(md))) imageRefs.push({ alt: m[1], src: m[2] });
    if (!imageRefs.length) return Promise.resolve(build(md));

    var baseRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var mediaEntries = [];
    var relEntries = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
    var replacements = {};
    var chain = Promise.resolve();
    imageRefs.forEach(function(ref, idx) {
      chain = chain.then(function() {
        return prepareImage(ref.src, ref.alt, idx + 1, baseRels).then(function(ready) {
          if (!ready) { replacements[ref.src] = null; return; }
          var mediaName = 'word/media/image' + (idx + 1) + '.' + ready.ext;
          mediaEntries.push({ name: mediaName, data: ready.bytes });
          var relId = 'rId' + (relEntries.length + 1);
          relEntries.push('<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + (idx + 1) + '.' + ready.ext + '"/>');
          var emuW = Math.round((ready.w || 600) * 9525);
          var emuH = Math.round((ready.h || 400) * 9525);
          replacements[ref.src] = { drawing: drawingXml(relId, idx + 1, emuW, emuH), alt: ref.alt };
        });
      });
    });
    return chain.then(function() {
      // Rewrite markdown: replace image syntax with a block placeholder the doc
      // builder can emit as DrawingML (never Base64 text).
      var md2 = md;
      imageRefs.forEach(function(ref) {
        var rep = replacements[ref.src];
        var token = rep ? ('\u0000IMG{' + ref.src + '}\u0000') : '';
        // Escape src for regex.
        var escSrc = ref.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var imgRe = new RegExp('!\\[[^\\]]*\\]\\(<?' + escSrc + '>?\\)', 'g');
        md2 = md2.replace(imgRe, function() {
          return rep ? '\n\n\u0000IMG{' + ref.src + '}\u0000\n\n' : '';
        });
      });
      var docXml = markdownToDocumentXmlWithImages(md2, replacements);
      var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
      var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
      var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relEntries.join('') + '</Relationships>';
      var files = [
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'word/_rels/document.xml.rels', data: docRels },
        { name: 'word/styles.xml', data: stylesXml() },
        { name: 'word/document.xml', data: docXml },
      ].concat(mediaEntries);
      var mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (typeof window !== 'undefined' && window.ChatSavorZip && typeof window.ChatSavorZip.pack === 'function') {
        return window.ChatSavorZip.pack(files, mime);
      }
      return zip(files);
    });
  }

  // Like markdownToDocumentXml, but replaces \u0000IMG{src}\u0000 with DrawingML.
  function markdownToDocumentXmlWithImages(markdown, replacements) {
    var lines = String(markdown || '').split(/\r?\n/);
    var body = '';
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var imgToken = /^\u0000IMG\{(.*)\}\u0000\s*$/.exec(line.trim());
      if (imgToken) {
        var rep = replacements[imgToken[1]];
        if (rep && rep.drawing) {
          body += '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>' + rep.drawing + '</w:r></w:p>';
        }
        i++; continue;
      }
      // Fallback: use the plain builder for non-image lines.
      body += lineToParagraph(line);
      i++;
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  }

  function lineToParagraph(line) {
    if (!line.trim()) return '';
    if (/^\s*-{3,}\s*$/.test(line)) return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="cbd5e1"/></w:pBdr></w:pPr></w:p>';
    return paragraph(line, null);
  }

  window.ChatSavorDocx = { build: build, buildAsync: buildAsync, needsAsyncMedia: needsAsyncMedia, crc32: crc32, zip: zip, markdownToDocumentXml: markdownToDocumentXml, stylesXml: stylesXml };
})();
