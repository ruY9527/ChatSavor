// ChatSavor — ChatGPT platform module

(function() {
  'use strict';

  var dom = window.ChatSavorDOM;
  var platformHost = dom ? dom.host() : location.hostname;
  if (platformHost !== 'chatgpt.com' && platformHost !== 'chat.openai.com') return;

  var version = window.ChatSavorBridge ? window.ChatSavorBridge.version : '2.0.6';
  var previousAdapter = window.ChatSavorChatGPTAdapter;
  if (previousAdapter && previousAdapter.version === version && previousAdapter.core === window.ChatSavorCore) {
    if (window.ChatSavorBridge) window.ChatSavorBridge.register(previousAdapter);
    return;
  }
  if (previousAdapter && previousAdapter.dispose) previousAdapter.dispose();

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] ChatGPT module loaded');

  var responseState = new WeakMap();
  var STABILITY_MS = 1500;
  var scanTimers = [];
  var UNIT_SELECTOR = '[data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"]';
  var MESSAGE_SELECTOR = '[data-message-author-role="assistant"], [data-turn="assistant"], [data-message-role="assistant"]';
  var BODY_SELECTOR = '[data-assistant-markdown], [data-markdown-text-style="assistant-message"]';
  var ASSISTANT_SELECTOR = MESSAGE_SELECTOR + ', ' + UNIT_SELECTOR + ', ' + BODY_SELECTOR + ', h4[data-conversation-role="assistant"], h5[data-conversation-role="assistant"]';
  var TURN_SELECTOR = '[data-testid^="conversation-turn-"], article[data-turn]';
  var USER_SELECTOR = '[data-message-author-role="user"], [data-turn="user"], [data-message-role="user"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"], [data-user-message-bubble]';
  var EXCLUDED_SELECTOR = '[data-testid="composer"], #prompt-textarea, [contenteditable="true"], [role="textbox"], footer, .ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host';
  var STOP_TOKENS = [
    'stop generating',
    'stop response',
    '停止生成',
    '停止输出',
    '停止回答',
  ];

  function isVisible(el) {
    if (!el || !el.isConnected || (dom ? dom.closest(el, '[hidden], [aria-hidden="true"]') : el.closest('[hidden], [aria-hidden="true"]'))) return false;
    var view = el.ownerDocument.defaultView || window;
    var style = view.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (el.getClientRects().length > 0) return true;
    // A display:contents wrapper has no box, but its reply can still be visible.
    if (style.display === 'contents') {
      return Array.from(el.children).some(isVisible);
    }
    return false;
  }

  function hasInjectedButton(el) {
    if (el && el.querySelector(':scope > .ai-saver-host[data-chatsavor-owner="chatgpt"]')) return true;
    return !!(el && el.nextElementSibling && el.nextElementSibling.classList &&
      el.nextElementSibling.classList.contains('ai-saver-host'));
  }

  function matchesStopToken(value) {
    var normalized = (value || '').trim().toLowerCase();
    if (!normalized) return false;
    for (var i = 0; i < STOP_TOKENS.length; i++) {
      if (normalized.indexOf(STOP_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  function hasVisibleStopButton() {
    var controls = dom ? dom.queryAll('button, [role="button"]') : document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!isVisible(control)) continue;
      if (control.closest('.ai-saver-host, .ai-saver-modal-host')) continue;
      if (control.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) return true;
      var text = [
        control.textContent || '',
        control.getAttribute('aria-label') || '',
        control.getAttribute('title') || ''
      ].join(' ');
      if (matchesStopToken(text)) return true;
    }
    return false;
  }

  function resolveResponseWrapper(el) {
    // A data-turn-key wraps both the prompt and answer; only the assistant unit is a reply.
    var unit = el.closest(UNIT_SELECTOR);
    if (unit) return unit;
    var message = el.closest('[data-message-role="assistant"]');
    if (message) return message;
    if (el.matches('h4[data-conversation-role="assistant"], h5[data-conversation-role="assistant"]')) return el.parentElement;
    var turn = el.closest(TURN_SELECTOR);
    if (turn) {
      var messages = turn.querySelectorAll('[data-message-author-role="assistant"]');
      if (messages.length === 1) return messages[0];
      // Keep split response blocks together under a single conversion button.
      return turn;
    }
    return el.closest(ASSISTANT_SELECTOR) || el;
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    if (dom ? dom.closest(el, EXCLUDED_SELECTOR) : el.closest(EXCLUDED_SELECTOR)) return false;
    if ((dom ? dom.closest(el, USER_SELECTOR) : el.closest(USER_SELECTOR)) || el.querySelector(USER_SELECTOR)) return false;
    if (!(dom ? dom.text(el) : el.textContent || '').trim()) return false;
    return true;
  }

  function deduplicate(list) {
    var seen = new Set();
    var result = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen.has(list[i])) {
        seen.add(list[i]);
        result.push(list[i]);
      }
    }
    return result;
  }

  function findResponseElements() {
    var candidates = dom ? dom.queryAll(ASSISTANT_SELECTOR) : Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
    // Some layouts expose a conversation turn and Markdown without an author-role attribute.
    var turns = dom ? dom.queryAll(TURN_SELECTOR) : Array.from(document.querySelectorAll(TURN_SELECTOR));
    turns.forEach(function(turn) {
      if (turn.matches(USER_SELECTOR) || turn.querySelector(USER_SELECTOR)) return;
      if (turn.matches(ASSISTANT_SELECTOR) || (dom ? dom.queryAll(ASSISTANT_SELECTOR + ', .markdown, .prose', turn).length : turn.querySelector(ASSISTANT_SELECTOR + ', .markdown, .prose'))) {
        candidates.push(turn);
      }
    });
    var responses = deduplicate(candidates.map(resolveResponseWrapper)).filter(isLikelyResponse);
    // Nested turn wrappers must not produce duplicate buttons for the same reply.
    return responses.filter(function(el) {
      return !responses.some(function(other) { return other !== el && (dom ? dom.contains(other, el) : other.contains(el)); });
    }).sort(function(a, b) {
      if (dom) return dom.compare(a, b);
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function extractReply(el) {
    var clone = dom ? dom.clone(el) : el.cloneNode(true);
    // The transcript's <li> is page structure, not a bullet in the assistant's answer.
    if (clone.matches('li[data-message-role="assistant"]')) {
      var content = document.createElement('div');
      while (clone.firstChild) content.appendChild(clone.firstChild);
      clone = content;
    }
    clone.querySelectorAll('[data-message-attribution], h4[data-conversation-role], h5[data-conversation-role], [data-assistant-message-actions], [data-message-actions], [data-message-content-controls], [data-assistant-placeholder-slot], [popover]').forEach(function(node) { node.remove(); });
    clone.querySelectorAll('button[data-assistant-sources-payload]').forEach(function(button) {
      var replacement = document.createElement('span');
      var sources;
      try { sources = JSON.parse(button.getAttribute('data-assistant-sources-payload')); } catch (ignored) {}
      if (Array.isArray(sources)) sources.slice(0, 20).forEach(function(source) {
        try {
          var url = new URL(source.url);
          if (!/^https?:$/.test(url.protocol)) return;
          if (replacement.childNodes.length) replacement.appendChild(document.createTextNode(' '));
          var link = document.createElement('a');
          link.href = url.href;
          link.textContent = source.title || source.attribution || button.textContent.trim() || url.hostname;
          replacement.appendChild(link);
        } catch (ignored) {}
      });
      if (!replacement.childNodes.length) replacement.textContent = button.textContent;
      button.replaceWith(replacement);
    });
    return core.extractMarkdown(clone);
  }

  function injectButton(el) {
    if (!el || !el.parentElement) return false;
    if (hasInjectedButton(el)) return true;
    var onClick = function() {
      var result = extractReply(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    };
    // Keep <ol> children valid and put the action inside this message, never after the thread.
    if (el.matches('li[data-message-role="assistant"], ' + UNIT_SELECTOR)) {
      var host = core.createSaveButton(onClick);
      host.setAttribute('data-chatsavor-owner', 'chatgpt');
      el.appendChild(host);
      return true;
    }
    return core.injectButtonAfter(el, onClick);
  }

  function scan(force) {
    var responseEls = findResponseElements();
    var generating = hasVisibleStopButton();
    var now = Date.now();
    responseEls.forEach(function(el, index) {
      if (hasInjectedButton(el)) return;
      if (force === true) { injectButton(el); return; }
      var text = (dom ? dom.text(el) : el.textContent || '').trim();
      var state = responseState.get(el);
      var streaming = dom ? dom.closest(el, '[data-is-streaming="true"]') || dom.queryAll('[data-is-streaming="true"]', el).length : el.closest('[data-is-streaming="true"]') || el.querySelector('[data-is-streaming="true"]');
      if (!state || state.text !== text || streaming || (generating && index === responseEls.length - 1)) {
        responseState.set(el, { text: text, stableSince: now });
        return;
      }
      if (now - state.stableSince >= STABILITY_MS) injectButton(el);
    });
  }

  function safeScan() {
    try { scan(); }
    catch (error) { if (window.ChatSavorBridge) window.ChatSavorBridge.recordError(error); }
  }

  window.ChatSavorChatGPTAdapter = {
    platform: 'chatgpt', version: version, core: core, scan: scan, getResponses: findResponseElements, extractMarkdown: extractReply,
    dispose: function() { scanTimers.forEach(function(id) { clearTimeout(id); clearInterval(id); }); },
    diagnostics: function() {
      var nodes = dom ? dom.queryAll(ASSISTANT_SELECTOR) : Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
      return {
        visibleAssistantNodes: nodes.filter(isVisible).length,
        excludedAssistantNodes: nodes.filter(function(node) { return !!node.closest(EXCLUDED_SELECTOR); }).length,
        stopButtonVisible: hasVisibleStopButton(),
        sampleStructure: Array.from(document.querySelectorAll('main .markdown, main .prose, [data-message-author-role], [data-turn]')).slice(0, 6).map(function(node) {
          var ancestors = [];
          for (var parent = node.parentElement; parent && ancestors.length < 4; parent = parent.parentElement) ancestors.push(parent.tagName.toLowerCase());
          return { tag: node.tagName.toLowerCase(), classes: String(node.className || '').slice(0, 160), authorRole: node.getAttribute('data-message-author-role'), turn: node.getAttribute('data-turn'), ancestorTags: ancestors };
        })
      };
    }
  };
  if (window.ChatSavorBridge) window.ChatSavorBridge.register(window.ChatSavorChatGPTAdapter);
  scanTimers.push(setTimeout(safeScan, 1000));
  scanTimers.push(setInterval(safeScan, 2000));
})();
