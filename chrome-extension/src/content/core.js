// ChatSavor Core — shared utilities for all platform modules
// Exposed as window.ChatSavorCore

window.ChatSavorCore = (function() {
  'use strict';

  // Keep all platforms on the same source-preserving conversion path.
  function getTurndown() { return window.ChatSavorMarkdown.getTurndown(); }
  function getMarked() { return window.ChatSavorMarkdown.getMarked(); }
  function extractMarkdown(container) { return window.ChatSavorMarkdown.extract(container); }

  // ── Cross-origin preferences (BUG-01) ──
  // Options lives on chrome-extension:// origin; content scripts live on third-party
  // origins where localStorage is isolated. chrome.storage.local is the single
  // cross-context source of truth, mirrored into this in-memory cache.
  var cachedPrefs = {
    frontmatter: false, cotMode: 'omit', vault: '', vaultDir: '',
    theme: 'auto', historyEnabled: true,
  };
  var PREFS_DEFAULTS = {
    frontmatter: false, cotMode: 'omit', vault: '', vaultDir: '',
    theme: 'auto', historyEnabled: true,
  };

  function legacyKey(key) { return key === 'vault' ? 'chatsavor_obsidian_vault' : 'chatsavor_' + key; }

  function applyPrefs(value) {
    if (!value || typeof value !== 'object') return;
    Object.keys(PREFS_DEFAULTS).forEach(function(key) {
      if (value[key] !== undefined && value[key] !== null) cachedPrefs[key] = value[key];
    });
  }

  function syncPrefsFromStorage(callback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
        chrome.storage.local.get('prefs', function(result) {
          var parsed = null;
          try { parsed = JSON.parse(result && result.prefs || 'null'); } catch (ignored) {}
          applyPrefs(parsed);
          // Backward-compatible fallback for values only present in this origin's localStorage.
          Object.keys(PREFS_DEFAULTS).forEach(function(key) {
            if (parsed && parsed[key] !== undefined) return;
            try {
              var legacy = localStorage.getItem(legacyKey(key));
              if (legacy !== null) cachedPrefs[key] = legacy;
            } catch (ignored) {}
          });
          if (callback) callback();
        });
        return;
      }
    } catch (ignored) {}
    // No chrome.storage: fall back to same-origin localStorage (JSDOM tests).
    Object.keys(PREFS_DEFAULTS).forEach(function(key) {
      try {
        var legacy = localStorage.getItem(legacyKey(key));
        if (legacy !== null) cachedPrefs[key] = legacy;
      } catch (ignored) {}
    });
    if (callback) callback();
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function(changes, area) {
        if (area !== 'local' || !changes || !changes.prefs || !changes.prefs.newValue) return;
        try { applyPrefs(JSON.parse(changes.prefs.newValue)); } catch (ignored) {}
      });
    }
  } catch (ignored) {}
  syncPrefsFromStorage();

  // ── Metadata helpers (T3.1) ──
  function metaApi() { return window.ChatSavorMeta || null; }
  function persistPref(key, value) {
    cachedPrefs[key] = value;
    try { localStorage.setItem('chatsavor_' + key, String(value)); } catch (ignored) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('prefs', function(result) {
          var parsed = {};
          try { parsed = JSON.parse(result && result.prefs || '{}') || {}; } catch (ignored) {}
          parsed[key] = value;
          chrome.storage.local.set({ prefs: JSON.stringify(parsed) });
        });
      }
    } catch (ignored) {}
  }
  function frontmatterEnabled() { return cachedPrefs.frontmatter === true || cachedPrefs.frontmatter === '1' || cachedPrefs.frontmatter === 'true'; }
  function setFrontmatterEnabled(enabled) { persistPref('frontmatter', !!enabled); }
  function savedCotMode() { return cachedPrefs.cotMode || 'omit'; }
  function savedTheme() { return cachedPrefs.theme || 'auto'; }
  function savedVault() { return cachedPrefs.vault || ''; }
  function savedVaultDir() { return cachedPrefs.vaultDir || ''; }
  function buildObsidianUri(markdown, pageMeta) {
    var vault = savedVault();
    var vaultDir = savedVaultDir().replace(/^\/+|\/+$/g, '');
    var name = (pageMeta && pageMeta.title) || 'AI Response';
    var noteName = vaultDir ? vaultDir + '/' + name : name;
    return 'obsidian://new?name=' + encodeURIComponent(noteName) + '&content=' + encodeURIComponent(markdown) +
      (vault ? '&vault=' + encodeURIComponent(vault) : '');
  }

  // For binary/document exports: never inject raw YAML into the rendered body.
  function exportPlain(markdown, ext) {
    var meta = metaApi();
    var pageMeta = meta ? meta.getPageMeta(null, markdown) : null;
    var filename = meta ? meta.buildFilename(pageMeta, ext || 'md') : 'ai-response.' + (ext || 'md');
    saveHistory(markdown, pageMeta);
    return { text: markdown, filename: filename, meta: pageMeta };
  }

  function exportText(markdown) {
    var meta = metaApi();
    if (!meta) return { text: markdown, filename: 'ai-response' };
    var pageMeta = meta.getPageMeta(null, markdown);
    return { text: meta.withFrontmatter(markdown, pageMeta, frontmatterEnabled()), filename: meta.buildFilename(pageMeta, 'md').replace(/\.md$/, ''), meta: pageMeta };
  }
  function downloadText(markdown, ext, mimeType) {
    var meta = metaApi();
    var pageMeta = meta ? meta.getPageMeta(null, markdown) : null;
    var text = meta ? meta.withFrontmatter(markdown, pageMeta, frontmatterEnabled()) : markdown;
    var filename = meta ? meta.buildFilename(pageMeta, ext) : 'ai-response.' + ext;
    saveHistory(markdown, pageMeta);
    downloadBlob(text, filename, mimeType);
    return { text: text, filename: filename };
  }

  var historyQueue = Promise.resolve();
  function saveHistory(markdown, pageMeta) {
    if (cachedPrefs.historyEnabled === false || cachedPrefs.historyEnabled === 'false') return;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      // Serialize read-modify-write so rapid exports don't overwrite each other.
      historyQueue = historyQueue.then(function() {
        return new Promise(function(resolve) {
          chrome.storage.local.get('history', function(result) {
            var list = [];
            try { list = JSON.parse(result && result.history || '[]'); } catch (ignored) {}
            list.unshift({ title: pageMeta && pageMeta.title || 'AI Response', platform: pageMeta && pageMeta.platform || '', time: pageMeta && pageMeta.datetime || '', markdown: markdown });
            chrome.storage.local.set({ history: JSON.stringify(list.slice(0, 50)) }, resolve);
          });
        });
      });
    } catch (ignored) {}
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
    btn.textContent = '🔄 转换';
    btn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); onClick(); });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    return host;
  }

  // ── Inject button below a container ──
  function injectButtonAfter(container, onClick) {
    if (!container || !container.parentElement) return false;
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

  var activeModalCleanup = null;

  // Open the modal with preferences freshly loaded from the extension origin.
  function showPreviewModal(markdown, options) {
    syncPrefsFromStorage(function() { renderPreviewModal(markdown, options); });
  }

  function renderPreviewModal(markdown, options) {
    if (activeModalCleanup) { activeModalCleanup(); activeModalCleanup = null; }
    document.querySelectorAll('.ai-saver-modal-host').forEach(function(node) { node.remove(); });
    options = options || {};
    var thinking = options.thinking || '';
    var thinkingMode = savedCotMode();
    var baseMarkdown = markdown;
    var userEdited = false;
    function stripThinkingBlock(md) {
      var text = String(md || '');
      // <details><summary>思考过程</summary> ... </details>
      text = text.replace(/^<details><summary>思考过程<\/summary>[\s\S]*?<\/details>\s*/, '');
      // > [!abstract]- 思考过程 ... consecutive quoted lines
      text = text.replace(/^> \[!abstract\]- 思考过程\s*\n(?:>[^\n]*\n?)+/, '');
      return text.replace(/^\s*\n/, '');
    }
    var effectiveMd = function() {
      if (userEdited) return baseMarkdown;
      var mdApi = window.ChatSavorMarkdown;
      return (thinking && mdApi && typeof mdApi.applyThinkingMode === 'function')
        ? mdApi.applyThinkingMode(baseMarkdown, thinking, thinkingMode) : baseMarkdown;
    };
    markdown = effectiveMd();

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
      '.modal{--cs-bg:#fff;--cs-surface:#fafafa;--cs-text:#333;--cs-border:#e5e7eb;--cs-code-bg:#f6f8fa;background:var(--cs-bg);color:var(--cs-text)}',
      '.modal.dark{--cs-bg:#1f2937;--cs-surface:#374151;--cs-text:#e5e7eb;--cs-border:#4b5563;--cs-code-bg:#111827}',
      '.modal.dark .preview,.modal.dark .raw-md-editor,.modal.dark .compatibility,.modal.dark .copy-status{color:var(--cs-text)}',
      '.modal.dark .preview blockquote,.modal.dark .compatibility,.modal.dark .copy-status{background:var(--cs-surface);color:var(--cs-text)}',
      '.modal.dark .preview pre,.modal.dark .raw-md-editor,.modal.dark .formula-item pre{background:var(--cs-code-bg);color:var(--cs-text)}',
      '.modal.dark .tabs,.modal.dark .modal-footer{background:var(--cs-surface);border-color:var(--cs-border)}',
      '.modal.dark .preview th,.modal.dark .preview td{border-color:var(--cs-border)}',
      '.raw-md-editor{width:100%;min-height:260px;box-sizing:border-box;background:var(--cs-code-bg);color:var(--cs-text);border:1px solid var(--cs-border);border-radius:6px;padding:14px;font-family:"Fira Code",Consolas,monospace;font-size:13px;line-height:1.6;resize:vertical}',
      '.theme-btn{margin-left:auto;background:rgba(255,255,255,.2)}',
    ].join('\n');
    shadow.appendChild(style);

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    var modal = document.createElement('div');
    modal.className = 'modal';
    var themePref = savedTheme();
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var isDark = themePref === 'dark' || (themePref === 'auto' && prefersDark);
    if (isDark) modal.classList.add('dark');

    // Header
    var header = document.createElement('div');
    header.className = 'modal-header';
    var title = document.createElement('h2');
    title.textContent = 'AI 回复预览';
    var themeBtn = document.createElement('button');
    themeBtn.className = 'theme-btn';
    themeBtn.textContent = isDark ? '☀' : '🌙';
    themeBtn.addEventListener('click', function() {
      isDark = !isDark;
      modal.classList.toggle('dark', isDark);
      themeBtn.textContent = isDark ? '☀' : '🌙';
      persistPref('theme', isDark ? 'dark' : 'light');
    });
    var closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    header.appendChild(title);
    header.appendChild(themeBtn);
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
    if (thinking) {
      var cotSelect = document.createElement('select');
      cotSelect.className = 'cot-mode';
      cotSelect.style.cssText = 'margin-left:auto;font-size:12px;padding:3px 6px;border-radius:5px;border:1px solid #ddd';
      [['omit', '隐藏思考'], ['details', '折叠思考'], ['callout', 'Obsidian Callout']].forEach(function(pair) {
        var opt = document.createElement('option');
        opt.value = pair[0]; opt.textContent = pair[1];
        cotSelect.appendChild(opt);
      });
      cotSelect.value = thinkingMode;
      cotSelect.addEventListener('change', function() {
        thinkingMode = cotSelect.value;
        persistPref('cotMode', thinkingMode);
        // Re-apply the thinking mode to the latest (possibly edited) body.
        baseMarkdown = stripThinkingBlock(mdDiv.value);
        userEdited = false;
        markdown = effectiveMd();
        previewDiv.innerHTML = window.ChatSavorMarkdown.render(markdown);
        mdDiv.value = markdown;
        mdDiv.textContent = markdown;
        rebuildFormulas(markdown);
      });
      tabs.appendChild(cotSelect);
    }

    // Body
    var body = document.createElement('div');
    body.className = 'modal-body';

    var previewDiv = document.createElement('div');
    previewDiv.className = 'preview';
    previewDiv.innerHTML = window.ChatSavorMarkdown.render(markdown);

    var mdDiv = document.createElement('textarea');
    mdDiv.className = 'raw-md raw-md-editor';
    mdDiv.value = markdown;
    mdDiv.textContent = markdown; // keeps .raw-md textContent assertions compatible
    mdDiv.style.display = 'none';
    var editTimer = null;
    mdDiv.addEventListener('input', function() {
      if (editTimer) clearTimeout(editTimer);
      editTimer = setTimeout(function() {
        userEdited = true;
        baseMarkdown = mdDiv.value;
        mdDiv.textContent = mdDiv.value;
        markdown = effectiveMd();
        previewDiv.innerHTML = window.ChatSavorMarkdown.render(markdown);
        rebuildFormulas(markdown);
        editTimer = null;
      }, 200);
    });

    body.appendChild(previewDiv);
    body.appendChild(mdDiv);
    var formulaDiv = document.createElement('div');
    formulaDiv.className = 'formula-list';
    formulaDiv.style.display = 'none';

    // Single source of truth for formula tab count, visibility and list items.
    function rebuildFormulas(md) {
      var nextFormulas = window.ChatSavorMarkdown.getFormulas(md);
      tabFormulas.textContent = '公式 (' + nextFormulas.length + ')';
      if (nextFormulas.length) {
        if (!tabFormulas.parentNode) tabs.insertBefore(tabFormulas, cotSelect || null);
      } else if (tabFormulas.parentNode) {
        tabFormulas.parentNode.removeChild(tabFormulas);
      }
      formulaDiv.innerHTML = '';
      nextFormulas.forEach(function(formula, index) {
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
    }

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

    rebuildFormulas(markdown);
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
    var btnMd = makeBtn('.md', 'btn btn-primary', function() { downloadText(markdown, 'md', 'text/markdown'); });
    var btnPdf = makeBtn('.pdf', 'btn btn-primary', function() {
      var original = btnPdf.textContent;
      btnPdf.disabled = true;
      btnPdf.textContent = '正在生成 PDF…';
      var prepared = exportPlain(markdown, 'pdf');
      Promise.resolve(downloadPdf(markdown, prepared)).then(function() {
        btnPdf.disabled = false;
        btnPdf.textContent = original;
      }).catch(function(error) {
        btnPdf.disabled = false;
        btnPdf.textContent = original;
        copyStatus.textContent = 'PDF 生成失败：' + (error && error.message || error);
      });
    });
    var btnDocx = makeBtn('.docx', 'btn btn-primary', function() {
      var prepared = exportPlain(markdown, 'docx');
      var meta = metaApi();
      if (window.ChatSavorDocx && typeof window.ChatSavorDocx.build === 'function') {
        var blob = window.ChatSavorDocx.build(prepared.text);
        saveBlob(blob, prepared.filename.replace(/\.docx$/, '') + '.docx');
      } else {
        var htmlBody = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(prepared.text) : '<pre>' + escapeHtml(prepared.text) + '</pre>';
        var legacyName = meta && prepared.meta ? meta.buildFilename(prepared.meta, 'doc').replace(/\.doc$/, '') : 'ai-response';
        downloadBlob(docxHtml(htmlBody), legacyName + '.doc', 'application/msword');
      }
    });
    var btnHtml = makeBtn('.html', 'btn btn-primary', function() {
      var prepared = exportPlain(markdown, 'html');
      var body = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(prepared.text) : '<pre>' + escapeHtml(prepared.text) + '</pre>';
      downloadBlob(singleFileHtml(body, prepared.meta && prepared.meta.title || 'AI Response'), prepared.filename, 'text/html');
    });
    var btnCopy = makeBtn('复制 Markdown', 'btn btn-secondary', function() {
      copyWithFeedback(btnCopy, function() { return window.ChatSavorMarkdown.copy(markdown, false); });
    });
    var btnRich = makeBtn('复制富文本', 'btn btn-secondary', function() {
      copyWithFeedback(btnRich, function() { return window.ChatSavorMarkdown.copy(markdown, true); });
    });
    var fmLabel = document.createElement('label');
    fmLabel.className = 'frontmatter-toggle';
    fmLabel.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#374151;cursor:pointer';
    var fmCheck = document.createElement('input');
    fmCheck.type = 'checkbox';
    fmCheck.checked = frontmatterEnabled();
    fmCheck.addEventListener('change', function() { setFrontmatterEnabled(fmCheck.checked); });
    fmLabel.appendChild(fmCheck);
    fmLabel.appendChild(document.createTextNode('包含 Frontmatter（Obsidian）'));
    var btnObsidian = makeBtn('发送到 Obsidian', 'btn btn-secondary', function() {
      var meta = metaApi();
      var pageMeta = meta ? meta.getPageMeta(null, markdown) : { title: 'AI Response', platformId: 'generic' };
      var noteContent = meta ? meta.withFrontmatter(markdown, pageMeta, frontmatterEnabled()) : markdown;
      var uri = buildObsidianUri(noteContent, pageMeta);
      if (uri.length > 30000) {
        copyStatus.textContent = '内容超过 Obsidian URI 长度限制（30,000 字符），请改用“下载 .md”后手动放入库中。';
        return;
      }
      saveHistory(markdown, pageMeta);
      window.location.href = uri;
    });
    footer.appendChild(fmLabel);
    footer.appendChild(btnMd); footer.appendChild(btnHtml); footer.appendChild(btnPdf); footer.appendChild(btnDocx); footer.appendChild(btnCopy); footer.appendChild(btnRich); footer.appendChild(btnObsidian);

    modal.appendChild(header); modal.appendChild(tabs);
    if (formulas.length || unconverted) modal.appendChild(compatibility);
    modal.appendChild(body); modal.appendChild(copyStatus); modal.appendChild(footer);
    overlay.appendChild(modal); shadow.appendChild(overlay);

    var closeModal = function() {
      if (editTimer) clearTimeout(editTimer);
      host.remove();
      document.removeEventListener('keydown', escHandler);
      if (activeModalCleanup === closeModal) activeModalCleanup = null;
    };
    var escHandler = function(e) { if (e.key === 'Escape') closeModal(); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escHandler);
    activeModalCleanup = closeModal;
    var mountRoot = document.body || document.documentElement;
    if (mountRoot) mountRoot.appendChild(host);
  }

  // ── Helpers ──

  function makeBtn(text, className, onClick) {
    var btn = document.createElement('button');
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  function singleFileHtml(bodyHtml, title) {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHtml(title) + '</title><style>' +
      ':root{color-scheme:light dark}' +
      'body{max-width:820px;margin:32px auto;padding:0 18px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;line-height:1.7;color:#1f2937;background:#fff}' +
      '@media (prefers-color-scheme:dark){body{background:#111827;color:#e5e7eb}pre{background:#1f2937!important}th{background:#1f2937!important}blockquote{background:#1f2937!important}}' +
      'pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto}' +
      'code{font-family:Consolas,Monaco,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:6px 10px}' +
      'th{background:#f6f8fa}blockquote{border-left:3px solid #667eea;margin:8pt 0;padding:4pt 12pt;background:#f8f9ff;color:#555}' +
      'img{max-width:100%}.chatsavor-math{max-width:100%;overflow-x:auto}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
  }

  function downloadBlob(content, filename, mimeType) {
    saveBlob(new Blob([content], { type: mimeType + ';charset=utf-8' }), filename);
  }

  function downloadPdf(markdown, prepared) {
    var meta = prepared && prepared.meta || (metaApi() ? metaApi().getPageMeta(null, markdown) : null);
    var title = meta && meta.title || 'AI Response';
    var preparedText = prepared ? prepared.text : markdown;
    var html = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(preparedText) : '<pre>' + escapeHtml(preparedText) + '</pre>';
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        return Promise.resolve(chrome.runtime.sendMessage({
          type: 'CHATSAVOR_OPEN_PRINT',
          payload: {
            title: title,
            html: html,
            filename: (prepared ? prepared.filename : 'ai-response') + '.pdf',
            markdown: preparedText,
            platform: (meta && meta.platform) || 'AI',
            datetime: (meta && meta.datetime) || (meta && meta.date) || ''
          }
        })).then(function() { return true; }).catch(function(error) {
          console.error('[ChatSavor] print page unavailable:', error);
          return legacyPdf(markdown, prepared);
        });
      } catch (ignored) { /* fall through to legacy exporter */ }
    }
    return legacyPdf(markdown, prepared);
  }

  function legacyPdf(markdown, prepared) {
    if (window.ChatSavorPdf && typeof window.ChatSavorPdf.downloadMarkdownPdf === 'function') {
      var meta = prepared && prepared.meta || (metaApi() ? metaApi().getPageMeta(null, markdown) : null);
      return window.ChatSavorPdf.downloadMarkdownPdf(markdown, {
        filename: (prepared ? prepared.filename : 'ai-response') + '.pdf',
        title: meta && meta.title || 'AI Response'
      }).catch(function(error) {
        console.error('[ChatSavor] PDF download failed:', error);
      });
    }
    console.warn('[ChatSavor] PDF exporter unavailable');
  }

  function docxHtml(bodyHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>AI Response</title><style>' +
      'body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.6;color:#333}' +
      'h1{font-size:18pt;margin:12pt 0 6pt}h2{font-size:15pt;margin:10pt 0 5pt}h3{font-size:12pt;margin:8pt 0 4pt}' +
      'p{margin:6pt 0}ul,ol{margin:6pt 0;padding-left:24pt}' +
      'pre{background:#f4f4f4;padding:8pt;font-family:Consolas,monospace;font-size:9pt;border:1px solid #ddd}' +
      'code{font-family:Consolas,monospace;font-size:9pt}' +
      'blockquote{border-left:3pt solid #667eea;margin:8pt 0;padding:4pt 12pt;color:#555}' +
      'table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border:1px solid #ccc;padding:4pt 8pt;text-align:left}th{background:#f0f0f0;font-weight:bold}' +
      '</style></head><body>' + bodyHtml + '</body></html>';
  }

  function downloadDocx(markdown) {
    var bodyHtml = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(markdown) : '<pre>' + escapeHtml(markdown) + '</pre>';
    downloadBlob(docxHtml(bodyHtml), 'ai-response.doc', 'application/msword');
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
    buildObsidianUri: buildObsidianUri,
    getPrefs: function() { return JSON.parse(JSON.stringify(cachedPrefs)); },
    syncPrefsFromStorage: syncPrefsFromStorage,
  };
})();
