// ChatSavor — Kimi platform module

(function() {
  'use strict';

  function isKimiHost() {
    var host = location.hostname;
    return host === 'kimi.com' ||
      host.slice(-9) === '.kimi.com' ||
      host === 'kimi.moonshot.cn' ||
      host.slice(-17) === '.kimi.moonshot.cn';
  }

  if (!isKimiHost()) return;

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] Kimi module loaded');

  var processed = new WeakSet();
  var STABILITY_MS = 1500;
  var MIN_TEXT_LENGTH = 2;
  var cachedResponseSelector = null;
  var RESPONSE_SELECTORS = [
    '#chat-container .chat-content-item-assistant',
    '#chat-container .chat-content-item:not(.is-self) .segment-content',
    '#chat-container .chat-content-item:not(.is-self) .text-content',
    '#chat-container .claw-segment:not(.is-self) .segment-content',
    '#chat-container .markdown-body',
    '#chat-container [class*="markdown"]',
    '#chat-container [class*="assistant"] [class*="content"]',
    '#chat-container [class*="assistant"] [class*="message"]',
    '#chat-container [class*="answer"] [class*="content"]',
    '#chat-container [class*="bot"] [class*="content"]',
  ];
  var TURN_SELECTORS = [
    '#chat-container .chat-content-item-assistant',
    '#chat-container .chat-content-item:not(.is-self)',
    '#chat-container .claw-segment:not(.is-self):not(.segment-user)',
    '#chat-container [data-role="assistant"]',
    '#chat-container [data-testid*="assistant"]',
    '#chat-container [class*="assistant"]',
    '#chat-container [class*="answer"]',
    '#chat-container [class*="bot"]',
  ];
  var STOP_TOKENS = [
    '停止生成',
    '停止回答',
    '停止输出',
    'stop generating',
    'stop response',
  ];

  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function hasInjectedButton(el) {
    if (!el) return false;
    if (el.nextElementSibling && el.nextElementSibling.classList &&
      el.nextElementSibling.classList.contains('ai-saver-host')) return true;
    return !!(el.parentElement && el.parentElement.querySelector(':scope > .ai-saver-host'));
  }

  function hasUsableText(el) {
    return ((el.textContent || '').trim().length >= MIN_TEXT_LENGTH);
  }

  function hasUserSignal(el) {
    var chatRoot = getChatRoot();
    var node = el;
    while (node && node !== chatRoot && node !== document.body && node.nodeType === 1) {
      var signal = [
        node.className || '',
        node.getAttribute('data-role') || '',
        node.getAttribute('data-testid') || '',
        node.getAttribute('aria-label') || ''
      ].join(' ').toLowerCase();
      if (signal.indexOf('user') !== -1) return true;
      if (signal.indexOf('human') !== -1) return true;
      if (signal.indexOf('self') !== -1) return true;
      if (signal.indexOf('question') !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function getChatRoot() {
    return document.querySelector('#chat-container') || document.querySelector('.chat-page') || document;
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
    var controls = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (control.offsetParent === null) continue;
      if (control.closest('.ai-saver-host, .ai-saver-modal-host')) continue;
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
    return el.closest('#chat-container .chat-content-item-assistant') ||
      el.closest('#chat-container .chat-content-item:not(.is-self)') ||
      el.closest('#chat-container .claw-segment:not(.is-self):not(.segment-user)') ||
      el.closest('#chat-container [data-role="assistant"]') ||
      el.closest('#chat-container [data-testid*="assistant"]') ||
      el.closest('#chat-container [class*="assistant"]') ||
      el.closest('#chat-container [class*="answer"]') ||
      el.closest('#chat-container [class*="bot"]') ||
      el;
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    var chatRoot = getChatRoot();
    if (chatRoot !== document && !chatRoot.contains(el)) return false;
    if (el.closest('form, footer, textarea, [contenteditable="true"], [class*="composer"], [class*="input"], [class*="message-list-container"]')) return false;
    if (hasUserSignal(el)) return false;
    if (!hasUsableText(el)) return false;
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

  function normalizeCandidates(nodes) {
    var result = [];
    for (var i = 0; i < nodes.length; i++) {
      var wrapper = resolveResponseWrapper(nodes[i]);
      if (wrapper && isLikelyResponse(wrapper)) result.push(wrapper);
    }
    return deduplicate(result);
  }

  function findResponseByStructure() {
    var candidates = [];
    for (var i = 0; i < TURN_SELECTORS.length; i++) {
      try {
        var nodes = document.querySelectorAll(TURN_SELECTORS[i]);
        for (var j = 0; j < nodes.length; j++) candidates.push(nodes[j]);
      } catch (e) {}
    }
    return normalizeCandidates(candidates);
  }

  function findResponseElements() {
    if (cachedResponseSelector) {
      var cached = normalizeCandidates(document.querySelectorAll(cachedResponseSelector));
      if (cached.length > 0) return cached;
      cachedResponseSelector = null;
    }

    for (var i = 0; i < RESPONSE_SELECTORS.length; i++) {
      try {
        var matched = normalizeCandidates(document.querySelectorAll(RESPONSE_SELECTORS[i]));
        if (matched.length > 0) {
          cachedResponseSelector = RESPONSE_SELECTORS[i];
          console.log('[ChatSavor] Kimi selector:', RESPONSE_SELECTORS[i], '(' + matched.length + ' blocks)');
          return matched;
        }
      } catch (e) {}
    }

    return findResponseByStructure();
  }

  function waitForStable(el, callback) {
    if (processed.has(el) || hasInjectedButton(el)) {
      processed.add(el);
      return;
    }

    var lastLen = (el.textContent || '').trim().length;
    if (lastLen === 0) return;

    setTimeout(function check() {
      if (processed.has(el) || hasInjectedButton(el)) {
        processed.add(el);
        return;
      }

      if (hasVisibleStopButton()) {
        setTimeout(check, STABILITY_MS);
        return;
      }

      var newLen = (el.textContent || '').trim().length;
      if (newLen === 0) return;

      if (newLen === lastLen) {
        var handled = callback(el);
        if (handled !== false) {
          processed.add(el);
        } else {
          setTimeout(check, STABILITY_MS);
        }
      } else {
        lastLen = newLen;
        setTimeout(check, STABILITY_MS);
      }
    }, STABILITY_MS);
  }

  function injectButton(el) {
    if (!el || !el.parentElement) return false;
    if (hasInjectedButton(el)) return true;
    return core.injectButtonAfter(el, function() {
      var result = core.extractMarkdown(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    });
  }

  function scan() {
    var responseEls = findResponseElements();
    responseEls.forEach(function(el) {
      if (!processed.has(el)) waitForStable(el, injectButton);
    });
  }

  setTimeout(scan, 1000);
  setInterval(scan, 2000);
})();
