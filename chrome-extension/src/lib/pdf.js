// ChatSavor PDF exporter
// Renders markdown onto canvases, then embeds those pages into a PDF for direct download.

window.ChatSavorPdf = (function() {
  'use strict';

  var PAGE_WIDTH = 1240;
  var PAGE_HEIGHT = 1754;
  var PAGE_WIDTH_PT = 595.28;
  var PAGE_HEIGHT_PT = 841.89;
  var MARGIN_X = 96;
  var MARGIN_Y = 112;
  var CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);
  var FONT_SANS = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  var FONT_MONO = '"SFMono-Regular","Cascadia Code","Fira Code","Menlo","Consolas","Microsoft YaHei",monospace';

  function createPage() {
    var canvas = document.createElement('canvas');
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.textBaseline = 'top';

    return { canvas: canvas, ctx: ctx, y: MARGIN_Y };
  }

  function createRenderer() {
    return {
      pages: [createPage()],
      current: null,
    };
  }

  function getCurrentPage(renderer) {
    if (!renderer.current) renderer.current = renderer.pages[0];
    return renderer.current;
  }

  function addPage(renderer) {
    var page = createPage();
    renderer.pages.push(page);
    renderer.current = page;
    return page;
  }

  function ensureSpace(renderer, height) {
    var page = getCurrentPage(renderer);
    if (page.y + height <= (PAGE_HEIGHT - MARGIN_Y)) return page;
    return addPage(renderer);
  }

  function setFont(ctx, style) {
    ctx.font = (style.fontWeight || '400') + ' ' + style.fontSize + 'px ' + (style.fontFamily || FONT_SANS);
    ctx.fillStyle = style.color || '#1f2937';
  }

  function wrapText(ctx, text, maxWidth, preserveWhitespace) {
    var source = String(text || '').replace(/\t/g, '    ');
    if (!source) return [''];

    var lines = [];
    var current = '';
    var chars = Array.from(source);

    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var next = current + ch;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(preserveWhitespace ? current : current.replace(/\s+$/g, ''));
        current = preserveWhitespace ? ch : ch.replace(/^\s+/g, '');
      } else {
        current = next;
      }
    }

    if (current || lines.length === 0) {
      lines.push(preserveWhitespace ? current : current.replace(/\s+$/g, ''));
    }

    return lines;
  }

  function drawWrappedBlock(renderer, text, style) {
    var page = getCurrentPage(renderer);
    var ctx = page.ctx;
    var lineHeight = style.lineHeight || Math.round(style.fontSize * 1.6);
    var marginTop = style.marginTop || 0;
    var marginBottom = style.marginBottom || 0;
    var paddingX = style.paddingX || 0;
    var paddingY = style.paddingY || 0;
    var indent = style.indent || 0;
    var blockX = MARGIN_X + indent;
    var textX = blockX + paddingX + (style.borderLeftWidth || 0) + (style.borderLeftGap || 0);
    var textWidth = CONTENT_WIDTH - indent - (paddingX * 2) - (style.borderLeftWidth || 0) - (style.borderLeftGap || 0);

    setFont(ctx, style);
    var rawLines = String(text || '').split('\n');
    var lines = [];

    rawLines.forEach(function(rawLine) {
      var wrapped = wrapText(ctx, rawLine, textWidth, !!style.preserveWhitespace);
      if (wrapped.length === 0) wrapped = [''];
      for (var i = 0; i < wrapped.length; i++) lines.push(wrapped[i]);
    });

    page = ensureSpace(renderer, marginTop);
    page.y += marginTop;

    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      page = ensureSpace(renderer, lineHeight + (paddingY * 2));
      ctx = page.ctx;
      setFont(ctx, style);

      var top = page.y;
      var rectHeight = lineHeight + (paddingY * 2);
      var rectWidth = CONTENT_WIDTH - indent;

      if (style.backgroundColor) {
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(blockX, top, rectWidth, rectHeight);
      }

      if (style.borderLeftColor && style.borderLeftWidth) {
        ctx.fillStyle = style.borderLeftColor;
        ctx.fillRect(blockX, top, style.borderLeftWidth, rectHeight);
      }

      ctx.fillStyle = style.color || '#1f2937';
      ctx.fillText(lines[lineIndex], textX, top + paddingY);
      page.y += rectHeight;
    }

    page.y += marginBottom;
  }

  function renderMarkdown(markdown) {
    var renderer = createRenderer();
    renderer.current = renderer.pages[0];

    var lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) {
        getCurrentPage(renderer).y += 18;
        i++;
        continue;
      }

      if (/^```/.test(line)) {
        var codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        drawWrappedBlock(renderer, codeLines.join('\n') || ' ', {
          fontFamily: FONT_MONO,
          fontSize: 22,
          lineHeight: 34,
          color: '#111827',
          backgroundColor: '#f6f8fa',
          paddingX: 18,
          paddingY: 8,
          marginTop: 10,
          marginBottom: 18,
          preserveWhitespace: true,
        });
        i++;
        continue;
      }

      var headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var fontSize = [42, 34, 30, 26, 24, 22][level - 1] || 22;
        drawWrappedBlock(renderer, headingMatch[2], {
          fontFamily: FONT_SANS,
          fontSize: fontSize,
          lineHeight: Math.round(fontSize * 1.35),
          fontWeight: '700',
          color: '#111827',
          marginTop: level <= 2 ? 20 : 14,
          marginBottom: 12,
        });
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        var quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        drawWrappedBlock(renderer, quoteLines.join('\n'), {
          fontFamily: FONT_SANS,
          fontSize: 24,
          lineHeight: 38,
          color: '#4b5563',
          backgroundColor: '#f8f9ff',
          borderLeftColor: '#667eea',
          borderLeftWidth: 6,
          borderLeftGap: 14,
          paddingX: 14,
          paddingY: 8,
          marginTop: 8,
          marginBottom: 14,
        });
        continue;
      }

      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
        drawWrappedBlock(renderer, line.replace(/^\s*/, ''), {
          fontFamily: FONT_SANS,
          fontSize: 24,
          lineHeight: 38,
          color: '#1f2937',
          indent: 10,
          marginTop: 4,
          marginBottom: 6,
        });
        i++;
        continue;
      }

      if (line.indexOf('|') !== -1) {
        var tableLines = [line];
        while ((i + 1) < lines.length && lines[i + 1].indexOf('|') !== -1 && lines[i + 1].trim()) {
          tableLines.push(lines[i + 1]);
          i++;
        }
        drawWrappedBlock(renderer, tableLines.join('\n'), {
          fontFamily: FONT_MONO,
          fontSize: 21,
          lineHeight: 32,
          color: '#1f2937',
          backgroundColor: '#f9fafb',
          paddingX: 14,
          paddingY: 7,
          marginTop: 8,
          marginBottom: 14,
          preserveWhitespace: true,
        });
        i++;
        continue;
      }

      drawWrappedBlock(renderer, line, {
        fontFamily: FONT_SANS,
        fontSize: 24,
        lineHeight: 38,
        color: '#1f2937',
        marginTop: 4,
        marginBottom: 8,
      });
      i++;
    }

    return renderer.pages.map(function(page) { return page.canvas; });
  }

  function base64ToBinary(base64) {
    return atob(base64);
  }

  function escapePdfText(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function buildPdfFromCanvases(canvases, title) {
    var objects = [];
    var pageRefs = [];

    function addObject(body) {
      objects.push(body);
      return objects.length;
    }

    var catalogRef = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    var pagesRef = addObject('<< /Type /Pages /Kids [] /Count 0 >>');

    var infoRef = addObject('<< /Title (' + escapePdfText(title || 'AI Response') + ') /Producer (ChatSavor) >>');

    for (var i = 0; i < canvases.length; i++) {
      var jpegDataUrl = canvases[i].toDataURL('image/jpeg', 0.92);
      var base64 = jpegDataUrl.split(',')[1];
      var binaryImage = base64ToBinary(base64);
      var imageRef = addObject(
        '<< /Type /XObject /Subtype /Image /Width ' + canvases[i].width +
        ' /Height ' + canvases[i].height +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + binaryImage.length + ' >>\nstream\n' +
        binaryImage + '\nendstream'
      );

      var stream = 'q\n' + PAGE_WIDTH_PT + ' 0 0 ' + PAGE_HEIGHT_PT + ' 0 0 cm\n/Im' + (i + 1) + ' Do\nQ';
      var contentRef = addObject('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      var pageRef = addObject(
        '<< /Type /Page /Parent ' + pagesRef + ' 0 R /MediaBox [0 0 ' + PAGE_WIDTH_PT + ' ' + PAGE_HEIGHT_PT + '] ' +
        '/Resources << /XObject << /Im' + (i + 1) + ' ' + imageRef + ' 0 R >> >> /Contents ' + contentRef + ' 0 R >>'
      );
      pageRefs.push(pageRef + ' 0 R');
    }

    objects[1] = '<< /Type /Pages /Kids [' + pageRefs.join(' ') + '] /Count ' + pageRefs.length + ' >>';

    var pdf = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
    var offsets = [0];

    for (var objIndex = 0; objIndex < objects.length; objIndex++) {
      offsets[objIndex + 1] = pdf.length;
      pdf += (objIndex + 1) + ' 0 obj\n' + objects[objIndex] + '\nendobj\n';
    }

    var xrefStart = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
    pdf += '0000000000 65535 f \n';

    for (var offsetIndex = 1; offsetIndex < offsets.length; offsetIndex++) {
      pdf += String(offsets[offsetIndex]).padStart(10, '0') + ' 00000 n \n';
    }

    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalogRef + ' 0 R /Info ' + infoRef + ' 0 R >>\n';
    pdf += 'startxref\n' + xrefStart + '\n%%EOF';

    var bytes = new Uint8Array(pdf.length);
    for (var byteIndex = 0; byteIndex < pdf.length; byteIndex++) {
      bytes[byteIndex] = pdf.charCodeAt(byteIndex) & 0xFF;
    }

    return new Blob([bytes], { type: 'application/pdf' });
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'ai-response.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function downloadMarkdownPdf(markdown, options) {
    options = options || {};

    return new Promise(function(resolve, reject) {
      try {
        var canvases = renderMarkdown(markdown);
        var blob = buildPdfFromCanvases(canvases, options.title || 'AI Response');
        triggerDownload(blob, options.filename || 'ai-response.pdf');
        resolve(blob);
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    downloadMarkdownPdf: downloadMarkdownPdf,
  };
})();
