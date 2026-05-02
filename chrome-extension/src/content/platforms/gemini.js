// ChatSavor — Gemini platform module

(function() {
  'use strict';

  if (location.hostname !== 'gemini.google.com') return;

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] Gemini module loaded');

  var processed = new WeakSet();
  var STABILITY_MS = 1500;
  var cachedResponseSelector = null;
  var RESPONSE_SELECTORS = [
    'model-response',
    '.chat-history model-response',
    'infinite-scroller model-response',
    'model-response message-content',
    'model-response .response-container-content',
    'model-response .model-response-text',
  ];
  var STOP_TOKENS = [
    'stop response',
    'stop generating',
    '停止生成',
    '停止输出',
    '停止回答',
    '停止回应',
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
    return el.closest('model-response') || el;
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    if (el.closest('user-query, .query-content, form, footer')) return false;
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
    return normalizeCandidates(document.querySelectorAll('model-response'));
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
          console.log('[ChatSavor] Gemini selector:', RESPONSE_SELECTORS[i], '(' + matched.length + ' blocks)');
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
