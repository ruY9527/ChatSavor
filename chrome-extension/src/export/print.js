// ChatSavor — print / PDF page controller. Reads sanitized HTML from storage.session.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = params.get('id') || '';
  var content = document.getElementById('content');
  var status = document.getElementById('status');
  var watermarkLayer = document.getElementById('watermark-layer');
  var runningHeader = document.getElementById('running-header');
  var runningFooter = document.getElementById('running-footer');
  var footerModeSel = document.getElementById('footerMode');
  var footerTextInput = document.getElementById('footerText');
  var watermarkModeSel = document.getElementById('watermarkMode');
  var watermarkTextInput = document.getElementById('watermarkText');
  var watermarkOpacityInput = document.getElementById('watermarkOpacity');
  var autoPrintCheck = document.getElementById('autoPrint');
  var printBtn = document.getElementById('print');

  // Address-bar hygiene: drop the long random ?id=... token after reading it.
  try { history.replaceState(null, '', location.pathname); } catch (ignored) {}

  var DEFAULTS = {
    pdfFooterMode: 'none', pdfFooterText: '',
    pdfWatermarkMode: 'none', pdfWatermarkText: 'ChatSavor', pdfWatermarkOpacity: 0.07,
    pdfAutoPrint: true,
  };
  var state = {};
  Object.keys(DEFAULTS).forEach(function(k) { state[k] = DEFAULTS[k]; });
  var meta = { title: 'ChatSavor', platform: 'AI', datetime: '' };
  var autoPrintTimer = null;
  var userInteracted = false;

  function localStore() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local &&
      chrome.storage.local.get && chrome.storage.local.set) ? chrome.storage.local : null;
  }

  function persistPrefs() {
    var store = localStore();
    if (!store) return;
    store.get('prefs', function(result) {
      var prefs = {};
      try { prefs = JSON.parse(result && result.prefs || '{}') || {}; } catch (ignored) {}
      Object.keys(DEFAULTS).forEach(function(k) { prefs[k] = state[k]; });
      try { store.set({ prefs: JSON.stringify(prefs) }); } catch (ignored) {}
    });
  }

  function setDynamicMargin(native) {
    var style = document.getElementById('dynamic-page-style');
    if (!style) return;
    style.textContent = native ? '@media print { @page { size: A4; margin: 16mm; } }' : '';
  }

  function renderFooter() {
    if (!runningFooter) return;
    runningHeader.textContent = '';
    runningFooter.textContent = '';
    if (footerTextInput) footerTextInput.style.display = state.pdfFooterMode === 'custom' ? '' : 'none';
    if (state.pdfFooterMode === 'source') {
      runningHeader.textContent = meta.title || 'ChatSavor';
      var parts = [];
      if (meta.platform) parts.push('来源：' + meta.platform);
      if (meta.datetime) parts.push('导出时间：' + meta.datetime);
      runningFooter.textContent = parts.join(' · ');
    } else if (state.pdfFooterMode === 'custom') {
      runningFooter.textContent = state.pdfFooterText || '';
    }
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function(k) { el.setAttribute(k, String(attrs[k])); });
    return el;
  }

  function renderWatermark() {
    if (!watermarkLayer) return;
    watermarkLayer.innerHTML = '';
    var text = String(state.pdfWatermarkText || '').trim();
    if (state.pdfWatermarkMode === 'none' || !text) return;
    var opacity = Number(state.pdfWatermarkOpacity) || DEFAULTS.pdfWatermarkOpacity;
    if (state.pdfWatermarkMode === 'tiled') {
      var svg = svgEl('svg', { xmlns: SVG_NS, width: '100%', height: '100%' });
      var defs = svgEl('defs', {});
      var pattern = svgEl('pattern', {
        id: 'cs-wm-pattern', width: 260, height: 180,
        patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-28)',
      });
      var label = svgEl('text', {
        x: 20, y: 100, fill: '#111827', 'fill-opacity': opacity, 'font-size': 16,
        'font-family': "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif",
        'font-weight': 500,
      });
      label.textContent = text; // safe: text node, never innerHTML
      pattern.appendChild(label);
      defs.appendChild(pattern);
      svg.appendChild(defs);
      svg.appendChild(svgEl('rect', { width: '100%', height: '100%', fill: 'url(#cs-wm-pattern)' }));
      watermarkLayer.appendChild(svg);
    } else if (state.pdfWatermarkMode === 'corner') {
      var holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;right:18mm;bottom:8mm;opacity:' + Math.min(0.45, opacity * 3) +
        ';font-size:11pt;color:#111827;pointer-events:none;white-space:nowrap;';
      holder.textContent = text; // safe text node
      watermarkLayer.appendChild(holder);
    }
  }

  function refreshAll() {
    renderFooter();
    renderWatermark();
  }

  function onUserChange() {
    if (!userInteracted && autoPrintTimer !== null) {
      clearTimeout(autoPrintTimer);
      autoPrintTimer = null;
    }
    userInteracted = true;
    refreshAll();
    persistPrefs();
  }

  function bindControls() {
    if (footerModeSel) footerModeSel.addEventListener('change', function() { state.pdfFooterMode = footerModeSel.value; onUserChange(); });
    if (footerTextInput) footerTextInput.addEventListener('input', function() { state.pdfFooterText = footerTextInput.value; onUserChange(); });
    if (watermarkModeSel) watermarkModeSel.addEventListener('change', function() {
      state.pdfWatermarkMode = watermarkModeSel.value;
      if (watermarkTextInput) watermarkTextInput.disabled = state.pdfWatermarkMode === 'none';
      onUserChange();
    });
    if (watermarkTextInput) watermarkTextInput.addEventListener('input', function() { state.pdfWatermarkText = watermarkTextInput.value; onUserChange(); });
    if (watermarkOpacityInput) watermarkOpacityInput.addEventListener('input', function() { state.pdfWatermarkOpacity = parseFloat(watermarkOpacityInput.value); onUserChange(); });
    if (autoPrintCheck) autoPrintCheck.addEventListener('change', function() {
      state.pdfAutoPrint = autoPrintCheck.checked;
      if (!state.pdfAutoPrint && autoPrintTimer !== null) { clearTimeout(autoPrintTimer); autoPrintTimer = null; }
      onUserChange();
    });
    if (printBtn) printBtn.addEventListener('click', function() { window.print(); });
  }

  function applyStateToControls() {
    if (footerModeSel) footerModeSel.value = state.pdfFooterMode;
    if (footerTextInput) { footerTextInput.value = state.pdfFooterText || ''; footerTextInput.style.display = state.pdfFooterMode === 'custom' ? '' : 'none'; }
    if (watermarkModeSel) watermarkModeSel.value = state.pdfWatermarkMode;
    if (watermarkTextInput) { watermarkTextInput.value = state.pdfWatermarkText; watermarkTextInput.disabled = state.pdfWatermarkMode === 'none'; }
    if (watermarkOpacityInput) watermarkOpacityInput.value = state.pdfWatermarkOpacity;
    if (autoPrintCheck) autoPrintCheck.checked = state.pdfAutoPrint !== false;
  }

  function scheduleAutoPrint() {
    if (state.pdfAutoPrint === false) return;
    autoPrintTimer = setTimeout(function() { autoPrintTimer = null; window.print(); }, 600);
  }

  // Wait for all in-document images to finish loading/decoding before printing.
  // When nothing is pending the callback is invoked SYNCHRONOUSLY, preserving the
  // original 600ms auto-print timer contract (see pdf-watermark.test.cjs).
  function waitForImagesReady(container, maxWaitMs, callback) {
    var pending = Array.from(container.querySelectorAll('img')).filter(function(img) { return !img.complete; });
    if (pending.length === 0) { callback(); return; }
    var total = pending.length;
    var done = 0;
    var finished = false;
    status.textContent = '正在加载图片 (0/' + total + ')…';
    var timeout = setTimeout(finish, maxWaitMs || 6000);
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      status.textContent = '已就绪，共 ' + content.textContent.trim().length + ' 字符';
      callback();
    }
    function oneDone() {
      done++;
      if (done >= total) finish();
      else status.textContent = '正在加载图片 (' + done + '/' + total + ')…';
    }
    pending.forEach(function(img) {
      function settled() {
        if (img.decode && typeof img.decode === 'function') img.decode().catch(function() {}).then(oneDone);
        else oneDone();
      }
      img.addEventListener('load', settled, { once: true });
      img.addEventListener('error', settled, { once: true });
    });
  }

  function show(html, title, payload) {
    if (title) document.title = title;
    if (payload) {
      meta.title = payload.title || meta.title;
      meta.platform = payload.platform || meta.platform;
      meta.datetime = payload.datetime || '';
    }
    // The payload HTML is produced by ChatSavorMarkdown.render() (sanitized).
    // Defense in depth: parse into an inert document first, strip executable
    // elements/attributes there, then import only clean nodes.
    var parsed = new DOMParser().parseFromString(html || '<p>没有可打印的内容。</p>', 'text/html');
    parsed.querySelectorAll('script, iframe, object, embed, form').forEach(function(node) { node.remove(); });
    parsed.querySelectorAll('*').forEach(function(node) {
      Array.from(node.attributes).forEach(function(attr) {
        if (/^on/i.test(attr.name) || (/^(href|src)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) node.removeAttribute(attr.name);
      });
    });
    content.innerHTML = '';
    Array.from(parsed.body.childNodes).forEach(function(node) { content.appendChild(document.importNode(node, true)); });
    status.textContent = '已就绪，共 ' + content.textContent.trim().length + ' 字符';
    refreshAll();
    waitForImagesReady(content, 6000, function() {
      if (!userInteracted) scheduleAutoPrint();
    });
  }

  function start(payload) {
    var store = localStore();
    function proceed() {
      applyStateToControls();
      bindControls();
      show(payload.html || '', payload.title || 'ChatSavor', payload);
      setDynamicMargin(false);
    }
    if (!store) { proceed(); return; }
    store.get('prefs', function(result) {
      var prefs = {};
      try { prefs = JSON.parse(result && result.prefs || '{}') || {}; } catch (ignored) {}
      Object.keys(DEFAULTS).forEach(function(k) {
        if (prefs[k] !== undefined && prefs[k] !== null) state[k] = prefs[k];
      });
      proceed();
    });
  }

  if (!id || (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session)) {
    show('<p>无法读取打印内容，请从扩展弹窗重新点击 PDF 导出。</p>', 'ChatSavor 打印', {});
    applyStateToControls();
    bindControls();
  } else {
    var key = {};
    key[id] = null;
    chrome.storage.session.get(key, function(result) {
      var payload = result && result[id] || {};
      start(payload);
      // One-shot payload: free storage.session quota after rendering. The DOM is
      // already in place, so the user can still print repeatedly from this page.
      if (chrome.storage.session.remove) chrome.storage.session.remove(id);
    });
  }
})();
