// ChatSavor — DeepSeek platform module
// Thinking: uses .ds-thinking-content
// Response: tries known selectors, then falls back to structural detection

(function() {
  'use strict';

  if (location.hostname !== 'chat.deepseek.com') return;

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] DeepSeek module loaded');

  var processed = new WeakSet();
  var STABILITY_MS = 1500;

  var THINKING_SEL = '.ds-thinking-content';

  // Known response selectors (try first for speed)
  var RESPONSE_SELECTORS = [
    '.ds-markdown--block',
    '.ds-markdown',
    '.markdown-body',
  ];

  // ── Structural detection ──
  // Find response blocks by navigating from the thinking container
  function findResponseByStructure() {
    var thinkingEls = document.querySelectorAll(THINKING_SEL);
    if (thinkingEls.length === 0) return [];

    var results = [];
    var seen = new Set();

    thinkingEls.forEach(function(thinkingEl) {
      // Strategy 1: thinking container's parent → find sibling content
      var parent = thinkingEl.parentElement;
      if (!parent) return;

      Array.from(parent.children).forEach(function(child) {
        if (child === thinkingEl) return;
        if (child.classList.contains('ai-saver-host')) return;
        if (seen.has(child)) return;
        if (child.closest && child.closest(THINKING_SEL)) return;
        var txt = (child.textContent || '').trim();
        if (txt.length < 15) return;
        seen.add(child);
        results.push(child);
      });

      // Strategy 2: grandparent → find content blocks that aren't thinking
      var grandparent = parent.parentElement;
      if (!grandparent) return;

      Array.from(grandparent.children).forEach(function(child) {
        if (child === parent) return;
        if (child.classList.contains('ai-saver-host')) return;
        if (seen.has(child)) return;
        if (child.closest && child.closest(THINKING_SEL)) return;
        var txt = (child.textContent || '').trim();
        if (txt.length < 15) return;
        seen.add(child);
        results.push(child);
      });
    });

    return results;
  }

  // ── Main selector discovery ──
  var cachedResponseSelector = null;

  function findResponseElements() {
    // Try cached selector first
    if (cachedResponseSelector) {
      var cached = document.querySelectorAll(cachedResponseSelector);
      var filtered = Array.from(cached).filter(function(el) {
        return !el.closest(THINKING_SEL);
      });
      if (filtered.length > 0) return filtered;
      cachedResponseSelector = null;
    }

    // Try known selectors
    for (var i = 0; i < RESPONSE_SELECTORS.length; i++) {
      try {
        var els = document.querySelectorAll(RESPONSE_SELECTORS[i]);
        var filtered = Array.from(els).filter(function(el) {
          return !el.closest(THINKING_SEL);
        });
        if (filtered.length > 0) {
          cachedResponseSelector = RESPONSE_SELECTORS[i];
          console.log('[ChatSavor] Response selector:', RESPONSE_SELECTORS[i], '(' + filtered.length + ' blocks)');
          return filtered;
        }
      } catch(e) {}
    }

    // Fallback: structural detection
    var structural = findResponseByStructure();
    if (structural.length > 0) {
      console.log('[ChatSavor] Found response blocks via structural detection:', structural.length);
      return structural;
    }

    return [];
  }

  // ── Stability check ──
  function waitForStable(el, callback) {
    if (processed.has(el)) return;
    var lastLen = (el.textContent || '').trim().length;
    if (lastLen === 0) return;

    setTimeout(function check() {
      if (processed.has(el)) return;
      var newLen = (el.textContent || '').trim().length;
      if (newLen === 0) return;
      if (newLen === lastLen) {
        processed.add(el);
        callback(el);
      } else {
        lastLen = newLen;
        setTimeout(check, STABILITY_MS);
      }
    }, STABILITY_MS);
  }

  // ── Inject button ──
  function injectButton(el) {
    if (el.parentElement && el.parentElement.querySelector('.ai-saver-host')) return;
    core.injectButtonAfter(el, function() {
      var result = core.extractMarkdown(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    });
  }

  // ── Scan ──
  function scan() {
    // Thinking sections
    document.querySelectorAll(THINKING_SEL).forEach(function(el) {
      if (!processed.has(el)) waitForStable(el, injectButton);
    });

    // Response blocks
    var responseEls = findResponseElements();
    responseEls.forEach(function(el) {
      if (!processed.has(el)) waitForStable(el, injectButton);
    });
  }

  setTimeout(scan, 1000);
  setInterval(scan, 2000);

})();
