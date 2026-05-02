// ChatSavor — Doubao platform module

(function() {
  'use strict';

  if (location.hostname !== 'doubao.com' && location.hostname.slice(-11) !== '.doubao.com') return;

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] Doubao module loaded');

  var processed = new WeakSet();
  var STABILITY_MS = 1500;
  var cachedResponseSelector = null;
  var RESPONSE_SELECTORS = [
    '[data-role="assistant"]',
    '[data-testid*="assistant"]',
    '[class*="assistant-message"]',
    '[class*="assistant"] [class*="message-content"]',
    '[class*="assistant"] .markdown-body',
    '[class*="answer"] [class*="message-content"]',
    '[class*="answer"] .markdown-body',
    '[class*="bot"] [class*="message-content"]',
  ];
  var TURN_SELECTORS = [
    '[data-role="assistant"]',
    '[data-testid*="assistant"]',
    '[class*="assistant-message"]',
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="bot"]',
  ];
  var STOP_TOKENS = [
    '停止回答',
    '停止生成',
    '停止输出',
    '停止回复',
    'stop generating',
    'stop response',
    'stop',
  ];

  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function hasInjectedButton(el) {
    return !!(el && el.nextElementSibling && el.nextElementSibling.classList &&
      el.nextElementSibling.classList.contains('ai-saver-host'));
  }

  function hasUsableText(el) {
    return ((el.textContent || '').trim().length >= 15);
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
    return el.closest('[data-role="assistant"]') ||
      el.closest('[data-testid*="assistant"]') ||
      el.closest('[class*="assistant-message"]') ||
      el.closest('[class*="assistant"]') ||
      el.closest('[class*="answer"]') ||
      el.closest('[class*="bot"]') ||
      el;
  }

  function isLikelyAssistantWrapper(el) {
    var signal = [
      el.className || '',
      el.getAttribute('data-role') || '',
      el.getAttribute('data-testid') || ''
    ].join(' ').toLowerCase();

    if (signal.indexOf('user') !== -1) return false;
    if (signal.indexOf('assistant') !== -1) return true;
    if (signal.indexOf('answer') !== -1) return true;
    if (signal.indexOf('bot') !== -1) return true;
    return !!el.querySelector('.markdown-body, [class*="message-content"], [class*="answer-content"]');
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    if (el.closest('form, footer, [class*="composer"], [class*="input-area"]')) return false;
    if (!isLikelyAssistantWrapper(el)) return false;
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
          console.log('[ChatSavor] Doubao selector:', RESPONSE_SELECTORS[i], '(' + matched.length + ' blocks)');
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
