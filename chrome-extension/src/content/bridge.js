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

  function handle(command) {
    if (command === 'STATUS') return { ok: true, status: status() };
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
    window.ChatSavorCore.showPreviewModal(result.markdown);
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
