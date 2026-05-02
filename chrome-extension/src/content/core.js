// ChatSavor Core — shared utilities for all platform modules
// Exposed as window.ChatSavorCore

window.ChatSavorCore = (function() {
  'use strict';

  var turndownService = null;
  var markedLib = null;

  // ── Turndown (HTML -> Markdown) ──
  function getTurndown() {
    if (turndownService) return turndownService;
    if (typeof TurndownService === 'function') {
      turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });
      turndownService.addRule('fencedCodeBlock', {
        filter: function(node) { return node.nodeName === 'PRE' && node.querySelector('code'); },
        replacement: function(content, node) {
          var code = node.querySelector('code');
          var lang = (code.className.match(/language-(\S+)/) || code.className.match(/lang-(\S+)/) || ['', ''])[1];
          var text = code.textContent || code.innerText || '';
          return '\n\n```' + lang + '\n' + text + '\n```\n\n';
        }
      });
      return turndownService;
    }
    return null;
  }

  // ── Marked (Markdown -> HTML) ──
  function getMarked() {
    if (markedLib) return markedLib;
    if (typeof marked !== 'undefined') { markedLib = marked; return markedLib; }
    if (typeof window.marked !== 'undefined') { markedLib = window.marked; return markedLib; }
    return null;
  }

  // ── Convert container DOM to Markdown ──
  function extractMarkdown(container) {
    var clone = container.cloneNode(true);
    clone.querySelectorAll('.ai-saver-host, .ai-saver-modal-host, button, .ai-saver-btn').forEach(function(n) { n.remove(); });
    clone.querySelectorAll('svg').forEach(function(svg) {
      if (svg.parentElement && svg.parentElement.children.length === 1) svg.parentElement.remove();
    });
    var html = clone.innerHTML;
    if (!html || !html.trim()) return null;
    var td = getTurndown();
    var markdown = td ? td.turndown(clone) : (clone.textContent || '').trim();
    return { html: html, markdown: markdown };
  }

  // ── Create save button (Shadow DOM isolated) ──
  function createSaveButton(onClick) {
    var host = document.createElement('div');
    host.className = 'ai-saver-host';
    host.style.cssText = 'display:flex; justify-content:flex-end; padding:4px 0; margin-top:4px;';

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:block}',
      '.save-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;',
      'background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:6px;',
      'cursor:pointer;font-size:12px;font-weight:500;box-shadow:0 2px 8px rgba(102,126,234,.4);',
      'transition:all .2s;user-select:none;white-space:nowrap}',
      '.save-btn:hover{background:linear-gradient(135deg,#5a6fd6,#6a3f96);box-shadow:0 4px 12px rgba(102,126,234,.6);transform:translateY(-1px)}',
      '.save-btn:active{transform:translateY(0)}',
    ].join('\n');

    var btn = document.createElement('button');
    btn.className = 'save-btn';
    btn.textContent = '📥 Save';
    btn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); onClick(); });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    return host;
  }

  // ── Inject button below a container ──
  function injectButtonAfter(container, onClick) {
    // Check if a button already exists as a sibling after this container
    if (container.nextElementSibling && container.nextElementSibling.classList.contains('ai-saver-host')) return false;
    var btn = createSaveButton(onClick);
    if (container.nextSibling) {
      container.parentElement.insertBefore(btn, container.nextSibling);
    } else {
      container.parentElement.appendChild(btn);
    }
    return true;
  }

  // ══════════════════════════════════════════════════════
  //  Preview Modal (Shadow DOM, in-page)
  // ══════════════════════════════════════════════════════

  function showPreviewModal(markdown) {
    var existing = document.querySelector('.ai-saver-modal-host');
    if (existing) existing.remove();

    var host = document.createElement('div');
    host.className = 'ai-saver-modal-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto;';
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif}',
      '.overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483647}',
      '.modal{background:#fff;border-radius:12px;width:720px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden}',
      '.modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;flex-shrink:0}',
      '.modal-header h2{font-size:15px;font-weight:600;margin:0}',
      '.close-btn{background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}',
      '.close-btn:hover{background:rgba(255,255,255,.35)}',
      '.tabs{display:flex;border-bottom:1px solid #e5e7eb;padding:0 20px;background:#fafafa;flex-shrink:0}',
      '.tab{padding:10px 16px;background:none;border:none;cursor:pointer;font-size:13px;color:#6b7280;border-bottom:2px solid transparent;transition:all .15s}',
      '.tab.active{color:#667eea;border-bottom-color:#667eea}',
      '.tab:hover{color:#667eea}',
      '.modal-body{flex:1;overflow-y:auto;padding:16px 20px;min-height:200px}',
      '.preview{line-height:1.7;font-size:14px;color:#333}',
      '.preview h1{font-size:22px;margin:16px 0 10px;border-bottom:1px solid #eee;padding-bottom:6px}',
      '.preview h2{font-size:18px;margin:14px 0 8px}',
      '.preview h3{font-size:15px;margin:12px 0 6px}',
      '.preview p{margin:8px 0}',
      '.preview ul,.preview ol{margin:8px 0;padding-left:22px}',
      '.preview blockquote{border-left:3px solid #667eea;margin:10px 0;padding:6px 14px;background:#f8f9ff;color:#555}',
      '.preview pre{background:#f6f8fa;padding:14px;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.5;margin:10px 0}',
      '.preview code{font-family:"Fira Code",Consolas,Monaco,monospace;font-size:13px}',
      '.preview table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}',
      '.preview th,.preview td{border:1px solid #ddd;padding:6px 10px;text-align:left}',
      '.preview th{background:#f6f8fa;font-weight:600}',
      '.raw-md{background:#f6f8fa;padding:14px;border-radius:6px;font-family:"Fira Code",Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:#333}',
      '.modal-footer{display:flex;gap:8px;padding:12px 20px;border-top:1px solid #e5e7eb;background:#fafafa;flex-shrink:0;flex-wrap:wrap}',
      '.btn{padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;gap:4px}',
      '.btn-primary{background:#667eea;color:#fff}',
      '.btn-primary:hover{background:#5a6fd6}',
      '.btn-secondary{background:#e5e7eb;color:#374151}',
      '.btn-secondary:hover{background:#d1d5db}',
      '.btn-success{background:#10b981;color:#fff}',
    ].join('\n');
    shadow.appendChild(style);

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    var modal = document.createElement('div');
    modal.className = 'modal';

    // Header
    var header = document.createElement('div');
    header.className = 'modal-header';
    var title = document.createElement('h2');
    title.textContent = 'AI Reply Preview';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Tabs
    var tabs = document.createElement('div');
    tabs.className = 'tabs';
    var tabPreview = document.createElement('button');
    tabPreview.className = 'tab active';
    tabPreview.textContent = 'Preview';
    var tabMarkdown = document.createElement('button');
    tabMarkdown.className = 'tab';
    tabMarkdown.textContent = 'Markdown';
    tabs.appendChild(tabPreview);
    tabs.appendChild(tabMarkdown);

    // Body
    var body = document.createElement('div');
    body.className = 'modal-body';

    var previewDiv = document.createElement('div');
    previewDiv.className = 'preview';
    var m = getMarked();
    previewDiv.innerHTML = m ? m.parse(markdown) : escapeHtml(markdown).replace(/\n/g, '<br>');

    var mdDiv = document.createElement('pre');
    mdDiv.className = 'raw-md';
    mdDiv.textContent = markdown;
    mdDiv.style.display = 'none';

    body.appendChild(previewDiv);
    body.appendChild(mdDiv);

    tabPreview.addEventListener('click', function() {
      tabPreview.classList.add('active'); tabMarkdown.classList.remove('active');
      previewDiv.style.display = ''; mdDiv.style.display = 'none';
    });
    tabMarkdown.addEventListener('click', function() {
      tabMarkdown.classList.add('active'); tabPreview.classList.remove('active');
      previewDiv.style.display = 'none'; mdDiv.style.display = '';
    });

    // Footer
    var footer = document.createElement('div');
    footer.className = 'modal-footer';
    var btnMd = makeBtn('.md', 'btn btn-primary', function() { downloadBlob(markdown, 'ai-response.md', 'text/markdown'); });
    var btnPdf = makeBtn('.pdf', 'btn btn-primary', function() { downloadPdf(markdown); });
    var btnDocx = makeBtn('.docx', 'btn btn-primary', function() { downloadDocx(markdown); });
    var btnCopy = makeBtn('Copy', 'btn btn-secondary', function() {
      navigator.clipboard.writeText(markdown).then(function() {
        btnCopy.textContent = '✅ Copied'; btnCopy.className = 'btn btn-success';
        setTimeout(function() { btnCopy.textContent = 'Copy'; btnCopy.className = 'btn btn-secondary'; }, 1500);
      });
    });
    footer.appendChild(btnMd); footer.appendChild(btnPdf); footer.appendChild(btnDocx); footer.appendChild(btnCopy);

    modal.appendChild(header); modal.appendChild(tabs); modal.appendChild(body); modal.appendChild(footer);
    overlay.appendChild(modal); shadow.appendChild(overlay);

    var closeModal = function() { host.remove(); document.removeEventListener('keydown', escHandler); };
    var escHandler = function(e) { if (e.key === 'Escape') closeModal(); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escHandler);
    document.body.appendChild(host);
  }

  // ── Helpers ──

  function makeBtn(text, className, onClick) {
    var btn = document.createElement('button');
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function downloadBlob(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadPdf(markdown) {
    var m = getMarked();
    var bodyHtml = m ? m.parse(markdown) : '<pre>' + escapeHtml(markdown) + '</pre>';
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AI Response</title><style>' +
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:40px;max-width:800px;margin:0 auto;line-height:1.7;color:#333}' +
      'h1{font-size:24px;margin:20px 0 12px;border-bottom:2px solid #eee;padding-bottom:8px}' +
      'h2{font-size:20px;margin:18px 0 10px}h3{font-size:16px;margin:14px 0 8px}' +
      'p{margin:8px 0}ul,ol{margin:8px 0;padding-left:24px}' +
      'pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.5}' +
      'code{font-family:"Fira Code",Consolas,monospace;font-size:13px}' +
      'blockquote{border-left:3px solid #667eea;margin:12px 0;padding:8px 16px;background:#f8f9ff;color:#555}' +
      'table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left}th{background:#f6f8fa;font-weight:600}' +
      '@media print{body{padding:20px}pre{white-space:pre-wrap;word-break:break-all}}' +
      '</style></head><body>' + bodyHtml +
      '<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>';
    window.open(URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })), '_blank');
  }

  function downloadDocx(markdown) {
    var m = getMarked();
    var bodyHtml = m ? m.parse(markdown) : '<pre>' + escapeHtml(markdown) + '</pre>';
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>AI Response</title><style>' +
      'body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6;color:#333}' +
      'h1{font-size:18pt;margin:12pt 0 6pt}h2{font-size:15pt;margin:10pt 0 5pt}h3{font-size:12pt;margin:8pt 0 4pt}' +
      'p{margin:6pt 0}ul,ol{margin:6pt 0;padding-left:24pt}' +
      'pre{background:#f4f4f4;padding:8pt;font-family:Consolas,monospace;font-size:9pt;border:1px solid #ddd}' +
      'code{font-family:Consolas,monospace;font-size:9pt}' +
      'blockquote{border-left:3pt solid #667eea;margin:8pt 0;padding:4pt 12pt;color:#555}' +
      'table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border:1px solid #ccc;padding:4pt 8pt;text-align:left}th{background:#f0f0f0;font-weight:bold}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
    downloadBlob(html, 'ai-response.doc', 'application/msword');
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    getTurndown: getTurndown,
    getMarked: getMarked,
    extractMarkdown: extractMarkdown,
    createSaveButton: createSaveButton,
    injectButtonAfter: injectButtonAfter,
    showPreviewModal: showPreviewModal,
    downloadBlob: downloadBlob,
    downloadPdf: downloadPdf,
    downloadDocx: downloadDocx,
    escapeHtml: escapeHtml,
  };
})();
