// ChatSavor Core — shared utilities for all platform modules
// Exposed as window.ChatSavorCore

window.ChatSavorCore = (function() {
  'use strict';

  // Keep all platforms on the same source-preserving conversion path.
  function getTurndown() { return window.ChatSavorMarkdown.getTurndown(); }
  function getMarked() { return window.ChatSavorMarkdown.getMarked(); }
  function extractMarkdown(container) { return window.ChatSavorMarkdown.extract(container); }

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
    btn.textContent = '🔄 转换';
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
      '.compatibility,.copy-status{font-size:12px;line-height:1.6;color:#555;padding:8px 20px;margin:0;background:#f8f9ff}',
      '.copy-status:empty{display:none}',
      '.chatsavor-math{max-width:100%}',
      'div.chatsavor-math{margin:12px 0;padding:8px 0;text-align:center;overflow-x:auto;overflow-y:hidden}',
      '.math-error{color:#b45309;white-space:pre-wrap;font-family:Consolas,monospace}',
      '.formula-item{border-bottom:1px solid #e5e7eb;padding:12px 0}',
      '.formula-item pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:10px;margin:8px 0;font-size:13px}',
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
    title.textContent = 'AI 回复预览';
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
    tabPreview.textContent = '预览';
    var tabMarkdown = document.createElement('button');
    tabMarkdown.className = 'tab';
    tabMarkdown.textContent = 'Markdown';
    tabs.appendChild(tabPreview);
    tabs.appendChild(tabMarkdown);
    var formulas = window.ChatSavorMarkdown.getFormulas(markdown);
    var tabFormulas = document.createElement('button');
    tabFormulas.className = 'tab';
    tabFormulas.textContent = '公式 (' + formulas.length + ')';
    if (formulas.length) tabs.appendChild(tabFormulas);

    // Body
    var body = document.createElement('div');
    body.className = 'modal-body';

    var previewDiv = document.createElement('div');
    previewDiv.className = 'preview';
    previewDiv.innerHTML = window.ChatSavorMarkdown.render(markdown);

    var mdDiv = document.createElement('pre');
    mdDiv.className = 'raw-md';
    mdDiv.textContent = markdown;
    mdDiv.style.display = 'none';

    body.appendChild(previewDiv);
    body.appendChild(mdDiv);
    var formulaDiv = document.createElement('div');
    formulaDiv.className = 'formula-list';
    formulaDiv.style.display = 'none';
    var copyStatus = document.createElement('p');
    copyStatus.className = 'copy-status';
    copyStatus.setAttribute('role', 'status');

    function copyWithFeedback(button, action) {
      var label = button.textContent;
      action().then(function(rich) {
        button.textContent = '✅ 已复制';
        copyStatus.textContent = rich === false && button === btnRich ? '当前浏览器未能复制富文本，已改为复制 Markdown。' : '';
        setTimeout(function() { button.textContent = label; }, 1500);
      }).catch(function() {
        copyStatus.textContent = '复制失败，请在 Markdown 或公式页选中内容后手动复制。';
      });
    }

    formulas.forEach(function(formula, index) {
      var item = document.createElement('div');
      item.className = 'formula-item';
      var label = document.createElement('strong');
      label.textContent = (formula.display ? '独立公式 ' : '行内公式 ') + (index + 1);
      var source = document.createElement('pre');
      source.textContent = formula.latex;
      var copyFormula = makeBtn('复制 LaTeX', 'btn btn-secondary', function() {
        copyWithFeedback(copyFormula, function() { return window.ChatSavorMarkdown.copyText(formula.latex); });
      });
      item.appendChild(label); item.appendChild(source); item.appendChild(copyFormula);
      formulaDiv.appendChild(item);
    });
    body.appendChild(formulaDiv);

    function selectTab(activeTab, activeView) {
      [tabPreview, tabMarkdown, tabFormulas].forEach(function(tab) { tab.classList.toggle('active', tab === activeTab); });
      [previewDiv, mdDiv, formulaDiv].forEach(function(view) { view.style.display = view === activeView ? '' : 'none'; });
    }

    tabPreview.addEventListener('click', function() {
      selectTab(tabPreview, previewDiv);
    });
    tabMarkdown.addEventListener('click', function() {
      selectTab(tabMarkdown, mdDiv);
    });
    tabFormulas.addEventListener('click', function() { selectTab(tabFormulas, formulaDiv); });

    var compatibility = document.createElement('p');
    compatibility.className = 'compatibility';
    compatibility.textContent = 'Obsidian：复制 Markdown。Notion：可尝试富文本粘贴或导入 .md；未识别的公式请用 Ctrl/Cmd+Shift+E 或 /math，再粘贴“公式”页的 LaTeX。';
    var errors = previewDiv.querySelectorAll('.math-error').length;
    if (errors) compatibility.textContent += ' 有 ' + errors + ' 个公式无法预览，已保留原始 LaTeX。';
    var unconverted = previewDiv.querySelector('[data-chatsavor-unconverted-math]');
    if (unconverted) compatibility.textContent += ' 部分公式缺少 LaTeX 源码，已保留原始内容，请检查目标应用中的显示。';

    // Footer
    var footer = document.createElement('div');
    footer.className = 'modal-footer';
    var btnMd = makeBtn('.md', 'btn btn-primary', function() { downloadBlob(markdown, 'ai-response.md', 'text/markdown'); });
    var btnPdf = makeBtn('.pdf', 'btn btn-primary', function() { downloadPdf(markdown); });
    var btnDocx = makeBtn('.docx', 'btn btn-primary', function() { downloadDocx(markdown); });
    var btnCopy = makeBtn('复制 Markdown', 'btn btn-secondary', function() {
      copyWithFeedback(btnCopy, function() { return window.ChatSavorMarkdown.copy(markdown, false); });
    });
    var btnRich = makeBtn('复制富文本', 'btn btn-secondary', function() {
      copyWithFeedback(btnRich, function() { return window.ChatSavorMarkdown.copy(markdown, true); });
    });
    footer.appendChild(btnMd); footer.appendChild(btnPdf); footer.appendChild(btnDocx); footer.appendChild(btnCopy); footer.appendChild(btnRich);

    modal.appendChild(header); modal.appendChild(tabs);
    if (formulas.length || unconverted) modal.appendChild(compatibility);
    modal.appendChild(body); modal.appendChild(copyStatus); modal.appendChild(footer);
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
    if (window.ChatSavorPdf && typeof window.ChatSavorPdf.downloadMarkdownPdf === 'function') {
      return window.ChatSavorPdf.downloadMarkdownPdf(markdown, {
        filename: 'ai-response.pdf',
        title: 'AI Response'
      }).catch(function(error) {
        console.error('[ChatSavor] PDF download failed:', error);
      });
    }

    console.warn('[ChatSavor] PDF exporter unavailable');
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
