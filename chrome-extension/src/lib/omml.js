// ChatSavor — MathML → Word OMML converter (zero-dependency, offline).
// Exposed as window.ChatSavorOmml. Uses window.katex for LaTeX → MathML.
(function () {
  'use strict';

  var NARY_CHARS = /^[∑∏∫∬∭∮⋃⋂⋀⋁]$/;
  var ACC_MAP = {
    '^': '̂', 'ˆ': '̂', 'ˆ': '̂', 'â': '̂', '~': '̃', '˜': '̃',
    '→': '⃗', '⇀': '⃗', '˙': '̇', '¨': '̈', '¯': '¯', '‾': '‾', '_': '¯'
  };
  var BAR_CHARS = /^(?:¯|‾|_|¯|‾)$/;

  function escXml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isNary(node) {
    if (!node) return false;
    if (node.nodeName && node.nodeName.toLowerCase() === 'mo') return NARY_CHARS.test((node.textContent || '').trim());
    var base = firstElement(node);
    return !!(base && base.nodeName && base.nodeName.toLowerCase() === 'mo' && NARY_CHARS.test((base.textContent || '').trim()));
  }

  // Extract {chr, sub, sup, limLoc} from a large-operator node (mo / munder / mover / munderover).
  function naryFromOperator(node) {
    if (!node) return null;
    var tag = node.nodeName.toLowerCase();
    if (tag === 'mo') return { chr: (node.textContent || '').trim(), sub: '', sup: '', limLoc: 'subSup' };
    var parts = children(node);
    var base = parts[0];
    var chr = (firstElement(base) || base).textContent.trim();
    var sub = '', sup = '', limLoc = 'subSup';
    if (tag === 'munder') { sub = parts[1] ? conv(parts[1]) : ''; limLoc = 'undOvr'; }
    else if (tag === 'mover') { sup = parts[1] ? conv(parts[1]) : ''; limLoc = 'undOvr'; }
    else if (tag === 'munderover') { sub = parts[1] ? conv(parts[1]) : ''; sup = parts[2] ? conv(parts[2]) : ''; limLoc = 'undOvr'; }
    else if (tag === 'msub') { sub = parts[1] ? conv(parts[1]) : ''; }
    else if (tag === 'msup') { sup = parts[1] ? conv(parts[1]) : ''; }
    else if (tag === 'msubsup') { sub = parts[1] ? conv(parts[1]) : ''; sup = parts[2] ? conv(parts[2]) : ''; }
    return { chr: chr, sub: sub, sup: sup, limLoc: limLoc };
  }

  function firstElement(node) {
    if (!node) return null;
    return Array.from(node.childNodes || []).find(function(n) { return n.nodeType === 1; }) || null;
  }

  function textOf(node) {
    return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function run(text, plain) {
    if (!text) return '';
    var rpr = plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '';
    return '<m:r>' + rpr + '<m:t>' + escXml(text) + '</m:t></m:r>';
  }

  function children(node) {
    return Array.from((node && node.childNodes) || []).filter(function(n) { return n.nodeType === 1; });
  }

  function convChildren(node) {
    return children(node).map(conv).join('');
  }

  function conv(node) {
    if (!node || node.nodeType !== 1) return '';
    var tag = node.nodeName.toLowerCase();

    if (tag === 'mi' || tag === 'mn' || tag === 'mo' || tag === 'mtext' || tag === 'ms') {
      var txt = node.textContent || '';
      if (!txt) return '';
      var plain = tag === 'mn' || tag === 'mo' || tag === 'mtext' ||
        node.getAttribute('mathvariant') === 'normal' || txt.length > 1;
      return run(txt, plain);
    }
    if (tag === 'mspace') return run(' ', true);

    if (tag === 'mrow' || tag === 'mstyle' || tag === 'mpadded' || tag === 'mphantom' || tag === 'semantics') {
      var kids = children(node);
      if (tag === 'semantics') {
        // Only convert the first presentation child; skip <annotation> source.
        var presentation = kids.find(function(k) { return k.nodeName.toLowerCase() !== 'annotation'; });
        return presentation ? conv(presentation) : '';
      }
      var delim = dilDelimiters(kids);
      if (delim) return delim;
      // Sum/product/integral followed by its operand(s) must absorb them into <m:e>.
      if (kids.length > 1 && isNary(kids[0])) {
        var naryParts = naryFromOperator(kids[0]);
        if (naryParts) {
          var operandHtml = kids.slice(1).map(conv).join('');
          return '<m:nary><m:naryPr><m:chr m:val="' + escXml(naryParts.chr) + '"/><m:limLoc m:val="' + naryParts.limLoc + '"/>' +
            (naryParts.sub ? '' : '<m:subHide m:val="1"/>') + (naryParts.sup ? '' : '<m:supHide m:val="1"/>') +
            '</m:naryPr><m:sub>' + naryParts.sub + '</m:sub><m:sup>' + naryParts.sup + '</m:sup><m:e>' + operandHtml + '</m:e></m:nary>';
        }
      }
      return kids.map(conv).join('');
    }

    if (tag === 'mfrac') {
      var fk = children(node);
      return '<m:f><m:num>' + (fk[0] ? conv(fk[0]) : '') + '</m:num><m:den>' + (fk[1] ? conv(fk[1]) : '') + '</m:den></m:f>';
    }

    if (tag === 'msqrt') {
      return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + convChildren(node) + '</m:e></m:rad>';
    }
    if (tag === 'mroot') {
      var rk = children(node);
      return '<m:rad><m:deg>' + (rk[1] ? conv(rk[1]) : '') + '</m:deg><m:e>' + (rk[0] ? conv(rk[0]) : '') + '</m:e></m:rad>';
    }

    // Large operators with limits → <m:nary>.
    if (tag === 'msub' || tag === 'msup' || tag === 'msubsup' || tag === 'munder' || tag === 'mover' || tag === 'munderover') {
      var parts = children(node);
      var base = parts[0];
      if (isNary(base)) {
        var chr = (firstElement(base) || base).textContent.trim();
        var sub = '', sup = '';
        if (tag === 'msub' || tag === 'munder') sub = parts[1] ? conv(parts[1]) : '';
        else if (tag === 'msup' || tag === 'mover') sup = parts[1] ? conv(parts[1]) : '';
        else { sub = parts[1] ? conv(parts[1]) : ''; sup = parts[2] ? conv(parts[2]) : ''; }
        var limLoc = (tag === 'munder' || tag === 'mover' || tag === 'munderover') ? 'undOvr' : 'subSup';
        var hide = (sub ? '' : '<m:subHide m:val="1"/>') + (sup ? '' : '<m:supHide m:val="1"/>');
        return '<m:nary><m:naryPr><m:chr m:val="' + escXml(chr) + '"/><m:limLoc m:val="' + limLoc + '"/>' + hide +
          '</m:naryPr><m:sub>' + sub + '</m:sub><m:sup>' + sup + '</m:sup><m:e>' + run('', true) + '</m:e></m:nary>';
      }
      if (tag === 'msup' && parts[1]) return '<m:sSup><m:e>' + conv(base) + '</m:e><m:sup>' + conv(parts[1]) + '</m:sup></m:sSup>';
      if (tag === 'msub' && parts[1]) return '<m:sSub><m:e>' + conv(base) + '</m:e><m:sub>' + conv(parts[1]) + '</m:sub></m:sSub>';
      if ((tag === 'msubsup' || tag === 'munderover') && parts[1] && parts[2]) {
        return '<m:sSubSup><m:e>' + conv(base) + '</m:e><m:sub>' + conv(parts[1]) + '</m:sub><m:sup>' + conv(parts[2]) + '</m:sup></m:sSubSup>';
      }
      if (tag === 'mover' && parts[1]) {
        var over = textOf(parts[1]);
        if (Object.prototype.hasOwnProperty.call(ACC_MAP, over)) {
          return '<m:acc><m:accPr><m:chr m:val="' + escXml(ACC_MAP[over]) + '"/></m:accPr><m:e>' + conv(base) + '</m:e></m:acc>';
        }
        if (BAR_CHARS.test(over)) {
          return '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>' + conv(base) + '</m:e></m:bar>';
        }
        return '<m:limUpp><m:e>' + conv(base) + '</m:e><m:lim>' + conv(parts[1]) + '</m:lim></m:limUpp>';
      }
      if (tag === 'munder' && parts[1]) {
        var under = textOf(parts[1]);
        if (BAR_CHARS.test(under)) return '<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>' + conv(base) + '</m:e></m:bar>';
        return '<m:limLow><m:e>' + conv(base) + '</m:e><m:lim>' + conv(parts[1]) + '</m:lim></m:limLow>';
      }
      return conv(base);
    }

    if (tag === 'menclose') {
      return '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>' + convChildren(node) + '</m:e></m:bar>';
    }

    if (tag === 'mtable') {
      var rows = children(node).filter(function(r) { return r.nodeName.toLowerCase() === 'mtr'; });
      return '<m:m>' + rows.map(function(row) {
        var cells = children(row).filter(function(c) { return c.nodeName.toLowerCase() === 'mtd'; });
        return '<m:mr>' + cells.map(function(cell) { return '<m:e>' + convChildren(cell) + '</m:e>'; }).join('') + '</m:mr>';
      }).join('') + '</m:m>';
    }
    if (tag === 'mtr' || tag === 'mtd') return convChildren(node);

    if (tag === 'mfenced') {
      var open = node.getAttribute('open') || '(';
      var close = node.getAttribute('close') || ')';
      return '<m:d><m:dPr><m:begChr m:val="' + escXml(open) + '"/><m:endChr m:val="' + escXml(close) + '"/></m:dPr><m:e>' +
        children(node).map(function(c, i) { return (i ? run(',', true) : '') + conv(c); }).join('') + '</m:e></m:d>';
    }

    // Standalone large operator (∑ without limits).
    if (tag === 'mo' && NARY_CHARS.test((node.textContent || '').trim())) {
      var ch = node.textContent.trim();
      return '<m:nary><m:naryPr><m:chr m:val="' + escXml(ch) + '"/></m:naryPr><m:sub></m:sub><m:sup></m:sup><m:e>' + run('', true) + '</m:e></m:nary>';
    }

    return convChildren(node);
  }

  // Wrap a mrow whose first/last children are matching brackets into <m:d>.
  function dilDelimiters(kids) {
    if (kids.length < 3) return null;
    var pairs = { '(': ')', '[': ']', '{': '}', '‖': '‖', '|': '|' };
    var first = kids[0], last = kids[kids.length - 1];
    if (!first || !last || first.nodeName.toLowerCase() !== 'mo' || last.nodeName.toLowerCase() !== 'mo') return null;
    var open = (first.textContent || '').trim();
    var close = (last.textContent || '').trim();
    if (!pairs[open] || pairs[open] !== close) return null;
    var inner = kids.slice(1, -1).map(conv).join('');
    return '<m:d><m:dPr><m:begChr m:val="' + escXml(open) + '"/><m:endChr m:val="' + escXml(close) + '"/></m:dPr><m:e>' + inner + '</m:e></m:d>';
  }

  function mathmlToOmml(mathmlString, displayMode) {
    if (!mathmlString) return null;
    try {
      var doc = new DOMParser().parseFromString(String(mathmlString), 'text/html');
      var math = Array.from(doc.querySelectorAll('math'))[0] || null;
      if (!math) return null;
      var body = conv(math);
      if (!body) return null;
      // Return the bare content; latexToOmml wraps it in <m:oMath> / <m:oMathPara>.
      return body;
    } catch (ignored) { return null; }
  }

  function latexToOmml(latex, displayMode) {
    if (!window.katex || typeof window.katex.renderToString !== 'function') return null;
    try {
      var mathml = window.katex.renderToString(latex, {
        displayMode: !!displayMode, output: 'mathml', throwOnError: true, trust: false, strict: 'ignore',
      });
      var body = mathmlToOmml(mathml, displayMode);
      if (!body) return null;
      // <m:oMath> is always the direct child of <m:oMathPara> for block math.
      if (displayMode) return '<m:oMathPara><m:oMath>' + body + '</m:oMath></m:oMathPara>';
      return '<m:oMath>' + body + '</m:oMath>';
    } catch (ignored) { return null; }
  }

  window.ChatSavorOmml = { mathmlToOmml: mathmlToOmml, latexToOmml: latexToOmml, escXml: escXml };
})();
