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
  function createSaveButton(onClick, quickCopyHandler) {
    var host = document.createElement('div');
    host.className = 'ai-saver-host';
    host.style.cssText = 'display:flex; justify-content:flex-end; padding:6px 0 2px; margin-top:6px;';

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:block}',
      '.cs-action-pill{display:inline-flex;align-items:center;gap:2px;padding:2px;background:rgba(255,255,255,0.92);border:1px solid rgba(226,232,240,0.95);border-radius:999px;box-shadow:0 2px 8px rgba(15,23,42,0.06);backdrop-filter:blur(8px);}',
      '@media (prefers-color-scheme: dark){.cs-action-pill{background:rgba(30,41,59,0.88);border-color:rgba(71,85,105,0.7);box-shadow:0 2px 10px rgba(0,0,0,0.25);}}',
      '.save-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:transparent;border:none;border-radius:999px;cursor:pointer;font-size:12px;font-weight:500;color:#4f46e5;transition:all 140ms ease;user-select:none;white-space:nowrap;}',
      '@media (prefers-color-scheme: dark){.save-btn{color:#818cf8;}}',
      '.save-btn:hover{background:#4f46e5;color:#ffffff;}',
      '.quick-copy-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:transparent;border:none;border-radius:999px;cursor:pointer;font-size:12px;font-weight:500;color:#334155;transition:all 140ms ease;user-select:none;white-space:nowrap;}',
      '@media (prefers-color-scheme: dark){.quick-copy-btn{color:#cbd5e1;}}',
      '.quick-copy-btn:hover{background:rgba(15,23,42,0.06);}',
      '.quick-copy-btn.is-copied{color:#059669;}',
      '.pill-sep{width:1px;height:12px;background:rgba(226,232,240,0.95);flex:none;}',
      '.btn-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;}',
      '.btn-label{display:inline;}',
    ].join('\n');

    var pill = document.createElement('div');
    pill.className = 'cs-action-pill';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'save-btn';
    btn.setAttribute('title', '打开预览与导出工作台');
    var iconWrap = document.createElement('span');
    iconWrap.className = 'btn-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12M4 6l4-4 4 4"/></svg>';
    var labelWrap = document.createElement('span');
    labelWrap.className = 'btn-label';
    labelWrap.textContent = '导出 / 预览';
    btn.appendChild(iconWrap);
    btn.appendChild(labelWrap);
    btn.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); onClick(); });
    pill.appendChild(btn);

    if (quickCopyHandler) {
      var sep = document.createElement('span');
      sep.className = 'pill-sep';
      sep.setAttribute('aria-hidden', 'true');
      pill.appendChild(sep);

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'quick-copy-btn';
      copyBtn.setAttribute('title', '一键复制 Markdown');
      var copyIcon = document.createElement('span');
      copyIcon.className = 'btn-icon';
      copyIcon.setAttribute('aria-hidden', 'true');
      copyIcon.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>';
      var copyLabel = document.createElement('span');
      copyLabel.className = 'btn-label';
      copyLabel.textContent = '复制 MD';
      copyBtn.appendChild(copyIcon);
      copyBtn.appendChild(copyLabel);
      copyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        quickCopyHandler(copyBtn, copyLabel);
      });
      pill.appendChild(copyBtn);
    }

    shadow.appendChild(style);
    shadow.appendChild(pill);
    return host;
  }

  // ── Inject button below a container ──
  function injectButtonAfter(container, onClick) {
    if (!container || !container.parentElement) return false;
    if (container.nextElementSibling && container.nextElementSibling.classList.contains('ai-saver-host')) return false;
    var quickCopyHandler = function(btn, label) {
      var result = extractMarkdown(container);
      var text = result && result.markdown || '';
      if (window.ChatSavorMeta) {
        var pageMeta = window.ChatSavorMeta.getPageMeta(null, text);
        text = window.ChatSavorMeta.withFrontmatter(text, pageMeta, frontmatterEnabled());
        saveHistory(result && result.markdown || text, pageMeta);
      }
      window.ChatSavorMarkdown.copy(text, false).then(function() {
        label.textContent = '✓ 已复制';
        btn.classList.add('is-copied');
        setTimeout(function() { label.textContent = '复制 MD'; btn.classList.remove('is-copied'); }, 1400);
      }).catch(function() {});
    };
    var btn = createSaveButton(onClick, quickCopyHandler);
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
      // ── UI redesign tokens & layout ──
      '.modal{--cs-surface-2:#f1f5f9;--cs-text-secondary:#334155;--cs-muted:#64748b;--cs-accent:#4f46e5;--cs-accent-hover:#4338ca;--cs-accent-soft:#eef2ff;--cs-success:#059669;--cs-danger:#dc2626;}',
      '.modal.dark{--cs-surface-2:#020617;--cs-text-secondary:#cbd5e1;--cs-muted:#94a3b8;--cs-accent:#6366f1;--cs-accent-hover:#818cf8;--cs-accent-soft:rgba(99,102,241,0.16);--cs-success:#34d399;--cs-danger:#f87171;}',
      '.overlay{background:rgba(15,23,42,0.52);backdrop-filter:blur(6px);padding:16px;box-sizing:border-box;}',
      '.modal{width:860px;max-width:94vw;max-height:88vh;border-radius:16px;border:1px solid var(--cs-border);box-shadow:0 25px 65px -12px rgba(15,23,42,0.32);animation:csModalIn 180ms cubic-bezier(0.16,1,0.3,1);}',
      '.modal.expanded{width:1140px;max-width:96vw;height:92vh;max-height:92vh;}',
      '@keyframes csModalIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}',
      '.modal-header{background:var(--cs-bg);color:var(--cs-text);border-bottom:1px solid var(--cs-border);padding:14px 20px;display:flex;align-items:center;gap:10px;justify-content:space-between;}',
      '.header-left{display:flex;align-items:center;gap:10px;min-width:0;}',
      '.brand-icon{display:inline-flex;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;align-items:center;justify-content:center;flex:none;}',
      '.modal-header h2{font-size:15px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.doc-stats{font-size:11px;color:var(--cs-muted);background:var(--cs-surface);border:1px solid var(--cs-border);border-radius:999px;padding:2px 8px;flex:none;}',
      '.header-controls{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none;}',
      '.expand-btn,.theme-btn,.close-btn{width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:var(--cs-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 140ms ease;}',
      '.expand-btn:hover,.theme-btn:hover{background:var(--cs-surface);color:var(--cs-text);}',
      '.close-btn{font-size:16px;}',
      '.close-btn:hover{background:var(--cs-accent-soft);color:var(--cs-accent);}',
      '.tabs{display:flex;align-items:center;gap:10px;padding:8px 20px;background:var(--cs-surface);border-bottom:1px solid var(--cs-border);flex-wrap:wrap;}',
      '.tab-group{display:inline-flex;background:var(--cs-surface-2);padding:3px;border-radius:9px;gap:2px;}',
      '.tab{padding:5px 14px;border-radius:7px;font-size:12.5px;font-weight:500;color:var(--cs-muted);border:none;background:transparent;cursor:pointer;}',
      '.tab.active{background:var(--cs-bg);color:var(--cs-accent);font-weight:600;box-shadow:0 1px 3px rgba(15,23,42,0.08);}',
      '.tabs-controls{margin-left:auto;display:flex;align-items:center;gap:12px;}',
      '.tabs-controls select.cot-mode{font-size:12px;padding:5px 8px;border-radius:7px;border:1px solid var(--cs-border);background:var(--cs-bg);color:var(--cs-text-secondary);}',
      '.frontmatter-toggle{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--cs-text-secondary);cursor:pointer;}',
      '.frontmatter-toggle input{position:absolute;opacity:0;width:0;height:0;}',
      '.switch-slider{width:30px;height:17px;background:var(--cs-border);border-radius:999px;position:relative;transition:all 140ms ease;flex:none;}',
      '.switch-slider:before{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;background:#fff;border-radius:50%;transition:all 140ms ease;}',
      '.frontmatter-toggle input:checked + .switch-slider{background:var(--cs-accent);}',
      '.frontmatter-toggle input:checked + .switch-slider:before{transform:translateX(13px);}',
      '.modal-body{padding:22px 28px;}',
      '.modal-footer{display:flex;flex-direction:column;gap:10px;padding:12px 20px 14px;background:var(--cs-surface);border-top:1px solid var(--cs-border);}',
      '.footer-row-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}',
      '.action-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.card-capsule{display:inline-flex;align-items:center;background:var(--cs-bg);border:1px solid var(--cs-border);border-radius:9px;padding:2px;gap:2px;}',
      '.card-capsule select.card-theme-select{border:none;background:transparent;font-size:12px;padding:5px 6px;color:var(--cs-text-secondary);}',
      '.capsule-sep{width:1px;height:18px;background:var(--cs-border);}',
      '.footer-row-bottom{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:8px;border-top:1px dashed var(--cs-border);}',
      '.dock-label{font-size:11.5px;font-weight:600;color:var(--cs-muted);margin-right:4px;}',
      '.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:500;transition:all 140ms ease;}',
      '.btn-primary{background:var(--cs-accent);color:#fff;}',
      '.btn-primary:hover{background:var(--cs-accent-hover);}',
      '.btn-secondary{background:var(--cs-bg);color:var(--cs-text-secondary);border:1px solid var(--cs-border);}',
      '.btn-secondary:hover{border-color:var(--cs-accent);color:var(--cs-accent);background:var(--cs-accent-soft);}',
      '.btn-format{background:var(--cs-bg);border:1px solid var(--cs-border);color:var(--cs-text-secondary);border-radius:7px;padding:5px 11px;font-size:12px;font-weight:500;}',
      '.btn-format:hover{border-color:var(--cs-accent);background:var(--cs-accent-soft);color:var(--cs-accent);}',
      '.btn-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;}',
      '.btn-label{display:inline;}',
      'button:focus-visible{outline:2px solid var(--cs-accent);outline-offset:2px;}',
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
    var headerLeft = document.createElement('div');
    headerLeft.className = 'header-left';
    var brandIcon = document.createElement('span');
    brandIcon.className = 'brand-icon';
    brandIcon.setAttribute('aria-hidden', 'true');
    brandIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h10v10H3z"/><path d="M6 6h4v4H6z"/></svg>';
    var title = document.createElement('h2');
    title.textContent = options.mode === 'conversation' ? '整场对话预览与导出' : options.mode === 'selection' ? '多选回复预览与导出' : 'AI 回复预览';
    var docStats = document.createElement('span');
    docStats.className = 'doc-stats';
    docStats.textContent = String(markdown.length) + ' 字符' + (options.turnsCount ? ' · ' + options.turnsCount + ' 轮' : '');
    headerLeft.appendChild(brandIcon);
    headerLeft.appendChild(title);
    headerLeft.appendChild(docStats);

    var headerRight = document.createElement('div');
    headerRight.className = 'header-controls';
    var expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'expand-btn';
    expandBtn.setAttribute('title', '切换宽屏视图');
    expandBtn.setAttribute('aria-label', '切换宽屏视图');
    expandBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3h4v4M3 3l6 6M13 3H9v4M13 3l-6 6M3 13h4v-4M3 13l6-6M13 13H9v-4M13 13l-6-6"/></svg>';
    expandBtn.addEventListener('click', function() { modal.classList.toggle('expanded'); });
    var themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.className = 'theme-btn';
    themeBtn.setAttribute('title', '切换浅色/深色主题');
    themeBtn.setAttribute('aria-label', '切换主题');
    themeBtn.innerHTML = isDark
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3a5 5 0 1 0 5 5 4.5 4.5 0 0 1-5-5z"/></svg>';
    themeBtn.addEventListener('click', function() {
      isDark = !isDark;
      modal.classList.toggle('dark', isDark);
      themeBtn.innerHTML = isDark
        ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3a5 5 0 1 0 5 5 4.5 4.5 0 0 1-5-5z"/></svg>';
      persistPref('theme', isDark ? 'dark' : 'light');
    });
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '关闭');
    headerRight.appendChild(expandBtn);
    headerRight.appendChild(themeBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    // Tabs
    var tabs = document.createElement('div');
    tabs.className = 'tabs';
    var tabGroup = document.createElement('div');
    tabGroup.className = 'tab-group';
    var tabPreview = document.createElement('button');
    tabPreview.type = 'button';
    tabPreview.className = 'tab active';
    tabPreview.textContent = '预览';
    var tabMarkdown = document.createElement('button');
    tabMarkdown.type = 'button';
    tabMarkdown.className = 'tab';
    tabMarkdown.textContent = 'Markdown';
    tabGroup.appendChild(tabPreview);
    tabGroup.appendChild(tabMarkdown);
    var formulas = window.ChatSavorMarkdown.getFormulas(markdown);
    var tabFormulas = document.createElement('button');
    tabFormulas.type = 'button';
    tabFormulas.className = 'tab';
    tabFormulas.textContent = '公式 (' + formulas.length + ')';
    if (formulas.length) tabGroup.appendChild(tabFormulas);
    tabs.appendChild(tabGroup);

    var tabsControls = document.createElement('div');
    tabsControls.className = 'tabs-controls';
    var cotSelect = null;
    if (thinking) {
      cotSelect = document.createElement('select');
      cotSelect.className = 'cot-mode';
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
        docStats.textContent = String(markdown.length) + ' 字符' + (options.turnsCount ? ' · ' + options.turnsCount + ' 轮' : '');
        rebuildFormulas(markdown);
      });
      tabsControls.appendChild(cotSelect);
    }
    tabs.appendChild(tabsControls);

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
        docStats.textContent = String(markdown.length) + ' 字符' + (options.turnsCount ? ' · ' + options.turnsCount + ' 轮' : '');
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
        if (!tabFormulas.parentNode) tabGroup.appendChild(tabFormulas);
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
        setBtnLabel(button, '✅ 已复制');
        copyStatus.textContent = rich === false && button === btnRich ? '当前浏览器未能复制富文本，已改为复制 Markdown。' : '';
        setTimeout(function() { setBtnLabel(button, label); }, 1500);
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

    var btnMd = makeBtn('.md', 'btn btn-format', function() { downloadText(markdown, 'md', 'text/markdown'); });
    var btnPdf = makeBtn('.pdf', 'btn btn-format', function() {
      var original = btnPdf.textContent;
      btnPdf.disabled = true;
      setBtnLabel(btnPdf, '正在生成 PDF…');
      var prepared = exportPlain(markdown, 'pdf');
      Promise.resolve(downloadPdf(markdown, prepared)).then(function() {
        btnPdf.disabled = false;
        setBtnLabel(btnPdf, original);
      }).catch(function(error) {
        btnPdf.disabled = false;
        setBtnLabel(btnPdf, original);
        copyStatus.textContent = 'PDF 生成失败：' + (error && error.message || error);
      });
    });
    var btnDocx = makeBtn('.docx', 'btn btn-format', function() {
      var prepared = exportPlain(markdown, 'docx');
      var meta = metaApi();
      var docxApi = window.ChatSavorDocx;
      if (!docxApi || typeof docxApi.build !== 'function') {
        var htmlBody = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(prepared.text) : '<pre>' + escapeHtml(prepared.text) + '</pre>';
        var legacyName = meta && prepared.meta ? meta.buildFilename(prepared.meta, 'doc').replace(/\.doc$/, '') : 'ai-response';
        downloadBlob(docxHtml(htmlBody), legacyName + '.doc', 'application/msword');
        return;
      }
      var filename = prepared.filename.replace(/\.docx$/, '') + '.docx';
      if (docxApi.needsAsyncMedia && docxApi.needsAsyncMedia(prepared.text)) {
        btnDocx.disabled = true;
        copyStatus.textContent = '正在嵌入高清图表到 Word…';
        docxApi.buildAsync(prepared.text).then(function(blob) {
          if (!blob || blob.size === 0) { copyStatus.textContent = 'Word 生成失败：结果为空，请重试。'; return; }
          saveBlob(blob, filename);
          copyStatus.textContent = '✅ 已生成 Word（图片已嵌入为高清 PNG）。';
        }).catch(function(error) { copyStatus.textContent = 'Word 生成失败：' + (error && error.message || error); })
          .then(function() { btnDocx.disabled = false; });
      } else {
        var blob = docxApi.build(prepared.text);
        saveBlob(blob, filename);
      }
    });
    var btnTex = makeBtn('.tex', 'btn btn-format', function() {
      var prepared = exportPlain(markdown, 'tex');
      var latexApi = window.ChatSavorLatex;
      if (!latexApi || typeof latexApi.build !== 'function') {
        copyStatus.textContent = 'LaTeX 导出模块尚未加载，请重新连接页面。';
        return;
      }
      var tex = latexApi.build(prepared.text, prepared.meta || {});
      saveHistory(markdown, prepared.meta || {});
      downloadBlob(tex, prepared.filename, 'application/x-tex');
    });
    var btnHtml = makeBtn('.html', 'btn btn-format', function() {
      var prepared = exportPlain(markdown, 'html');
      var body = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(prepared.text) : '<pre>' + escapeHtml(prepared.text) + '</pre>';
      downloadBlob(singleFileHtml(body, prepared.meta && prepared.meta.title || 'AI Response'), prepared.filename, 'text/html');
    });
    var btnZip = makeBtn('.zip (离线含图)', 'btn btn-format', function() {
      var pkg = window.ChatSavorAssets;
      if (!pkg || typeof pkg.buildMarkdownZip !== 'function') { copyStatus.textContent = '离线打包模块尚未加载。'; return; }
      if (btnZip.disabled) return;
      btnZip.disabled = true;
      var meta = metaApi();
      var pageMeta = meta ? meta.getPageMeta(null, markdown) : {};
      copyStatus.textContent = '正在打包离线资源…';
      pkg.buildMarkdownZip(markdown, pageMeta, frontmatterEnabled()).then(function(result) {
        if (!result.blob || result.blob.size === 0) { copyStatus.textContent = '打包失败：生成结果为空，请重试。'; return; }
        saveBlob(result.blob, result.filename);
        saveHistory(markdown, pageMeta);
        copyStatus.textContent = '✅ 已打包：' + result.stats.fetched + ' 张图片内联，' +
          (result.stats.failed ? result.stats.failed + ' 张外链失败保留原地址' : '无失败项');
      }).catch(function(error) { copyStatus.textContent = '打包失败：' + (error && error.message || error); })
        .then(function() { btnZip.disabled = false; });
    });

    var btnCopy = makeBtn('复制 Markdown', 'btn btn-primary', function() {
      copyWithFeedback(btnCopy, function() { return window.ChatSavorMarkdown.copy(markdown, false); });
    });
    var btnRich = makeBtn('复制富文本', 'btn btn-secondary', function() {
      copyWithFeedback(btnRich, function() { return window.ChatSavorMarkdown.copy(markdown, true); });
    });
    var btnObsidian = makeBtn('发送到 Obsidian', 'btn btn-secondary btn-obsidian', function() {
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
    var btnVault = makeBtn('保存到本地库', 'btn btn-secondary', function() {
      var pkg = window.ChatSavorAssets;
      if (!pkg) { copyStatus.textContent = '离线资源模块尚未加载。'; return; }
      if (btnVault.disabled) return;
      btnVault.disabled = true;
      var meta = metaApi();
      var pageMeta = meta ? meta.getPageMeta(null, markdown) : {};
      var finalMd = meta ? meta.withFrontmatter(markdown, pageMeta, frontmatterEnabled()) : markdown;
      var vaultDir = savedVaultDir().replace(/^\/+|\/+$/g, '');
      copyStatus.textContent = '正在准备本地库保存…';
      pkg.collectAndFetchAssets(finalMd).then(function(result) {
        var assets = result.assets.map(function(a) {
          var bytes = a.bytes;
          var bin = '';
          for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return { name: a.name, path: a.path, base64: btoa(bin), mimeType: a.mimeType };
        });
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          copyStatus.textContent = '当前环境不支持本地库直写。'; return;
        }
        chrome.runtime.sendMessage({
          type: 'CHATSAVOR_SAVE_TO_VAULT',
          subDir: vaultDir, filename: (meta ? meta.buildFilename(pageMeta, 'md') : 'ai-response.md'),
          markdown: result.markdown, assets: assets,
        }, function(response) {
          if (response && response.ok && response.mode === 'silent') {
            saveHistory(markdown, pageMeta);
            copyStatus.textContent = '✅ 已静默保存到本地库（含 ' + assets.length + ' 张图片）';
          } else if (response && response.ok && response.mode === 'prompt') {
            copyStatus.textContent = '已打开授权页面，请点击确认保存到本地库。';
          } else {
            copyStatus.textContent = '保存失败：' + (response && response.error || '未知错误');
          }
        });
      }).catch(function(error) { copyStatus.textContent = '保存失败：' + (error && error.message || error); })
        .then(function() { btnVault.disabled = false; });
    });

    var cardTheme = document.createElement('select');
    cardTheme.className = 'card-theme-select';
    [['light', '极简白'], ['dark', '深邃夜'], ['paper', '学术暖纸']].forEach(function(pair) {
      var opt = document.createElement('option');
      opt.value = pair[0]; opt.textContent = pair[1];
      cardTheme.appendChild(opt);
    });
    try { cardTheme.value = localStorage.getItem('chatsavor_card_theme') || 'light'; } catch (ignored) {}
    cardTheme.addEventListener('change', function() { try { localStorage.setItem('chatsavor_card_theme', cardTheme.value); } catch (ignored) {} });
    var btnCopyCard = makeBtn('复制长图', 'btn btn-secondary', function() {
      var api = window.ChatSavorCardImage;
      if (!api) { copyStatus.textContent = '长图卡片模块尚未加载。'; return; }
      if (btnCopyCard.disabled) return;
      btnCopyCard.disabled = true;
      var pageMeta = metaApi() ? metaApi().getPageMeta(null, markdown) : {};
      copyStatus.textContent = '正在生成高清长图…';
      api.renderToBlobs(markdown, pageMeta, { theme: cardTheme.value })
        .then(function(result) {
          if (!result.blobs.length || result.blobs[0].size === 0) { copyStatus.textContent = '长图生成失败：渲染结果为空，请重试。'; return; }
          if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && window.ClipboardItem) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blobs[0] })]).then(function() {
              saveHistory(markdown, pageMeta);
              copyStatus.textContent = result.sliced ? '已复制第 1/' + result.count + ' 张高清卡片；完整卡片请点“下载长图”。' : '已复制高清长图到剪贴板。';
            }).catch(function() { copyStatus.textContent = '剪贴板不支持图片，请改用“下载长图”。'; });
          } else copyStatus.textContent = '当前浏览器不支持图片剪贴板，请改用“下载长图”。';
        }).catch(function(error) { copyStatus.textContent = '长图生成失败：' + (error && error.message || error); })
        .then(function() { btnCopyCard.disabled = false; });
    });
    var btnDownloadCard = makeBtn('下载长图', 'btn btn-secondary', function() {
      var api = window.ChatSavorCardImage;
      if (!api) { copyStatus.textContent = '长图卡片模块尚未加载。'; return; }
      if (btnDownloadCard.disabled) return;
      btnDownloadCard.disabled = true;
      var meta = metaApi();
      var pageMeta = meta ? meta.getPageMeta(null, markdown) : {};
      var base = meta ? meta.buildFilename(pageMeta, 'png').replace(/\.png$/, '') : 'ai-response';
      copyStatus.textContent = '正在生成高清长图…';
      api.renderToBlobs(markdown, pageMeta, { theme: cardTheme.value }).then(function(result) {
        if (!result.blobs.length || result.blobs[0].size === 0) { copyStatus.textContent = '长图生成失败：渲染结果为空，请重试。'; return; }
        if (!result.sliced) { saveBlob(result.blobs[0], base + '.png'); saveHistory(markdown, pageMeta); copyStatus.textContent = '已下载高清长图。'; return; }
        var entries = result.blobs.map(function(blob, i) { return { name: 'card_' + String(i + 1).padStart(2, '0') + '.png', data: blob }; });
        var zipApi = window.ChatSavorZip;
        if (zipApi) {
          Promise.all(entries.map(function(e) { return new Promise(function(resolve) {
            var r = new FileReader();
            r.onload = function() { resolve({ name: e.name, data: new Uint8Array(r.result) }); };
            r.readAsArrayBuffer(e.data);
          }); })).then(function(bytesEntries) {
            saveBlob(zipApi.pack(bytesEntries, 'application/zip'), base + '_cards.zip');
            saveHistory(markdown, pageMeta);
            copyStatus.textContent = '已下载 ' + result.count + ' 张高清卡片（ZIP）。';
          });
        } else {
          saveBlob(result.blobs[0], base + '.png');
          saveHistory(markdown, pageMeta);
          copyStatus.textContent = '已下载第 1 张卡片（ZIP 模块不可用）。';
        }
      }).catch(function(error) { copyStatus.textContent = '长图生成失败：' + (error && error.message || error); })
        .then(function() { btnDownloadCard.disabled = false; });
    });

    // Frontmatter toggle → moved into .tabs-controls.
    var fmLabel = document.createElement('label');
    fmLabel.className = 'frontmatter-toggle';
    fmLabel.setAttribute('title', '在 .md / ZIP / 本地库 / Obsidian 导出中包含 YAML 元数据头');
    var fmCheck = document.createElement('input');
    fmCheck.type = 'checkbox';
    fmCheck.checked = frontmatterEnabled();
    fmCheck.addEventListener('change', function() { setFrontmatterEnabled(fmCheck.checked); });
    var fmSlider = document.createElement('span');
    fmSlider.className = 'switch-slider';
    fmSlider.setAttribute('aria-hidden', 'true');
    var fmText = document.createElement('span');
    fmText.textContent = 'Frontmatter';
    fmLabel.appendChild(fmCheck);
    fmLabel.appendChild(fmSlider);
    fmLabel.appendChild(fmText);
    tabsControls.appendChild(fmLabel);

    // ── Two-tier structured footer ──
    var footerTop = document.createElement('div');
    footerTop.className = 'footer-row-top';
    var actionGroup = document.createElement('div');
    actionGroup.className = 'action-group';
    actionGroup.appendChild(btnCopy);
    actionGroup.appendChild(btnRich);
    actionGroup.appendChild(btnObsidian);
    actionGroup.appendChild(btnVault);

    var cardCapsule = document.createElement('div');
    cardCapsule.className = 'card-capsule';
    cardCapsule.appendChild(cardTheme);
    var capsuleSep = document.createElement('span');
    capsuleSep.className = 'capsule-sep';
    capsuleSep.setAttribute('aria-hidden', 'true');
    cardCapsule.appendChild(capsuleSep);
    cardCapsule.appendChild(btnCopyCard);
    cardCapsule.appendChild(btnDownloadCard);

    footerTop.appendChild(actionGroup);
    footerTop.appendChild(cardCapsule);

    var footerBottom = document.createElement('div');
    footerBottom.className = 'footer-row-bottom';
    var dockLabel = document.createElement('span');
    dockLabel.className = 'dock-label';
    dockLabel.setAttribute('aria-hidden', 'true');
    dockLabel.textContent = '导出文档';
    footerBottom.appendChild(dockLabel);
    footerBottom.appendChild(btnMd);
    footerBottom.appendChild(btnPdf);
    footerBottom.appendChild(btnDocx);
    footerBottom.appendChild(btnTex);
    footerBottom.appendChild(btnHtml);
    footerBottom.appendChild(btnZip);

    footer.appendChild(footerTop);
    footer.appendChild(footerBottom);

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
    var escHandler = function(e) {
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'C' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        btnCopy.click();
      }
    };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escHandler);
    activeModalCleanup = closeModal;
    var mountRoot = document.body || document.documentElement;
    if (mountRoot) mountRoot.appendChild(host);
  }

  // ── Helpers ──

  function makeBtn(text, className, onClick, svgMarkup) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    if (svgMarkup) {
      var iconWrap = document.createElement('span');
      iconWrap.className = 'btn-icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = String(svgMarkup).replace(/>\s+</g, '><').trim();
      btn.appendChild(iconWrap);
    }
    var labelWrap = document.createElement('span');
    labelWrap.className = 'btn-label';
    labelWrap.textContent = text;
    btn.appendChild(labelWrap);
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Update only the visible label inside a button, keeping SVG icons intact.
  function setBtnLabel(btn, text) {
    var label = btn.querySelector('.btn-label');
    if (label) label.textContent = text;
    else btn.textContent = text;
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
