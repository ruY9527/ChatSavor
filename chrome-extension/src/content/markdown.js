// Shared, source-preserving Markdown conversion and offline equation rendering.
window.ChatSavorMarkdown = (function() {
  'use strict';

  var turndownService;
  var markedLib;
  var MATH_SELECTOR = '.katex-display, .katex, mjx-container, math, .MathJax_Display, script[type^="math/tex"], [data-latex], [data-tex], [data-math]';

  function escapeHtml(value) {
    var span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
  }

  function isEscaped(text, index) {
    var count = 0;
    while (index > 0 && text[--index] === '\\') count++;
    return count % 2 === 1;
  }

  function readMath(text, index) {
    if (isEscaped(text, index)) return null;
    var open, close, display;
    if (text.slice(index, index + 2) === '\\[') { open = '\\['; close = '\\]'; display = true; }
    else if (text.slice(index, index + 2) === '\\(') { open = '\\('; close = '\\)'; display = false; }
    else if (text.slice(index, index + 2) === '$$') { open = close = '$$'; display = true; }
    else if (text[index] === '$' && text[index + 1] !== '$' && !/\s/.test(text[index + 1] || ' ')) { open = close = '$'; display = false; }
    else return null;
    var start = index + open.length;
    var end = text.indexOf(close, start);
    while (end !== -1) {
      if (!isEscaped(text, end)) {
        if (close === '$' && (/\s/.test(text[end - 1]) || /\d/.test(text[end + 1] || '') || text[end + 1] === '$')) return null;
        var latex = text.slice(start, end).trim();
        if (!latex || (!display && /\n\s*\n/.test(latex))) return null;
        return { raw: text.slice(index, end + close.length), latex: latex, display: display };
      }
      end = text.indexOf(close, end + close.length);
    }
    return null;
  }

  function normalizeLatex(source) {
    source = source.replace(/\r\n?/g, '\n').trim();
    var enclosed = readMath(source, 0);
    return enclosed && enclosed.raw.length === source.length ? enclosed.latex : source;
  }

  function formatMath(latex, display, inTable) {
    latex = normalizeLatex(latex);
    if (inTable) {
      // Markdown consumes escaped table separators. Preserve TeX's double-bar command separately.
      latex = latex.replace(/\\\|/g, '\\Vert ').replace(/\|/g, '\\|');
      display = false;
    }
    if (!display) return '$' + latex.replace(/\s*\n\s*/g, ' ').trim() + '$';
    return '$$\n' + latex + '\n$$';
  }

  function getMathSource(node) {
    var annotation = node.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]');
    if (annotation && annotation.textContent.trim()) return annotation.textContent;
    var sourceNode = node.matches('script[type^="math/tex"]') ? node : node.querySelector('script[type^="math/tex"]');
    if (sourceNode) return sourceNode.textContent;
    var attributes = ['data-latex', 'data-tex', 'data-math', 'alttext'];
    var sources = [node].concat(Array.from(node.querySelectorAll('[data-latex], [data-tex], [data-math], math[alttext]')));
    for (var i = 0; i < sources.length; i++) {
      for (var j = 0; j < attributes.length; j++) {
        var value = sources[i].getAttribute(attributes[j]);
        if (value && value.trim() && value !== 'true' && value !== 'false') return value;
      }
    }
    return null;
  }

  function protectMath(root) {
    var tokens = [];
    var prefix = 'CHATSAVORMATH';
    while (root.textContent.indexOf(prefix) !== -1) prefix += 'X';
    function placeholder(latex, display, inTable, html) {
      var token = prefix + 'TOKEN' + tokens.length + 'END';
      var node = document.createElement(display && !inTable ? 'div' : 'span');
      node.textContent = token;
      tokens.push({ token: token, value: html || formatMath(latex, display, inTable) });
      return node;
    }

    Array.from(root.querySelectorAll(MATH_SELECTOR)).forEach(function(node) {
      if (!root.contains(node) || node.closest('pre, code')) return;
      var source = getMathSource(node);
      if (node.matches('script[type^="math/tex"]')) {
        var previous = node.previousElementSibling;
        while (previous && previous.matches('.MathJax, .MathJax_Display, .MathJax_Preview, mjx-container')) {
          var before = previous.previousElementSibling;
          previous.remove();
          previous = before;
        }
      }
      // Legacy MathJax may put its source in a following script; let that script handle it.
      if (!source && node.matches('.MathJax_Display') && node.nextElementSibling && node.nextElementSibling.matches('script[type^="math/tex"]')) return;
      var inTable = !!node.closest('td, th');
      var display = node.matches('.katex-display, .MathJax_Display, mjx-container[display="true"], math[display="block"], [data-display="block"], [data-display="true"]') ||
        !!node.querySelector('math[display="block"]') || /mode\s*=\s*display/.test(node.getAttribute('type') || '');
      if (source) {
        node.replaceWith(placeholder(source, display, inTable));
      } else {
        var math = node.matches('math') ? node : node.querySelector('math');
        var original = math ? math.outerHTML : escapeHtml(node.textContent);
        node.replaceWith(placeholder('', false, inTable, '<span data-chatsavor-unconverted-math="true">' + original + '</span>'));
      }
    });

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function(node) {
      if (node.parentElement.closest('pre, code, script, style, [data-chatsavor-unconverted-math]')) return;
      var text = node.nodeValue;
      var fragment = document.createDocumentFragment();
      var last = 0;
      for (var i = 0; i < text.length; i++) {
        var math = readMath(text, i);
        if (!math) continue;
        fragment.appendChild(document.createTextNode(text.slice(last, i)));
        fragment.appendChild(placeholder(math.latex, math.display, !!node.parentElement.closest('td, th')));
        i += math.raw.length - 1;
        last = i + 1;
      }
      if (last) {
        fragment.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(fragment);
      }
    });
    return tokens;
  }

  function getTurndown() {
    if (turndownService) return turndownService;
    if (typeof TurndownService !== 'function') return null;
    turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    var originalEscape = turndownService.escape;
    turndownService.escape = function(text) { return originalEscape.call(this, text).replace(/\$/g, '\\$'); };
    turndownService.addRule('fencedCodeBlock', {
      filter: function(node) { return node.nodeName === 'PRE'; },
      replacement: function(content, node) {
        var code = node.querySelector('code') || node;
        var lang = ((code.className || '').match(/(?:language-|lang-)(\S+)/) || ['', ''])[1];
        var text = code.textContent || '';
        var runs = text.match(/`{3,}/g) || [];
        var length = runs.reduce(function(max, run) { return Math.max(max, run.length + 1); }, 3);
        var fence = '`'.repeat(length);
        return '\n\n' + fence + lang + '\n' + text.replace(/\n$/, '') + '\n' + fence + '\n\n';
      }
    });
    turndownService.addRule('table', { filter: 'table', replacement: function(content, table) { return '\n\n' + tableToMarkdown(table) + '\n\n'; } });
    turndownService.addRule('strikethrough', { filter: ['del', 's', 'strike'], replacement: function(content) { return '~~' + content + '~~'; } });
    turndownService.addRule('checkbox', {
      filter: function(node) { return node.nodeName === 'INPUT' && node.type === 'checkbox'; },
      replacement: function(content, node) { return node.checked ? '[x] ' : '[ ] '; }
    });
    return turndownService;
  }

  function tableToMarkdown(table) {
    var rows = Array.from(table.querySelectorAll('tr')).filter(function(row) { return row.closest('table') === table; });
    var matrix = rows.map(function() { return []; });
    var firstRowHasHeader = false;
    rows.forEach(function(row, rowIndex) {
      var column = 0;
      Array.from(row.children).filter(function(cell) { return cell.matches('th, td'); }).forEach(function(cell) {
        while (matrix[rowIndex][column] !== undefined) column++;
        if (rowIndex === 0 && cell.nodeName === 'TH') firstRowHasHeader = true;
        var value = getTurndown().turndown(cell.innerHTML).trim().replace(/\n+/g, '<br>');
        value = value.replace(/(\\*)\|/g, function(match, slashes) { return (slashes.length % 2 ? '' : '\\') + match; });
        var colspan = Math.min(Math.max(parseInt(cell.getAttribute('colspan'), 10) || 1, 1), 100);
        var rowspan = Math.min(Math.max(parseInt(cell.getAttribute('rowspan'), 10) || 1, 1), rows.length - rowIndex);
        for (var r = 0; r < rowspan; r++) {
          for (var c = 0; c < colspan; c++) matrix[rowIndex + r][column + c] = r === 0 && c === 0 ? value : '';
        }
        column += colspan;
      });
    });
    var columns = matrix.reduce(function(max, row) { return Math.max(max, row.length); }, 0);
    if (!columns) return '';
    matrix = matrix.map(function(row) { return Array.from({ length: columns }, function(_, i) { return row[i] || ''; }); });
    var header = firstRowHasHeader ? matrix.shift() : Array.from({ length: columns }, function(_, i) { return 'Column ' + (i + 1); });
    return [header, header.map(function() { return '---'; })].concat(matrix).map(function(row) { return '| ' + row.join(' | ') + ' |'; }).join('\n');
  }

  function restoreTokens(markdown, tokens) {
    tokens.forEach(function(item) {
      markdown = markdown.replace(new RegExp(item.token, 'g'), function(token, offset, source) {
        var prefix = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
        var continuation = /^(?:[ \t]|>)*(?:(?:[-+*]|\d+\.)[ \t]+)?$/.test(prefix)
          ? prefix.replace(/(?:[-+*]|\d+\.)[ \t]+$/, function(marker) { return ' '.repeat(marker.length); }) : '';
        return item.value.replace(/\n/g, '\n' + continuation);
      });
    });
    return markdown;
  }

  function extract(container) {
    var root = document.createElement('div');
    root.appendChild(window.ChatSavorDOM ? window.ChatSavorDOM.clone(container) : container.cloneNode(true));
    var tokens = protectMath(root);
    root.querySelectorAll('.ai-saver-host, .ai-saver-modal-host, .ai-saver-btn, button, [role="button"], input:not([type="checkbox"]), textarea, select, script, style, noscript, [hidden], [aria-hidden="true"]').forEach(function(node) { node.remove(); });
    root.querySelectorAll('svg').forEach(function(node) { node.remove(); });
    var td = getTurndown();
    var markdown = restoreTokens(td ? td.turndown(root) : root.textContent.trim(), tokens);
    return markdown ? { markdown: markdown, html: render(markdown) } : null;
  }

  function renderMath(latex, display) {
    var tag = display ? 'div' : 'span';
    var source = formatMath(latex, display, false);
    try {
      if (!window.katex) throw new Error('公式渲染器未加载');
      var html = window.katex.renderToString(latex, { displayMode: display, output: 'mathml', throwOnError: true, trust: false, strict: 'ignore' });
      return '<' + tag + ' class="chatsavor-math" data-latex="' + escapeHtml(latex).replace(/"/g, '&quot;') + '">' + html + '</' + tag + '>';
    } catch (error) {
      return '<' + tag + ' class="math-error" title="' + escapeHtml(error.message).replace(/"/g, '&quot;') + '">' + escapeHtml(source) + '</' + tag + '>';
    }
  }

  function getMarked() {
    if (markedLib) return markedLib;
    if (!window.marked) return null;
    markedLib = new window.marked.Marked({ gfm: true });
    markedLib.use({ extensions: [
      {
        name: 'blockMath', level: 'block',
        start: function(src) { var index = src.indexOf('$$'); return index < 0 ? undefined : index; },
        tokenizer: function(src) {
          var match = /^(?:\$\$|\\\[)/.test(src) && readMath(src, 0);
          if (match && match.display && /^(?:[ \t]*\n|[ \t]*$)/.test(src.slice(match.raw.length))) return { type: 'blockMath', raw: match.raw, latex: match.latex };
        },
        renderer: function(token) { return renderMath(token.latex, true) + '\n'; }
      },
      {
        name: 'inlineMath', level: 'inline',
        start: function(src) { var match = /\$|\\[([]/.exec(src); return match ? match.index : undefined; },
        tokenizer: function(src) {
          var match = readMath(src, 0);
          if (match) return { type: 'inlineMath', raw: match.raw, latex: match.latex, display: match.display };
        },
        renderer: function(token) { return renderMath(token.latex, token.display); }
      }
    ] });
    return markedLib;
  }

  function sanitizeHtml(html) {
    var root = document.createElement('div');
    root.innerHTML = html;
    root.querySelectorAll('script, style, iframe, frame, object, embed, base, link, meta, form, input, textarea, select, button, annotation-xml').forEach(function(node) { node.remove(); });
    var allowed = /^(?:class|title|alt|href|src|start|colspan|rowspan|scope|align|display|encoding|xmlns|mathvariant|mathsize|mathcolor|stretchy|fence|separator|lspace|rspace|accent|accentunder|columnalign|rowalign|rowspacing|columnspacing|displaystyle|scriptlevel|linethickness|width|height|depth|voffset|selection|data-latex|data-chatsavor-unconverted-math)$/;
    root.querySelectorAll('*').forEach(function(node) {
      Array.from(node.attributes).forEach(function(attribute) {
        var url = attribute.value.replace(/[\u0000-\u0020]/g, '');
        var mathAttribute = node.namespaceURI === 'http://www.w3.org/1998/Math/MathML' && !/^(?:on|style$|href$|src$|xlink:href$|definitionurl$)/i.test(attribute.name);
        if ((!allowed.test(attribute.name) && !mathAttribute) || (/^(?:href|src)$/.test(attribute.name) && /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(?:https?|mailto|tel):/i.test(url))) node.removeAttribute(attribute.name);
      });
    });
    return root.innerHTML;
  }

  function render(markdown) {
    var m = getMarked();
    return sanitizeHtml(m ? m.parse(markdown) : '<pre>' + escapeHtml(markdown) + '</pre>');
  }

  function getFormulas(markdown) {
    var m = getMarked();
    var formulas = [];
    if (m) m.walkTokens(m.lexer(markdown), function(token) {
      if (token.type === 'inlineMath' || token.type === 'blockMath') formulas.push({ latex: token.latex, display: token.type === 'blockMath' || !!token.display });
    });
    return formulas;
  }

  function copyText(text) {
    function fallback() {
      var input = document.createElement('textarea');
      input.value = text;
      input.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(input);
      input.select();
      try { if (!document.execCommand('copy')) throw new Error('无法访问剪贴板，请手动复制。'); }
      finally { input.remove(); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(fallback);
    return Promise.resolve().then(fallback);
  }

  function copy(markdown, rich) {
    if (rich && navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      try {
        return navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([markdown], { type: 'text/plain' }),
          'text/html': new Blob([render(markdown)], { type: 'text/html' })
        })]).then(function() { return true; }, function() { return copyText(markdown).then(function() { return false; }); });
      } catch (error) { /* Older browsers can expose ClipboardItem without supporting HTML. */ }
    }
    return copyText(markdown).then(function() { return false; });
  }

  return { extract: extract, getTurndown: getTurndown, getMarked: getMarked, render: render, getFormulas: getFormulas, copy: copy, copyText: copyText };
})();
