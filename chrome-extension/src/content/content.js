;(function() {
  'use strict';

  // ── Platform selectors ──
  var PLATFORM_CONFIGS = [
    { name: 'claude',     host: 'claude.ai',           selectors: ['.font-claude-message', '[class*="assistant"]'] },
    { name: 'chatglm',    host: 'chatglm.cn',           selectors: ['.markdown-body', '[class*="answer"]'] },
    { name: 'tongyi',     host: 'tongyi.aliyun.com',    selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'qwen',       host: 'qwen.ai',              selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'kimi',       host: 'kimi.moonshot.cn',      selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'yuanbao',    host: 'yuanbao.tencent.com',   selectors: ['.agent-chat__conv--ai .agent-chat__bubble__content', '[class*="conv--ai"] [class*="bubble__content"]'] },
    { name: 'perplexity', host: 'perplexity.ai',         selectors: ['[class*="answer"]', '[class*="response"]'] },
    { name: 'poe',        host: 'poe.com',               selectors: ['[class*="AssistantMessage"]', '[class*="BotMessage"]'] },
    { name: 'coze',       host: 'coze.cn',               selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'coze',       host: 'coze.com',              selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
  ];

  var GENERIC_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.assistant',
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="response"]',
  ];

  // ── State ──
  var injectedParents = new WeakSet();
  var watchingState = new Map();
  var injectedContentHashes = new Set();

  var STABLE_THRESHOLD = 3;
  var CHECK_INTERVAL = 1000;

  var turndownService = null;
  var markedLib = null;

  // ── Turndown ──
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
      turndownService.addRule('table', {
        filter: 'table',
        replacement: function(content, node) {
          var markdown = tableToMarkdown(node);
          return markdown ? '\n\n' + markdown + '\n\n' : '\n\n' + node.outerHTML + '\n\n';
        }
      });
      return turndownService;
    }
    return null;
  }

  function tableToMarkdown(table) {
    if (!table || !table.querySelectorAll) return '';

    var rows = Array.from(table.querySelectorAll('tr')).map(function(row) {
      return Array.from(row.children).filter(function(cell) {
        return cell.nodeName === 'TH' || cell.nodeName === 'TD';
      });
    }).filter(function(row) {
      return row.length > 0;
    });

    if (rows.length === 0) return '';
    if (table.querySelector('[rowspan], [colspan]')) return '';

    var columnCount = rows.reduce(function(max, row) {
      return Math.max(max, row.reduce(function(total, cell) {
        return total + Math.max(parseInt(cell.getAttribute('colspan') || '1', 10) || 1, 1);
      }, 0));
    }, 0);

    if (columnCount === 0) return '';

    var matrix = rows.map(function(row) {
      var values = [];
      row.forEach(function(cell) {
        var colspan = Math.max(parseInt(cell.getAttribute('colspan') || '1', 10) || 1, 1);
        values.push(normalizeTableCell(cell));
        for (var i = 1; i < colspan; i++) values.push('');
      });
      while (values.length < columnCount) values.push('');
      return values.slice(0, columnCount);
    });

    var firstRowHasTh = rows[0].some(function(cell) { return cell.nodeName === 'TH'; });
    var header = firstRowHasTh ? matrix[0] : makeDefaultTableHeader(columnCount);
    var bodyRows = firstRowHasTh ? matrix.slice(1) : matrix;

    return [
      renderMarkdownTableRow(header),
      renderMarkdownTableRow(header.map(function() { return '---'; }))
    ].concat(bodyRows.map(renderMarkdownTableRow)).join('\n');
  }

  function makeDefaultTableHeader(columnCount) {
    var header = [];
    for (var i = 0; i < columnCount; i++) header.push('Column ' + (i + 1));
    return header;
  }

  function normalizeTableCell(cell) {
    var text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  }

  function renderMarkdownTableRow(cells) {
    return '| ' + cells.join(' | ') + ' |';
  }

  // ── Marked ──
  function getMarked() {
    if (markedLib) return markedLib;
    if (typeof marked !== 'undefined') { markedLib = marked; return markedLib; }
    if (typeof window.marked !== 'undefined') { markedLib = window.marked; return markedLib; }
    return null;
  }

  // ── Platform ──
  function getCurrentPlatformConfig() {
    var host = location.hostname;
    for (var i = 0; i < PLATFORM_CONFIGS.length; i++) {
      if (host.indexOf(PLATFORM_CONFIGS[i].host) !== -1) return PLATFORM_CONFIGS[i];
    }
    return null;
  }

  function getSelectors() {
    var config = getCurrentPlatformConfig();
    return config ? config.selectors : GENERIC_SELECTORS;
  }

  function getDedicatedPlatformModule() {
    var host = location.hostname;
    if (host === 'chat.openai.com' || host === 'chatgpt.com') return 'chatgpt';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'deepseek.com' || host.slice(-13) === '.deepseek.com') return 'deepseek';
    if (host === 'doubao.com' || host.slice(-11) === '.doubao.com') return 'doubao';
    if (host === 'kimi.com' || host.slice(-9) === '.kimi.com') return 'kimi';
    if (host === 'kimi.moonshot.cn' || host.slice(-17) === '.kimi.moonshot.cn') return 'kimi';
    if (host === 'yuanbao.tencent.com' || host.slice(-20) === '.yuanbao.tencent.com') return 'yuanbao';
    if (host === 'chatglm.cn' || host.slice(-11) === '.chatglm.cn') return 'chatglm';
    if (host === 'tongyi.aliyun.com' || host.slice(-18) === '.tongyi.aliyun.com') return 'tongyi';
    if (host === 'qwen.ai' || host.slice(-8) === '.qwen.ai') return 'qwen';
    if (host === 'grok.com' || host.slice(-9) === '.grok.com') return 'grok';
    if (host === 'x.com' || host.slice(-6) === '.x.com') return 'grok';
    return null;
  }

  // ══════════════════════════════════════════════════════════
  //  Group: each content container belongs to its direct parent.
  // ══════════════════════════════════════════════════════════

  function findParentWrapper(container) {
    return container.parentElement || container;
  }

  // Content hash to detect re-rendered DOM
  function getContentHash(children) {
    var text = '';
    for (var i = 0; i < children.length; i++) {
      text += (children[i].textContent || '').substring(0, 80);
    }
    var hash = 0;
    for (var j = 0; j < text.length; j++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(j);
      hash = hash & hash;
    }
    return String(hash);
  }

  function deduplicate(nodeList) {
    var seen = new Set();
    var result = [];
    for (var i = 0; i < nodeList.length; i++) {
      if (!seen.has(nodeList[i])) { seen.add(nodeList[i]); result.push(nodeList[i]); }
    }
    return result;
  }

  function getAllContentContainers() {
    var selectors = getSelectors();
    var all = [];
    for (var s = 0; s < selectors.length; s++) {
      try {
        var found = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < found.length; i++) all.push(found[i]);
      } catch(e) {}
    }
    return deduplicate(all);
  }

  // ══════════════════════════════════════════════════════════
  //  Stability check — track the children's combined text
  //  length. Once it stops changing for STABLE_THRESHOLD
  //  consecutive checks, consider the reply complete.
  // ══════════════════════════════════════════════════════════

  function isGroupStable(children) {
    var len = 0;
    for (var i = 0; i < children.length; i++) {
      len += (children[i].textContent || '').trim().length;
    }
    if (len < 20) return false;

    // Use content-based key so it survives DOM re-renders
    var key = getContentHash(children);
    var state = watchingState.get(key);
    if (!state) {
      watchingState.set(key, { length: len, stableCount: 0 });
      return false;
    }

    if (len !== state.length) {
      state.length = len;
      state.stableCount = 0;
      return false;
    }

    state.stableCount++;
    return state.stableCount >= STABLE_THRESHOLD;
  }

  function hasVisibleStopButton(children) {
    var stopTexts = ['停止', 'Stop', '停止生成', 'Stop generating', '取消生成'];
    // Check stop buttons near the message group, not globally
    var parent = findParentWrapper(children[0]);
    var ancestor = parent.parentElement || parent;
    var btns = ancestor.querySelectorAll('button');
    for (var j = 0; j < btns.length; j++) {
      if (btns[j].offsetParent === null) continue;
      var t = (btns[j].textContent || '').trim();
      for (var k = 0; k < stopTexts.length; k++) {
        if (t === stopTexts[k]) return true;
      }
    }
    return false;
  }

  // ══════════════════════════════════════════════════════════
  //  Content extraction
  // ══════════════════════════════════════════════════════════

  function cleanClone(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.ai-saver-host, .ai-saver-modal-host').forEach(function(n) { n.remove(); });
    clone.querySelectorAll('button').forEach(function(n) { n.remove(); });
    clone.querySelectorAll('svg').forEach(function(svg) {
      if (svg.parentElement && svg.parentElement.children.length === 1) svg.parentElement.remove();
    });
    return clone;
  }

  function extractGroup(children) {
    var parts = [];
    for (var i = 0; i < children.length; i++) {
      var clone = cleanClone(children[i]);
      var html = clone.innerHTML;
      if (html && html.trim()) parts.push(html);
    }
    if (parts.length === 0) return null;

    var mergedHtml = parts.join('\n');
    var wrapper = document.createElement('div');
    wrapper.innerHTML = mergedHtml;
    var td = getTurndown();
    var markdown = td ? td.turndown(wrapper) : (wrapper.textContent || '').trim();

    return { html: mergedHtml, markdown: markdown };
  }

  // ══════════════════════════════════════════════════════════
  //  Save button
  // ══════════════════════════════════════════════════════════

  function createSaveButton() {
    var host = document.createElement('div');
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

    shadow.appendChild(style);
    shadow.appendChild(btn);
    return { host: host, button: btn };
  }

  // ══════════════════════════════════════════════════════════
  //  Main scan loop — runs every CHECK_INTERVAL ms
  // ══════════════════════════════════════════════════════════

  function scanAndInject() {
    var allContainers = getAllContentContainers();
    if (allContainers.length === 0) return;

    // Step 1: Group containers by their direct parent
    var parentToChildren = new Map();
    for (var i = 0; i < allContainers.length; i++) {
      var parent = findParentWrapper(allContainers[i]);
      if (!parentToChildren.has(parent)) {
        parentToChildren.set(parent, []);
      }
      parentToChildren.get(parent).push(allContainers[i]);
    }

    // Step 2: For each group, check stability and inject if ready
    parentToChildren.forEach(function(children, parent) {
      if (injectedParents.has(parent)) return;
      if (parent.querySelector('.ai-saver-host')) {
        injectedParents.add(parent);
        return;
      }
      if (hasVisibleStopButton(children)) return;
      if (!isGroupStable(children)) return;

      var hasContent = false;
      for (var j = 0; j < children.length; j++) {
        if ((children[j].textContent || '').trim().length >= 10) { hasContent = true; break; }
      }
      if (!hasContent) return;

      var hash = getContentHash(children);
      if (injectedContentHashes.has(hash)) {
        injectedParents.add(parent);
        return;
      }

      // Inject one button after the last child
      var parts = createSaveButton();
      parts.host.className = 'ai-saver-host';
      parts.button.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        var content = extractGroup(children);
        if (content) showPreviewModal(content.markdown, content.html);
      });

      var lastChild = children[children.length - 1];
      if (lastChild.nextSibling) {
        parent.insertBefore(parts.host, lastChild.nextSibling);
      } else {
        parent.appendChild(parts.host);
      }

      injectedParents.add(parent);
      injectedContentHashes.add(hash);
      watchingState.delete(hash);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  Preview Modal
  // ══════════════════════════════════════════════════════════

  function showPreviewModal(markdown, html) {
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

    var header = document.createElement('div');
    header.className = 'modal-header';
    var title = document.createElement('h2');
    title.textContent = 'AI 回复预览';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    header.appendChild(title);
    header.appendChild(closeBtn);

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
      tabPreview.classList.add('active');
      tabMarkdown.classList.remove('active');
      previewDiv.style.display = '';
      mdDiv.style.display = 'none';
    });
    tabMarkdown.addEventListener('click', function() {
      tabMarkdown.classList.add('active');
      tabPreview.classList.remove('active');
      previewDiv.style.display = 'none';
      mdDiv.style.display = '';
    });

    var footer = document.createElement('div');
    footer.className = 'modal-footer';

    var btnMd = makeBtn('.md', 'btn btn-primary', function() { downloadBlob(markdown, 'ai-response.md', 'text/markdown'); });
    var btnPdf = makeBtn('.pdf', 'btn btn-primary', function() { downloadPdf(markdown); });
    var btnDocx = makeBtn('.docx', 'btn btn-primary', function() { downloadDocx(markdown); });
    var btnCopy = makeBtn('Copy', 'btn btn-secondary', function() {
      navigator.clipboard.writeText(markdown).then(function() {
        btnCopy.textContent = '✅ Copied';
        btnCopy.className = 'btn btn-success';
        setTimeout(function() { btnCopy.textContent = 'Copy'; btnCopy.className = 'btn btn-secondary'; }, 1500);
      });
    });

    footer.appendChild(btnMd);
    footer.appendChild(btnPdf);
    footer.appendChild(btnDocx);
    footer.appendChild(btnCopy);

    modal.appendChild(header);
    modal.appendChild(tabs);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    shadow.appendChild(overlay);

    var closeModal = function() {
      host.remove();
      document.removeEventListener('keydown', escHandler);
    };
    var escHandler = function(e) { if (e.key === 'Escape') closeModal(); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(host);
  }

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
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
    var fullHtml = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>AI Response</title><style>' +
      'body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6;color:#333}' +
      'h1{font-size:18pt;margin:12pt 0 6pt}h2{font-size:15pt;margin:10pt 0 5pt}h3{font-size:12pt;margin:8pt 0 4pt}' +
      'p{margin:6pt 0}ul,ol{margin:6pt 0;padding-left:24pt}' +
      'pre{background:#f4f4f4;padding:8pt;font-family:Consolas,monospace;font-size:9pt;border:1px solid #ddd}' +
      'code{font-family:Consolas,monospace;font-size:9pt}' +
      'blockquote{border-left:3pt solid #667eea;margin:8pt 0;padding:4pt 12pt;color:#555}' +
      'table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border:1px solid #ccc;padding:4pt 8pt;text-align:left}th{background:#f0f0f0;font-weight:bold}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
    downloadBlob(fullHtml, 'ai-response.doc', 'application/msword');
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ══════════════════════════════════════════════════════════
  //  Init — periodic scan only, no MutationObserver
  // ══════════════════════════════════════════════════════════

  function init() {
    var dedicatedModule = getDedicatedPlatformModule();
    if (dedicatedModule) {
      console.log('[AI Saver] Skipping generic scanner on', dedicatedModule);
      return;
    }

    console.log('[AI Saver] Starting on', location.hostname);

    // Initial scans for page-load content
    setTimeout(scanAndInject, 1000);
    setTimeout(scanAndInject, 3000);
    setTimeout(scanAndInject, 6000);

    // Periodic scan
    setInterval(scanAndInject, CHECK_INTERVAL);

    console.log('[AI Saver] Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
