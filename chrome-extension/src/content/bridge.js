// Runs before the converters so the popup can report incomplete script loading.
(function() {
  'use strict';
  // Report the code actually executed in the tab, even after an extension update.
  var SCRIPT_VERSION = '2.0.6';
  if (window.ChatSavorBridge && window.ChatSavorBridge.version === SCRIPT_VERSION) {
    window.ChatSavorBridge.connect();
    window.ChatSavorBridge.removeLegacyLauncher();
    return;
  }
  var previousBridge = window.ChatSavorBridge;
  if (previousBridge && previousBridge.dispose) previousBridge.dispose();
  var adapter = null;
  var errors = [];
  var cleanupObserver = null;
  var listenerInstalled = false;

  function cleanError(error) {
    return String(error && error.message || error).replace(/https?:\/\/[^\s"'<>]+/gi, function(url) {
      try { return new URL(url).origin + '/[redacted]'; } catch (ignored) { return '[redacted URL]'; }
    });
  }

  function recordError(error) {
    var message = cleanError(error);
    if (errors.indexOf(message) === -1) errors.push(message);
    if (errors.length > 5) errors.shift();
  }

  function status() {
    var details = {};
    var responses = [];
    try {
      if (adapter) {
        responses = adapter.getResponses();
        if (adapter.diagnostics) details = adapter.diagnostics();
      }
    } catch (error) { recordError(error); }
    return {
      version: SCRIPT_VERSION,
      host: window.ChatSavorDOM ? window.ChatSavorDOM.host() : location.hostname,
      coreReady: !!window.ChatSavorCore,
      markdownReady: !!window.ChatSavorMarkdown,
      adapter: adapter ? adapter.platform : null,
      responseCount: responses.length,
      buttonCount: window.ChatSavorDOM ? window.ChatSavorDOM.queryAll('.ai-saver-host').length : document.querySelectorAll('.ai-saver-host').length,
      selectionAvailable: !!(window.getSelection() && window.getSelection().toString().trim()),
      counts: {
        assistantRoles: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        assistantTurns: document.querySelectorAll('[data-turn="assistant"]').length,
        conversationTurns: document.querySelectorAll('[data-testid^="conversation-turn-"]').length,
        markdownBlocks: document.querySelectorAll('.markdown, .prose').length,
        transcriptAssistantMessages: (window.ChatSavorDOM ? window.ChatSavorDOM.queryAll('[data-message-role="assistant"]') : document.querySelectorAll('[data-message-role="assistant"]')).length,
        keyedAssistantUnits: (window.ChatSavorDOM ? window.ChatSavorDOM.queryAll('[data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"]') : document.querySelectorAll('[data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"]')).length,
        assistantMarkdownBodies: (window.ChatSavorDOM ? window.ChatSavorDOM.queryAll('[data-assistant-markdown], [data-markdown-text-style="assistant-message"]') : document.querySelectorAll('[data-assistant-markdown], [data-markdown-text-style="assistant-message"]')).length,
        frames: document.querySelectorAll('iframe').length
      },
      details: details,
      structure: window.ChatSavorDOM ? window.ChatSavorDOM.structure() : null,
      errors: errors.slice()
    };
  }

  function selectedContainer() {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.toString().trim()) return null;
    var container = document.createElement('div');
    for (var i = 0; i < selection.rangeCount; i++) container.appendChild(selection.getRangeAt(i).cloneContents());
    return container;
  }

  // ── Multi-select export mode (Shadow DOM isolated, fully disposable) ──
  var selectHost = null;
  var selectShadow = null;
  var selectMarks = [];
  var selectedTurns = [];
  var modifiedPositions = [];

  function clearSelectMode() {
    selectMarks.forEach(function(mark) { if (mark.parentNode) mark.parentNode.removeChild(mark); });
    selectMarks = [];
    selectedTurns = [];
    modifiedPositions.forEach(function(record) { record.el.style.position = record.prevInlinePosition; });
    modifiedPositions = [];
    if (selectHost && selectHost.parentNode) selectHost.parentNode.removeChild(selectHost);
    selectHost = null;
    selectShadow = null;
  }

  function updateSelectCounter() {
    if (!selectShadow) return;
    var count = selectShadow.querySelector('.cs-count');
    if (count) count.textContent = '已选中 ' + selectedTurns.length + ' / ' + selectMarks.length + ' 条';
  }

  function exportSelected() {
    if (!adapter || !selectedTurns.length) return;
    // Always emit in document order, regardless of the order the user clicked the marks.
    var ordered = selectedTurns.slice().sort(function(a, b) {
      return window.ChatSavorDOM ? window.ChatSavorDOM.compare(a.element, b.element) : 0;
    });
    var parts = ordered.map(function(turn) {
      var result = adapter.extractMarkdown ? adapter.extractMarkdown(turn.element) : null;
      var text = result && result.markdown || '';
      return '## ' + (turn.role === 'user' ? '👤 User' : '🤖 Assistant') + '\n\n' + text;
    }).filter(function(part) { return part.split('\n\n').slice(1).join('\n\n').trim(); });
    var markdown = parts.join('\n\n---\n\n');
    if (markdown) window.ChatSavorCore.showPreviewModal(markdown, { mode: 'selection', turnsCount: selectedTurns.length });
    clearSelectMode();
  }

  function toggleSelectMode() {
    if (selectHost) { clearSelectMode(); return; }
    if (!adapter || typeof adapter.getTurns !== 'function') throw new Error('当前页面不支持多选导出。');
    var turns = adapter.getTurns();
    if (!turns.length) throw new Error('暂时没有识别到可选择的消息。');
    selectHost = document.createElement('div');
    selectHost.className = 'ai-saver-select-host';
    selectHost.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483646;pointer-events:auto;';
    selectShadow = selectHost.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      '.bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1f2937;color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:12px}' +
      '.bar button{padding:5px 10px;border:none;border-radius:6px;background:#4b5563;color:#fff;cursor:pointer;font-size:12px}' +
      '.bar button:hover{background:#667eea}' +
      '.count{min-width:110px;text-align:center}';
    selectShadow.appendChild(style);
    var bar = document.createElement('div');
    bar.className = 'bar';
    var count = document.createElement('span');
    count.className = 'cs-count';
    var all = document.createElement('button');
    all.textContent = '全选';
    var aiOnly = document.createElement('button');
    aiOnly.textContent = '仅选 AI 回复';
    var exportBtn = document.createElement('button');
    exportBtn.textContent = '导出选中';
    var cancel = document.createElement('button');
    cancel.textContent = '取消';
    bar.appendChild(count); bar.appendChild(all); bar.appendChild(aiOnly); bar.appendChild(exportBtn); bar.appendChild(cancel);
    selectShadow.appendChild(bar);

    turns.forEach(function(turn) {
      if (turn.element.querySelector(':scope > .ai-saver-select-mark')) return;
      var mark = document.createElement('div');
      mark.className = 'ai-saver-select-mark';
      // Inline styles are required: the mark lives in the HOST document, not the toolbar's shadow root.
      mark.style.cssText = 'position:absolute;top:6px;right:6px;width:20px;height:20px;border:2px solid #667eea;background:#fff;color:#667eea;border-radius:4px;font-size:13px;font-weight:700;line-height:16px;text-align:center;cursor:pointer;z-index:2147483645;box-sizing:border-box;user-select:none;display:flex;align-items:center;justify-content:center;';
      mark.textContent = '';
      mark.setAttribute('role', 'checkbox');
      mark.setAttribute('aria-checked', 'false');
      if (window.getComputedStyle(turn.element).position === 'static') {
        modifiedPositions.push({ el: turn.element, prevInlinePosition: turn.element.style.position });
        turn.element.style.position = 'relative';
      }
      mark.addEventListener('click', function(e) {
        e.stopPropagation(); e.preventDefault();
        var idx = selectedTurns.indexOf(turn);
        var selected = idx === -1;
        if (selected) selectedTurns.push(turn);
        else selectedTurns.splice(idx, 1);
        mark.textContent = selected ? '✓' : '';
        mark.style.background = selected ? '#667eea' : '#fff';
        mark.style.color = selected ? '#fff' : '#667eea';
        mark.setAttribute('aria-checked', selected ? 'true' : 'false');
        updateSelectCounter();
      });
      turn.element.appendChild(mark);
      selectMarks.push(mark);
    });
    function applyMarkState(mark, selected) {
      mark.textContent = selected ? '✓' : '';
      mark.style.background = selected ? '#667eea' : '#fff';
      mark.style.color = selected ? '#fff' : '#667eea';
      mark.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
    all.addEventListener('click', function() {
      selectedTurns = turns.slice();
      selectMarks.forEach(function(mark) { applyMarkState(mark, true); });
      updateSelectCounter();
    });
    aiOnly.addEventListener('click', function() {
      selectedTurns = turns.filter(function(t) { return t.role === 'assistant'; });
      selectMarks.forEach(function(mark, i) { applyMarkState(mark, turns[i].role === 'assistant'); });
      updateSelectCounter();
    });
    exportBtn.addEventListener('click', exportSelected);
    cancel.addEventListener('click', clearSelectMode);
    updateSelectCounter();
    (document.body || document.documentElement).appendChild(selectHost);
  }

  function handle(command) {
    if (command === 'STATUS') return { ok: true, status: status() };
    if (command === 'EXPORT_ALL') {
      if (!adapter || typeof adapter.getTurns !== 'function') throw new Error('当前页面不支持整场对话导出。');
      var turns = adapter.getTurns();
      if (!turns.length) throw new Error('暂时没有识别到可导出的对话轮次。');
      var mdApi = window.ChatSavorMarkdown;
      // Collect citations only from assistant turns, so navigation/user links are excluded.
      var citations = [];
      var citationSeen = new Set();
      if (mdApi && typeof mdApi.collectCitations === 'function') {
        turns.filter(function(turn) { return turn.role === 'assistant'; }).forEach(function(turn) {
          mdApi.collectCitations(turn.element).forEach(function(c) {
            if (citationSeen.has(c.url)) return;
            citationSeen.add(c.url);
            c.index = citations.length + 1;
            citations.push(c);
          });
        });
      }
      var parts = [];
      turns.forEach(function(turn) {
        var result = adapter.extractMarkdown ? adapter.extractMarkdown(turn.element) : null;
        var text = result && result.markdown ? result.markdown.trim() : '';
        if (!text) return; // never write the domain into the exported conversation
        citations.forEach(function(c) {
          var marker = '](' + c.url + ')';
          if (text.indexOf(marker) !== -1) text = text.replace(marker, '](' + c.url + ') [^' + c.index + ']');
        });
        parts.push('## ' + (turn.role === 'user' ? '👤 User' : '🤖 Assistant') + '\n\n' + text);
      });
      var conversation = parts.join('\n\n---\n\n');
      if (citations.length && mdApi && typeof mdApi.footnotes === 'function') conversation += mdApi.footnotes(citations);
      window.ChatSavorCore.showPreviewModal(conversation, { mode: 'conversation', turnsCount: turns.length });
      return { ok: true, converted: true, turnsCount: turns.length, status: status() };
    }
    if (command === 'TOGGLE_SELECT_MODE') {
      toggleSelectMode();
      return { ok: true, selectMode: !!selectHost, status: status() };
    }
    if (command === 'SCAN' || command === 'CONNECT') {
      if (adapter) adapter.scan(command === 'SCAN');
      removeLegacyLauncher();
      return { ok: true, status: status() };
    }
    if (!window.ChatSavorCore || !window.ChatSavorMarkdown) throw new Error('转换脚本没有完整加载，请在扩展弹窗中点击“重新连接页面”。');
    var container = command === 'LATEST' ? null : selectedContainer();
    var fromReply = false;
    if (!container && command === 'SELECTION') throw new Error('请先在网页中选中要转换的回复内容。');
    if (!container && adapter) {
      var replies = adapter.getResponses();
      container = replies[replies.length - 1];
      fromReply = true;
    }
    if (!container) throw new Error('暂时没有识别到回复。请选中回复文字后再点“转换”，也可在扩展弹窗中复制检测结果。');
    var result = fromReply && adapter.extractMarkdown ? adapter.extractMarkdown(container) : window.ChatSavorCore.extractMarkdown(container);
    if (!result || !result.markdown) throw new Error('选中的内容没有可转换的文字。');
    window.ChatSavorCore.showPreviewModal(result.markdown, result.thinking ? { thinking: result.thinking } : undefined);
    return { ok: true, converted: true, status: status() };
  }

  function removeLegacyLauncher() {
    var legacy = document.getElementById('chatsavor-launcher');
    if (legacy) legacy.remove();
  }

  window.ChatSavorBridge = {
    version: SCRIPT_VERSION,
    register: function(value) { adapter = value; },
    status: status,
    handle: handle,
    recordError: recordError,
    removeLegacyLauncher: removeLegacyLauncher,
    connect: connect,
    dispose: function() {
      if (cleanupObserver) cleanupObserver.disconnect();
      clearSelectMode();
      window.removeEventListener('error', onScriptError);
      try { chrome.runtime.onMessage.removeListener(onMessage); } catch (ignored) {}
    }
  };
  function onScriptError(event) {
    if (event.filename && event.filename.indexOf('chrome-extension://') === 0) recordError(event.message);
  }
  function onMessage(message, sender, sendResponse) {
    if (!message || message.type !== 'CHATSAVOR_COMMAND') return;
    try { sendResponse(handle(message.command)); }
    catch (error) {
      recordError(error);
      sendResponse({ ok: false, error: cleanError(error), status: status() });
    }
  }
  function connect() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    try {
      var event = chrome.runtime.onMessage;
      if (event.hasListener ? !event.hasListener(onMessage) : !listenerInstalled) {
        event.addListener(onMessage);
        listenerInstalled = true;
      }
    } catch (error) { listenerInstalled = false; recordError(error); }
  }
  window.addEventListener('error', onScriptError);
  connect();
  removeLegacyLauncher();
  // Remove floating controls left by 2.0.3 timers without adding any page-wide control.
  if (previousBridge && document.documentElement) {
    cleanupObserver = new MutationObserver(removeLegacyLauncher);
    cleanupObserver.observe(document.documentElement, { childList: true });
  }
})();
