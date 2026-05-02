;(function() {
  'use strict';

  var currentMarkdown = '';
  var currentHtml = '';
  var currentMeta = {};

  document.addEventListener('DOMContentLoaded', function() {
    loadLatestContent();
    loadHistory();
    setupTabs();
    setupButtons();
    setupMessaging();
  });

  // Load the most recent saved content
  function loadLatestContent() {
    chrome.storage.local.get(['aiSaverHistory'], function(result) {
      var history = result.aiSaverHistory || [];
      if (history.length > 0) {
        var latest = history[0];
        currentMarkdown = latest.markdown;
        currentHtml = latest.html;
        currentMeta = { url: latest.url, title: latest.title, timestamp: latest.timestamp };
        showPreview();
      }
    });
  }

  // Load and display history
  function loadHistory() {
    chrome.storage.local.get(['aiSaverHistory'], function(result) {
      var history = result.aiSaverHistory || [];
      var list = document.getElementById('history-list');
      if (!list) return;

      if (history.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:30px"><p>No saved items yet</p></div>';
        return;
      }

      list.innerHTML = '';
      history.forEach(function(item, index) {
        var div = document.createElement('div');
        div.className = 'history-item';

        var date = new Date(item.timestamp);
        var timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        var previewText = (item.markdown || '').substring(0, 120).replace(/[#*_`\[\]]/g, '');

        div.innerHTML = '<div class="title">' + escapeHtml(item.title || 'Untitled') + '</div>' +
                        '<div class="time">' + timeStr + '</div>' +
                        '<div class="preview-text">' + escapeHtml(previewText) + '</div>';

        div.addEventListener('click', function() {
          currentMarkdown = item.markdown;
          currentHtml = item.html;
          currentMeta = { url: item.url, title: item.title, timestamp: item.timestamp };
          showPreview();
          // Switch to preview tab
          setActiveTab('preview');
        });

        list.appendChild(div);
      });
    });
  }

  function setupTabs() {
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        setActiveTab(this.dataset.tab);
      });
    });
  }

  function setActiveTab(tabName) {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
    document.querySelector('.tab[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
  }

  function setupButtons() {
    document.getElementById('download-md').addEventListener('click', downloadMd);
    document.getElementById('download-pdf').addEventListener('click', downloadPdf);
    document.getElementById('download-docx').addEventListener('click', downloadDocx);
    document.getElementById('copy-markdown').addEventListener('click', copyMarkdown);
    document.getElementById('open-window').addEventListener('click', openInWindow);
    document.getElementById('clear-data').addEventListener('click', clearData);
  }

  function setupMessaging() {
    chrome.runtime.onMessage.addListener(function(message) {
      if (message.type === 'AI_CONTENT_EXTRACTED') {
        currentMarkdown = message.markdown;
        currentHtml = message.html;
        currentMeta = { url: message.url, title: message.title, timestamp: message.timestamp };
        saveToHistory(message);
        showPreview();
      }
    });
  }

  function saveToHistory(item) {
    chrome.storage.local.get(['aiSaverHistory'], function(result) {
      var history = result.aiSaverHistory || [];
      history.unshift({
        markdown: item.markdown,
        html: item.html,
        url: item.url || '',
        title: item.title || '',
        timestamp: item.timestamp || Date.now()
      });
      // Keep last 50 items
      if (history.length > 50) history = history.slice(0, 50);
      chrome.storage.local.set({ aiSaverHistory: history });
      loadHistory();
    });
  }

  function showPreview() {
    var empty = document.getElementById('empty-state');
    var preview = document.getElementById('preview-section');

    if (!currentMarkdown) {
      empty.style.display = 'flex';
      preview.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    preview.style.display = 'block';

    // Meta info
    var meta = document.getElementById('meta-info');
    var metaParts = [];
    if (currentMeta.title) metaParts.push(currentMeta.title);
    if (currentMeta.timestamp) {
      var d = new Date(currentMeta.timestamp);
      metaParts.push(d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
    meta.textContent = metaParts.join(' | ');

    // HTML preview
    var htmlPreview = document.getElementById('html-preview');
    if (typeof marked !== 'undefined') {
      htmlPreview.innerHTML = marked.parse(currentMarkdown);
    } else {
      htmlPreview.innerHTML = '<pre style="white-space:pre-wrap">' + escapeHtml(currentMarkdown) + '</pre>';
    }

    // Markdown preview
    document.getElementById('md-preview').textContent = currentMarkdown;
  }

  // === Download Functions ===

  function downloadMd() {
    if (!currentMarkdown) return;
    var filename = sanitizeFilename(currentMeta.title || 'ai-response') + '.md';
    downloadBlob(currentMarkdown, filename, 'text/markdown');
  }

  function downloadPdf() {
    if (!currentMarkdown) return;

    // Generate a printable HTML and open in new tab for PDF printing
    var htmlContent = buildPrintableHtml(currentMarkdown, currentMeta.title);
    var blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);

    // Open in a new tab and trigger print
    chrome.tabs.create({ url: url, active: true }, function(tab) {
      // Inject print script after page loads
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          setTimeout(function() { window.print(); }, 500);
        }
      });
    });
  }

  function downloadDocx() {
    if (!currentMarkdown) return;

    // Generate Word-compatible HTML (mhtml-like format)
    var htmlContent = buildWordHtml(currentMarkdown, currentMeta.title);
    var filename = sanitizeFilename(currentMeta.title || 'ai-response') + '.doc';

    var blob = new Blob([htmlContent], { type: 'application/msword;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyMarkdown() {
    if (!currentMarkdown) return;
    navigator.clipboard.writeText(currentMarkdown).then(function() {
      var btn = document.getElementById('copy-markdown');
      var orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied';
      btn.classList.add('btn-success');
      setTimeout(function() {
        btn.innerHTML = orig;
        btn.classList.remove('btn-success');
      }, 1500);
    });
  }

  function openInWindow() {
    chrome.windows.create({
      url: chrome.runtime.getURL('src/popup/popup.html'),
      type: 'popup',
      width: 520,
      height: 700
    });
  }

  function clearData() {
    if (confirm('Clear all saved history?')) {
      chrome.storage.local.remove(['aiSaverHistory', 'aiSaverMarkdown', 'aiSaverHtml'], function() {
        currentMarkdown = '';
        currentHtml = '';
        currentMeta = {};
        showPreview();
        loadHistory();
      });
    }
  }

  // === Helper Functions ===

  function downloadBlob(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(name) {
    return (name || 'ai-response')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 60);
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getMarkdownHtml(md) {
    if (typeof marked !== 'undefined') {
      return marked.parse(md);
    }
    return '<pre style="white-space:pre-wrap">' + escapeHtml(md) + '</pre>';
  }

  function buildPrintableHtml(md, title) {
    var bodyHtml = getMarkdownHtml(md);
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
      escapeHtml(title || 'AI Response') +
      '</title><style>' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:40px;max-width:800px;margin:0 auto;line-height:1.7;color:#333}' +
      'h1{font-size:24px;margin:20px 0 12px;border-bottom:2px solid #eee;padding-bottom:8px}' +
      'h2{font-size:20px;margin:18px 0 10px}h3{font-size:16px;margin:14px 0 8px}' +
      'p{margin:8px 0}ul,ol{margin:8px 0;padding-left:24px}' +
      'pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.5}' +
      'code{font-family:"Fira Code",Consolas,Monaco,monospace;font-size:13px}' +
      'blockquote{border-left:3px solid #667eea;margin:12px 0;padding:8px 16px;background:#f8f9ff;color:#555}' +
      'table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}' +
      'th{background:#f6f8fa;font-weight:600}' +
      '@media print{body{padding:20px}pre{white-space:pre-wrap;word-break:break-all}}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
  }

  function buildWordHtml(md, title) {
    var bodyHtml = getMarkdownHtml(md);
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8">' +
      '<title>' + escapeHtml(title || 'AI Response') + '</title>' +
      '<style>' +
      'body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6;color:#333}' +
      'h1{font-size:18pt;margin:12pt 0 6pt}h2{font-size:15pt;margin:10pt 0 5pt}h3{font-size:12pt;margin:8pt 0 4pt}' +
      'p{margin:6pt 0}ul,ol{margin:6pt 0;padding-left:24pt}' +
      'pre{background:#f4f4f4;padding:8pt;font-family:Consolas,monospace;font-size:9pt;border:1px solid #ddd}' +
      'code{font-family:Consolas,monospace;font-size:9pt}' +
      'blockquote{border-left:3pt solid #667eea;margin:8pt 0;padding:4pt 12pt;color:#555}' +
      'table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border:1px solid #ccc;padding:4pt 8pt;text-align:left}' +
      'th{background:#f0f0f0;font-weight:bold}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
  }

})();
