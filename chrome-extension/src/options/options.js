// ChatSavor — Options page: preferences, local history and custom site rules.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var status = $('status');
  function message(text) { status.textContent = text || ''; }
  function api() { return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null; }

  function load(key, fallback, callback) {
    var store = api();
    if (!store) { callback(fallback); return; }
    store.get(key, function(result) {
      try { callback(result && result[key] !== undefined ? JSON.parse(result[key]) : fallback); }
      catch (ignored) { callback(fallback); }
    });
  }
  function save(key, value, callback) {
    var store = api();
    var payload = {};
    payload[key] = JSON.stringify(value);
    if (!store) { if (callback) callback(); return; }
    store.set(payload, function() { if (callback) callback(); });
  }

  var prefs = {};
  function loadPrefs() {
    load('prefs', {}, function(value) {
      prefs = value || {};
      $('frontmatter').checked = !!prefs.frontmatter;
      $('cotMode').value = prefs.cotMode || 'omit';
      $('vault').value = prefs.vault || '';
      $('vaultDir').value = prefs.vaultDir || '';
      $('theme').value = prefs.theme || 'auto';
      $('historyEnabled').checked = prefs.historyEnabled !== false;
      $('pdfFooterMode').value = prefs.pdfFooterMode || 'none';
      $('pdfFooterText').value = prefs.pdfFooterText || '';
      $('pdfWatermarkMode').value = prefs.pdfWatermarkMode || 'none';
      $('pdfWatermarkText').value = prefs.pdfWatermarkText || 'ChatSavor';
      load('customRules', [], function(rules) { $('customRules').value = JSON.stringify(rules || [], null, 2); });
    });
  }

  $('save').addEventListener('click', function() {
    prefs = {
      frontmatter: $('frontmatter').checked,
      cotMode: $('cotMode').value,
      vault: $('vault').value.trim(),
      vaultDir: $('vaultDir').value.trim(),
      theme: $('theme').value,
      historyEnabled: $('historyEnabled').checked,
      pdfFooterMode: $('pdfFooterMode').value,
      pdfFooterText: $('pdfFooterText').value.trim(),
      pdfWatermarkMode: $('pdfWatermarkMode').value,
      pdfWatermarkText: $('pdfWatermarkText').value.trim() || 'ChatSavor',
      pdfWatermarkOpacity: prefs.pdfWatermarkOpacity === undefined ? 0.07 : prefs.pdfWatermarkOpacity,
      pdfAutoPrint: prefs.pdfAutoPrint === undefined ? true : prefs.pdfAutoPrint,
    };
    // chrome.storage.local is the single cross-context source of truth.
    // The localStorage mirror below is only for backward compatibility.
    try {
      localStorage.setItem('chatsavor_frontmatter', prefs.frontmatter ? '1' : '0');
      localStorage.setItem('chatsavor_cot_mode', prefs.cotMode);
      localStorage.setItem('chatsavor_theme', prefs.theme);
      localStorage.setItem('chatsavor_obsidian_vault', prefs.vault);
    } catch (ignored) {}
    save('prefs', prefs, function() { message('偏好已保存。'); });
  });

  function renderHistory(query) {
    load('history', [], function(list) {
      var container = $('historyList');
      container.innerHTML = '';
      var q = (query || '').toLowerCase();
      (list || []).filter(function(item) {
        return !q || [item.title, item.platform, item.markdown].join(' ').toLowerCase().indexOf(q) !== -1;
      }).forEach(function(item) {
        var box = document.createElement('div');
        box.className = 'history-item';
        var head = document.createElement('div');
        head.textContent = (item.time || '') + ' · ' + (item.platform || '') + ' · ' + (item.title || '');
        var pre = document.createElement('pre');
        pre.textContent = item.markdown || '';
        var actions = document.createElement('div');
        var copy = document.createElement('button');
        copy.className = 'secondary'; copy.textContent = '复制';
        copy.addEventListener('click', function() {
          if (navigator.clipboard) navigator.clipboard.writeText(item.markdown || '');
        });
        var preview = document.createElement('button');
        preview.className = 'secondary'; preview.textContent = '二次预览';
        preview.addEventListener('click', function() {
          var w = window.open('', '_blank');
          if (w) { w.document.write('<pre>' + String(item.markdown || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>'); w.document.close(); }
        });
        var del = document.createElement('button');
        del.className = 'secondary'; del.textContent = '删除';
        del.addEventListener('click', function() {
          save('history', (list || []).filter(function(x) { return x !== item; }), function() { renderHistory(query); });
        });
        actions.appendChild(copy); actions.appendChild(preview); actions.appendChild(del);
        box.appendChild(head); box.appendChild(pre); box.appendChild(actions);
        container.appendChild(box);
      });
    });
  }

  $('historySearch').addEventListener('input', function() { renderHistory($('historySearch').value); });
  $('clearHistory').addEventListener('click', function() { save('history', [], function() { renderHistory(''); message('历史记录已清空。'); }); });

  $('saveRules').addEventListener('click', function() {
    try {
      var rules = JSON.parse($('customRules').value);
      if (!Array.isArray(rules)) throw new Error('规则必须是 JSON 数组');
      save('customRules', rules, function() { message('自定义规则已保存。'); });
    } catch (error) { message('JSON 解析失败：' + error.message); }
  });
  $('exportRules').addEventListener('click', function() {
    var blob = new Blob([$('customRules').value], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'chatsavor-custom-rules.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  });
  $('importRules').addEventListener('click', function() { $('importFile').click(); });
  $('importFile').addEventListener('change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() { $('customRules').value = reader.result; message('已导入，点击“保存规则”生效。'); };
    reader.readAsText(file);
  });

  loadPrefs();
  renderHistory('');
  window.ChatSavorOptions = { load: load, save: save, renderHistory: renderHistory };
})();
