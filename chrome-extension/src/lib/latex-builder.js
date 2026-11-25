// ChatSavor — Overleaf/XeLaTeX source exporter (zero-dependency, offline).
// Exposed as window.ChatSavorLatex.
(function () {
  'use strict';

  var SPECIAL = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%',
    '$': '\\$', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

  // Single-pass escape: never chain replace() or { } from \textbackslash{} get re-escaped.
  function escapeText(text) {
    return String(text == null ? '' : text).replace(/[\\{}&%$#_~^]/g, function(ch) { return SPECIAL[ch]; });
  }

  function inlineTokens(tokens) {
    if (!Array.isArray(tokens)) return escapeText(typeof tokens === 'string' ? tokens : '');
    return tokens.map(function(t) {
      if (t.type === 'text' || t.type === 'escape') return escapeText(t.text || '');
      if (t.type === 'strong') return '\\textbf{' + inlineTokens(t.tokens) + '}';
      if (t.type === 'em') return '\\textit{' + inlineTokens(t.tokens) + '}';
      if (t.type === 'del') return '\\sout{' + inlineTokens(t.tokens) + '}';
      if (t.type === 'codespan') return '\\texttt{' + escapeText(t.text || t.raw || '') + '}';
      if (t.type === 'link') return '\\href{' + (t.href || '') + '}{' + inlineTokens(t.tokens || [{ type: 'text', text: t.text }]) + '}';
      if (t.type === 'image') return '\\url{' + (t.href || '') + '}';
      if (t.type === 'inlineMath' || t.type === 'math') return '$' + (t.latex || t.text || '') + '$';
      if (t.type === 'br') return '\\\\';
      return escapeText(t.text || '');
    }).join('');
  }

  function langMap(lang) {
    var m = { python: 'Python', py: 'Python', js: 'Java', javascript: 'Java', ts: 'Java',
      c: 'C++', cpp: 'C++', bash: 'bash', sh: 'bash' };
    return m[String(lang || '').toLowerCase()] || null;
  }

  function compileToken(tok, options) {
    if (!tok) return '';
    switch (tok.type) {
      case 'heading': {
        var cmd = tok.depth === 1 ? 'section' : tok.depth === 2 ? 'subsection' : tok.depth === 3 ? 'subsubsection' :
          tok.depth === 4 ? 'paragraph' : 'subparagraph';
        return '\\' + cmd + '{' + inlineTokens(tok.tokens || []) + '}\n\n';
      }
      case 'paragraph': return inlineTokens(tok.tokens || []) + '\n\n';
      case 'text': return escapeText(tok.text || '') + '\n\n';
      case 'space': return '';
      case 'hr': return '\\hrulefill\n\n';
      case 'blockquote': {
        var inner = (tok.tokens || []).map(function(t) { return compileToken(t, options); }).join('');
        return '\\begin{quote}\n' + inner + '\n\\end{quote}\n\n';
      }
      case 'code': {
        var code = String(tok.text || '');
        if (/[^\x00-\x7F]/.test(code) || code.indexOf('\\end{lstlisting}') !== -1) {
          return '\\begin{verbatim}\n' + code + '\n\\end{verbatim}\n\n';
        }
        var lang = langMap(tok.lang);
        return '\\begin{lstlisting}' + (lang ? '[' + lang + ']' : '') + '\n' + code + '\n\\end{lstlisting}\n\n';
      }
      case 'blockMath': {
        var latex = String(tok.latex || tok.text || '');
        if (/^\s*\\begin\{(?:equation|align|gather)/.test(latex)) return latex + '\n\n';
        return '\\begin{equation*}\n' + latex + '\n\\end{equation*}\n\n';
      }
      case 'list': {
        var env = tok.ordered ? 'enumerate' : 'itemize';
        var body = (tok.items || []).map(function(item) {
          var cells = (item.tokens || []).map(function(t) { return compileToken(t, options); }).join('').trim();
          var check = /^\[[ xX]\]\s*/.exec(cells);
          var prefix = check ? (check[0].trim().toLowerCase() === '[x]' ? '$\\boxtimes$ ' : '$\\square$ ') : '';
          if (check) cells = cells.slice(check[0].length);
          return '\\item ' + prefix + cells;
        }).join('\n');
        return '\\begin{' + env + '}\n' + body + '\n\\end{' + env + '}\n\n';
      }
      case 'table': {
        var header = tok.header || [];
        var rows = tok.rows || [];
        var cols = Math.max(1, header.length);
        var colSpec = new Array(cols).fill(0)
          .map(function() { return 'p{\\dimexpr \\linewidth/' + cols + ' - 2\\tabcolsep \\relax}'; }).join('');
        function cellText(cell) {
          if (cell && Array.isArray(cell.tokens)) return inlineTokens(cell.tokens);
          return escapeText(cell && cell.text || cell || '');
        }
        var out = '\\begin{longtable}{' + colSpec + '}\n\\toprule\n' +
          header.map(function(h, i) { return (i ? ' & ' : '') + '\\textbf{' + cellText(h) + '}'; }).join('') + ' \\\\\n\\midrule\n\\endhead\n';
        rows.forEach(function(row) {
          out += row.map(function(c, i) { return (i ? ' & ' : '') + cellText(c); }).join('') + ' \\\\\n';
        });
        out += '\\bottomrule\n\\end{longtable}\n\n';
        return out;
      }
      case 'html': return '';
      default: return '';
    }
  }

  function build(markdown, pageMeta) {
    var meta = pageMeta || {};
    var title = escapeText(meta.title || 'AI Response');
    var date = escapeText(meta.datetime || meta.date || '');
    var body;
    var md = window.ChatSavorMarkdown;
    var lexer = md && typeof md.getMarked === 'function' ? md.getMarked() : null;
    if (lexer && typeof lexer.lexer === 'function') {
      try { body = lexer.lexer(String(markdown || '')).map(function(t) { return compileToken(t, {}); }).join(''); }
      catch (ignored) { body = String(markdown || '').split(/\n\n+/).map(function(p) { return escapeText(p) + '\n\n'; }).join(''); }
    } else {
      body = String(markdown || '').split(/\n\n+/).map(function(p) { return escapeText(p) + '\n\n'; }).join('');
    }
    return [
      '% !TEX program = xelatex\n',
      '\\documentclass[11pt,a4paper]{ctexart}\n',
      '\\usepackage{amsmath,amssymb,amsfonts,mathtools}\n',
      '\\usepackage{booktabs,longtable,array}\n',
      '\\usepackage{graphicx}\n',
      '\\usepackage{listings,xcolor}\n',
      '\\usepackage{hyperref}\n',
      '\\usepackage{geometry}\n',
      '\\geometry{a4paper,margin=2.5cm}\n',
      '\\lstset{extendedchars=false,basicstyle=\\ttfamily\\small,breaklines=true,columns=flexible}\n',
      '\\title{' + title + '}\n',
      '\\date{' + date + '}\n',
      '\\begin{document}\n\\maketitle\n\n',
      body,
      '\\end{document}\n',
    ].join('');
  }

  window.ChatSavorLatex = { build: build, escapeText: escapeText };
})();
