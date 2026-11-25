// ChatSavor — high-resolution social share card renderer (offline, zero-build).
// Exposed as window.ChatSavorCardImage.
(function () {
  'use strict';

  var DEFAULT_CARD_WIDTH = 760;
  var DEFAULT_OUTER_PADDING = 32;
  var DEFAULT_OUTER_WIDTH = DEFAULT_CARD_WIDTH + DEFAULT_OUTER_PADDING * 2; // 824
  var DEFAULT_MAX_SLICE_HEIGHT = 3600;
  var MAX_CANVAS_SIDE = 16000;

  var THEMES = {
    light: { name: '极简白', canvas: '#f1f5f9', bg: '#ffffff', text: '#1e293b', muted: '#64748b',
      code: '#f8fafc', border: '#e2e8f0', accent: '#667eea', font: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif', titleFont: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif' },
    dark: { name: '深邃夜', canvas: '#020617', bg: '#0f172a', text: '#e2e8f0', muted: '#94a3b8',
      code: '#1e293b', border: '#334155', accent: '#818cf8', font: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif', titleFont: '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif' },
    paper: { name: '学术暖纸', canvas: '#efeae1', bg: '#fbf8f1', text: '#292524', muted: '#78716c',
      code: '#f3eee3', border: '#e5dec9', accent: '#9a3412', font: 'Georgia,"Source Han Serif SC","Songti SC",serif', titleFont: 'Georgia,"Source Han Serif SC","Songti SC",serif' },
  };

  var XML_NS = 'http://www.w3.org/1999/xhtml';
  var MATH_NS = 'http://www.w3.org/1998/Math/MathML';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function illegalXmlChars(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  // Serialize an element (or fragment) into strict XHTML, preserving MathML/SVG
  // namespaces. No duplicate cloning; never emits a redundant xmlns attribute.
  function serializeStrictXhtml(element) {
    if (!element) return '';
    var root;
    if (element.nodeType === 1) {
      var ns = element.namespaceURI === MATH_NS ? MATH_NS : (element.namespaceURI === SVG_NS ? SVG_NS : XML_NS);
      var local = element.localName || String(element.nodeName || 'div').toLowerCase();
      try { root = document.implementation.createDocument(ns, local, null).documentElement; }
      catch (ignored) { root = document.implementation.createDocument(XML_NS, 'div', null).documentElement; }
    } else {
      root = document.implementation.createDocument(XML_NS, 'div', null).documentElement;
    }
    function convert(src, dest) {
      if (src.nodeType === 3) { dest.appendChild(dest.ownerDocument.createTextNode(illegalXmlChars(src.nodeValue))); return; }
      if (src.nodeType !== 1) return;
      var srcNs = src.namespaceURI === MATH_NS ? MATH_NS : (src.namespaceURI === SVG_NS ? SVG_NS : XML_NS);
      var srcLocal = src.localName || String(src.nodeName || '').toLowerCase();
      var child;
      try { child = dest.ownerDocument.createElementNS(srcNs, srcLocal); }
      catch (ignored) { child = dest.ownerDocument.createElementNS(XML_NS, srcLocal); }
      Array.from(src.attributes || []).forEach(function(attr) {
        var an = attr.name;
        if (an.indexOf('on') === 0 || an === 'xmlns') return;
        try { child.setAttributeNS(attr.namespaceURI || null, an, illegalXmlChars(attr.value)); }
        catch (ignored) { child.setAttribute(an, illegalXmlChars(attr.value)); }
      });
      Array.from(src.childNodes || []).forEach(function(n) { convert(n, child); });
      dest.appendChild(child);
    }
    if (element.nodeType === 1) {
      // Copy this element's attributes onto the already-created root, then convert children.
      Array.from(element.attributes || []).forEach(function(attr) {
        var an = attr.name;
        if (an.indexOf('on') === 0 || an === 'xmlns') return;
        try { root.setAttributeNS(attr.namespaceURI || null, an, illegalXmlChars(attr.value)); }
        catch (ignored) { root.setAttribute(an, illegalXmlChars(attr.value)); }
      });
      Array.from(element.childNodes || []).forEach(function(n) { convert(n, root); });
    } else {
      Array.from(element.childNodes || []).forEach(function(n) { convert(n, root); });
    }
    return new XMLSerializer().serializeToString(root);
  }

  function computeSlices(blocks, maxSliceHeight) {
    var list = Array.isArray(blocks) ? blocks : [];
    var limit = maxSliceHeight || DEFAULT_MAX_SLICE_HEIGHT;
    if (!list.length) return [[]];
    var total = list.reduce(function(sum, b) { return sum + (b.height || 0); }, 0);
    if (total <= limit) return [list.slice()];
    var slices = [];
    var current = [];
    var currentHeight = 0;
    list.forEach(function(block) {
      var h = block.height || 0;
      if (h > limit) {
        if (current.length) { slices.push(current); current = []; currentHeight = 0; }
        slices.push([block]);
        return;
      }
      if (current.length && currentHeight + h > limit) {
        slices.push(current);
        current = [block];
        currentHeight = h;
      } else {
        current.push(block);
        currentHeight += h;
      }
    });
    if (current.length) slices.push(current);
    return slices.length ? slices : [list.slice()];
  }

  function decodeSvgText(uri) {
    try {
      var m = /^data:image\/svg\+xml((?:;[^,]*)?),([\s\S]*)$/i.exec(String(uri || ''));
      if (!m) return null;
      if (/;base64/i.test(m[1])) {
        var bin = atob(m[2].replace(/\s+/g, ''));
        return decodeURIComponent(escape(bin));
      }
      return decodeURIComponent(m[2]);
    } catch (ignored) { return null; }
  }

  function encodeSvgText(text) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
  }

  function svgViewBox(svgText) {
    var tag = /<svg\b[^>]*>/i.exec(svgText);
    if (!tag) return null;
    var vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (!vb) return null;
    var nums = vb[1].split(/[\s,]+/).map(Number);
    if (nums.length < 4 || !(nums[2] > 0) || !(nums[3] > 0)) return null;
    return { w: Math.round(nums[2]), h: Math.round(nums[3]) };
  }

  // Normalize images: viewBox-only SVG data URIs get explicit width/height,
  // external http(s) images become fallback placeholders (never pollute canvas).
  function prepareHtmlForCard(rawHtml) {
    var holder = document.createElement('div');
    holder.innerHTML = String(rawHtml || '');
    Array.from(holder.querySelectorAll('img')).forEach(function(img) {
      var src = img.getAttribute('src') || '';
      if (/^data:image\/svg\+xml/i.test(src)) {
        img.classList.add('svg-diagram-img');
        var svgText = decodeSvgText(src);
        if (svgText) {
          var vb = svgViewBox(svgText);
          if (vb) {
            var rootTag = /<svg\b[^>]*>/i.exec(svgText)[0];
            var hasNumericW = /\swidth\s*=\s*["']\d+(?:\.\d+)?["']/i.test(rootTag);
            var hasNumericH = /\sheight\s*=\s*["']\d+(?:\.\d+)?["']/i.test(rootTag);
            if (!hasNumericW || !hasNumericH) {
              var fixed = svgText.replace(/<svg\b[^>]*>/i, function(tag) {
                var t = tag.replace(/\swidth\s*=\s*["'][^"']*["']/i, '').replace(/\sheight\s*=\s*["'][^"']*["']/i, '');
                return t.replace(/>/, ' width="' + vb.w + '" height="' + vb.h + '">');
              });
              img.setAttribute('src', encodeSvgText(fixed));
            }
            if (!(/^\d+$/.test(img.getAttribute('width') || ''))) img.setAttribute('width', String(vb.w));
            if (!(/^\d+$/.test(img.getAttribute('height') || ''))) img.setAttribute('height', String(vb.h));
          }
        }
      } else if (!/^data:image\//i.test(src)) {
        var alt = img.getAttribute('alt') || '';
        var span = document.createElement('span');
        span.className = 'img-fallback';
        span.textContent = '[外部图片未能离线内联' + (alt ? '：' + alt : '') + ']';
        img.replaceWith(span);
      }
    });
    return holder.innerHTML;
  }

  function cardCss(theme, cardWidth, outerWidth, outerPadding, themeKey) {
    var s = function(sel, body) { return sel + '{' + body + '}'; };
    return [
      s('.cs-card-stage, .cs-card-stage *', 'box-sizing:border-box'),
      s('.cs-card-stage', 'margin:0;padding:' + outerPadding + 'px;width:' + outerWidth + 'px;background:' + theme.canvas +
        ';font-family:' + theme.font + ';color:' + theme.text + ';-webkit-font-smoothing:antialiased;'),
      s('.card', 'width:' + cardWidth + 'px;margin:0;background:' + theme.bg + ';border:1px solid ' + theme.border +
        ';border-radius:18px;padding:36px 40px;color:' + theme.text + ';font-family:' + theme.font +
        ';box-shadow:0 12px 32px rgba(15,23,42,.10);overflow:hidden;overflow-wrap:anywhere;word-break:break-word;'),
      s('.brand', 'display:flex;justify-content:space-between;align-items:center;font-size:12px;letter-spacing:1.5px;color:' +
        theme.accent + ';font-weight:700;text-transform:uppercase;margin-bottom:6px;'),
      s('h1', 'font-size:24px;margin:10px 0 20px;font-family:' + theme.titleFont + ';line-height:1.38;color:' + theme.text + ';font-weight:700;'),
      s('h2', 'font-size:19px;margin:20px 0 10px;line-height:1.4;color:' + theme.text + ';'),
      s('h3, h4, h5, h6', 'font-size:16px;margin:16px 0 8px;line-height:1.45;color:' + theme.text + ';'),
      s('p, li', 'font-size:15px;line-height:1.78;margin:10px 0;color:' + theme.text + ';'),
      s('ul, ol', 'margin:10px 0;padding-left:24px;'),
      s('li', 'margin:4px 0;'),
      s('hr', 'border:none;border-top:1px solid ' + theme.border + ';margin:18px 0;'),
      s('a', 'color:' + theme.accent + ';text-decoration:none;'),
      s('pre', 'background:' + theme.code + ';border:1px solid ' + theme.border + ';padding:14px 16px;border-radius:10px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;margin:12px 0;line-height:1.55;'),
      s('code', 'font-family:Consolas,"SFMono-Regular",Menlo,monospace;font-size:13.5px;background:' + theme.code + ';padding:2px 5px;border-radius:4px;'),
      s('pre code', 'background:transparent;padding:0;border-radius:0;'),
      s('blockquote', 'border-left:4px solid ' + theme.accent + ';background:' + theme.code + ';padding:8px 14px;border-radius:0 8px 8px 0;color:' + theme.muted + ';margin:12px 0;'),
      s('table', 'width:100%;border-collapse:collapse;table-layout:fixed;margin:14px 0;font-size:13.5px;'),
      s('th, td', 'border:1px solid ' + theme.border + ';padding:8px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;'),
      s('th', 'background:' + theme.code + ';font-weight:600;'),
      s('img', 'display:block;max-width:100%;height:auto;margin:12px auto;border-radius:8px;'),
      themeKey === 'dark' ? s('.svg-diagram-img', 'background:#f8fafc;padding:12px;border-radius:10px;') : '',
      s('.img-fallback', 'display:inline-block;font-size:12px;color:' + theme.muted + ';background:' + theme.code +
        ';border:1px dashed ' + theme.border + ';padding:6px 10px;border-radius:6px;margin:6px 0;'),
      s('.chatsavor-math', 'max-width:100%;'),
      s('div.chatsavor-math', 'margin:14px 0;text-align:center;overflow:hidden;'),
      s('.meta', 'margin-top:24px;padding-top:14px;border-top:1px solid ' + theme.border + ';font-size:12px;color:' + theme.muted + ';display:flex;justify-content:space-between;align-items:center;'),
    ].filter(Boolean).join('\n');
  }

  function estimateBlockHeight(el, innerWidth) {
    if (!el) return 0;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    // Image-based block: compute precise aspect-ratio height.
    var imgs = [];
    if (el.tagName === 'IMG') imgs = [el];
    else if (el.querySelectorAll) imgs = Array.from(el.querySelectorAll('img'));
    if (imgs.length) {
      var maxH = 0;
      imgs.forEach(function(img) {
        var w = parseInt(img.getAttribute('width'), 10) || 0;
        var h = parseInt(img.getAttribute('height'), 10) || 0;
        if (w > 0 && h > 0) {
          var scale = Math.min(1, (innerWidth || 600) / w);
          maxH = Math.max(maxH, Math.round(h * scale));
        }
      });
      if (maxH > 0) return maxH + 24;
    }
    var w = innerWidth || 600;
    var charsPerLine = Math.max(20, Math.floor(w / 8.5));
    var lines = text ? Math.max(1, Math.ceil(text.length / charsPerLine)) : 1;
    return lines * 26 + 16;
  }

  function hasRealLayout() {
    try {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;';
      (document.body || document.documentElement).appendChild(probe);
      var h = probe.getBoundingClientRect().height;
      probe.remove();
      return h > 0;
    } catch (ignored) { return false; }
  }

  function buildCardSlicesDom(sanitizedBodyHtml, pageMeta, options) {
    options = options || {};
    var themeKey = options.theme || 'light';
    var theme = THEMES[themeKey] || THEMES.light;
    var cardWidth = options.width || DEFAULT_CARD_WIDTH;
    var outerPadding = options.outerPadding || DEFAULT_OUTER_PADDING;
    var outerWidth = cardWidth + outerPadding * 2;
    var maxSliceHeight = options.maxSliceHeight || DEFAULT_MAX_SLICE_HEIGHT;
    var meta = pageMeta || {};
    var watermark = options.watermarkText || 'ChatSavor';
    var realLayout = hasRealLayout();

    // 1) Normalize images (viewBox SVG + neutralize external).
    var prepared = prepareHtmlForCard(String(sanitizedBodyHtml || ''));

    // 2) Offscreen measure host, Shadow DOM isolated.
    var measureHost = document.createElement('div');
    measureHost.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + outerWidth + 'px;visibility:hidden;pointer-events:none;z-index:-1;';
    (document.body || document.documentElement).appendChild(measureHost);
    var measureRoot = measureHost.attachShadow ? measureHost.attachShadow({ mode: 'open' }) : measureHost;

    var styleEl = document.createElement('style');
    styleEl.textContent = cardCss(theme, cardWidth, outerWidth, outerPadding, themeKey);
    measureRoot.appendChild(styleEl);

    // 3) Clean block children: drop whitespace-only text nodes, wrap stray text in <p>.
    var tmp = document.createElement('div');
    tmp.innerHTML = prepared;
    var blocks = [];
    Array.from(tmp.childNodes).forEach(function(node) {
      if (node.nodeType === 1) blocks.push(node.cloneNode(true));
      else if (node.nodeType === 3) {
        if (node.nodeValue.trim()) {
          var p = document.createElement('p');
          p.textContent = node.nodeValue;
          blocks.push(p);
        }
      }
    });

    // 4) First-stage measurement: per-block height inside a real .card-body width.
    var stage = document.createElement('div');
    stage.className = 'cs-card-stage';
    var card = document.createElement('div');
    card.className = 'card';
    var body = document.createElement('div');
    body.className = 'card-body';
    blocks.forEach(function(b) { body.appendChild(b.cloneNode(true)); });
    card.appendChild(body);
    stage.appendChild(card);
    measureRoot.appendChild(stage);

    var innerWidth = cardWidth - 82; // card padding 40px each side + border.
    var measured = blocks.map(function(b, index) {
      var el = body.childNodes[index];
      var h = 0;
      if (el && realLayout) {
        var rect = el.getBoundingClientRect();
        var cs = el.ownerDocument.defaultView.getComputedStyle(el);
        var mt = parseFloat(cs.marginTop) || 0;
        var mb = parseFloat(cs.marginBottom) || 0;
        if (rect.height > 0) h = Math.ceil(rect.height + mt + mb);
      }
      if (h <= 0) h = estimateBlockHeight(el, innerWidth);
      return { index: index, node: b, height: h, top: 0, bottom: h };
    });
    measureRoot.removeChild(stage);

    // 5) compute slices.
    var slices = computeSlices(measured, maxSliceHeight);

    // 6) Second-stage measurement per slice: real stage height.
    var result = slices.map(function(slice, si) {
      var stageEl = document.createElement('div');
      stageEl.className = 'cs-card-stage';
      var styleClone = document.createElement('style');
      styleClone.textContent = cardCss(theme, cardWidth, outerWidth, outerPadding, themeKey);
      stageEl.appendChild(styleClone);
      var cardEl = document.createElement('div');
      cardEl.className = 'card';
      var brand = document.createElement('div');
      brand.className = 'brand';
      var brandText = document.createElement('span');
      brandText.textContent = 'ChatSavor · ' + (meta.platform || 'AI');
      brand.appendChild(brandText);
      if (si > 0) {
        var cont = document.createElement('span');
        cont.textContent = '续 ' + (si + 1) + '/' + slices.length;
        cont.style.cssText = 'font-size:11px;letter-spacing:0;font-weight:400;';
        brand.appendChild(cont);
      }
      cardEl.appendChild(brand);
      if (si === 0) {
        var h1 = document.createElement('h1');
        h1.textContent = meta.title || 'AI Response';
        cardEl.appendChild(h1);
      }
      var bodyEl = document.createElement('div');
      bodyEl.className = 'card-body';
      slice.forEach(function(block) { bodyEl.appendChild(block.node.cloneNode(true)); });
      cardEl.appendChild(bodyEl);
      var metaBar = document.createElement('div');
      metaBar.className = 'meta';
      var left = document.createElement('span');
      left.textContent = (meta.datetime || meta.date || '') + ' · ' + watermark;
      var right = document.createElement('span');
      right.textContent = slices.length > 1 ? (si + 1) + ' / ' + slices.length : '';
      metaBar.appendChild(left); metaBar.appendChild(right);
      cardEl.appendChild(metaBar);
      stageEl.appendChild(cardEl);

      measureRoot.appendChild(stageEl);
      var stageRect = stageEl.getBoundingClientRect();
      var outerHeight;
      if (realLayout && stageRect && stageRect.height > 0) {
        outerHeight = Math.max(200, Math.ceil(stageRect.height));
      } else {
        var sliceBodyHeight = slice.reduce(function(sum, b) { return sum + b.height; }, 0);
        outerHeight = Math.max(240, sliceBodyHeight + (si === 0 ? 190 : 130) + outerPadding * 2);
      }
      measureRoot.removeChild(stageEl);

      var requestedScale = options.scale || 2;
      var scale = Math.max(1, requestedScale);
      if (outerHeight * scale > MAX_CANVAS_SIDE) scale = Math.max(1, MAX_CANVAS_SIDE / outerHeight);
      var pixelWidth = Math.max(1, Math.round(outerWidth * scale));
      var pixelHeight = Math.max(1, Math.round(outerHeight * scale));

      var xhtml = serializeStrictXhtml(stageEl);
      var svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="' + SVG_NS + '" width="' + pixelWidth + '" height="' + pixelHeight +
        '" viewBox="0 0 ' + outerWidth + ' ' + outerHeight + '">' +
        '<foreignObject x="0" y="0" width="' + outerWidth + '" height="' + outerHeight + '">' +
        xhtml + '</foreignObject></svg>');

      return {
        width: outerWidth, cardWidth: cardWidth, outerWidth: outerWidth,
        height: outerHeight, outerHeight: outerHeight,
        pixelWidth: pixelWidth, pixelHeight: pixelHeight, scale: scale,
        canvasColor: theme.canvas, xhtml: xhtml, svgDataUrl: svgDataUrl,
        sliceIndex: si, sliceCount: slices.length,
      };
    });

    measureHost.remove();
    return result;
  }

  function renderToBlobs(markdown, pageMeta, options) {
    options = options || {};
    var md = window.ChatSavorMarkdown;
    var html = md && typeof md.render === 'function' ? md.render(String(markdown || '')) : '<pre>' + String(markdown || '') + '</pre>';
    var assets = window.ChatSavorAssets;
    var ready = (assets && typeof assets.inlineAllImagesForHtml === 'function') ? assets.inlineAllImagesForHtml(html) : Promise.resolve(html);
    return ready.then(function(inlinedHtml) {
      var prepared = prepareHtmlForCard(inlinedHtml);
      var slices = buildCardSlicesDom(prepared, pageMeta, options);
      if (typeof Image === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') {
        return { blobs: slices.map(function() { return new Blob([], { type: 'image/png' }); }),
          sliced: slices.length > 1, count: slices.length, slices: slices };
      }
      return Promise.all(slices.map(function(slice) {
        return new Promise(function(resolve, reject) {
          var img = new Image();
          img.onload = function() {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = slice.pixelWidth;
              canvas.height = slice.pixelHeight;
              var ctx = canvas.getContext('2d');
              ctx.fillStyle = slice.canvasColor || THEMES.light.canvas;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              canvas.toBlob(function(blob) {
                if (blob && blob.size > 0) resolve(blob);
                else reject(new Error('empty render'));
              }, 'image/png');
            } catch (error) { reject(error); }
          };
          img.onerror = function() { reject(new Error('image decode failed')); };
          img.src = slice.svgDataUrl;
        });
      })).then(function(blobs) { return { blobs: blobs, sliced: blobs.length > 1, count: blobs.length, slices: slices }; });
    });
  }

  window.ChatSavorCardImage = {
    THEMES: THEMES, computeSlices: computeSlices, serializeStrictXhtml: serializeStrictXhtml,
    prepareHtmlForCard: prepareHtmlForCard, buildCardSlicesDom: buildCardSlicesDom, renderToBlobs: renderToBlobs,
  };
})();
