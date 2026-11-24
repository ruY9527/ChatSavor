// ChatSavor — Grok platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  window.ChatSavorPlatform.create({
    id: 'grok',
    matchHost: function (host) {
      // Match on domain only. Route activation is handled by isActiveRoute so the
      // adapter is always mounted and can observe history.pushState changes.
      return host === 'grok.com' || host.slice(-9) === '.grok.com' ||
        host === 'x.com' || host.slice(-6) === '.x.com';
    },
    watchRoute: true,
    isActiveRoute: function (loc) {
      var host = window.ChatSavorDOM ? window.ChatSavorDOM.host() : loc.hostname;
      if (host === 'grok.com' || host.slice(-9) === '.grok.com') return true;
      if (host === 'x.com' || host.slice(-6) === '.x.com') return loc.pathname.indexOf('/i/grok') === 0 || loc.pathname.indexOf('/grok') !== -1;
      return false;
    },
    responseSelectors: [
      '.response-content-markdown',
      '.message-bubble .response-content-markdown',
      '.message-bubble.max-w-none',
      '.message-bubble [class*="max-w-none"]',
      'div[class*="max-w-none"]:not([class*="bg-surface-l1"])',
    ],
    turnSelectors: ['.message-bubble', 'article .message-bubble', '[class*="response-content-markdown"]'],
    resolveWrapper: function (el) { return el.closest('.message-bubble') || el.closest('article') || el; },
    userSelector: '[data-role="user"], [data-message-author-role="user"], .bg-surface-l1, [data-testid*="user"]',
    isLikelyResponse: function (el) {
      var signal = [el.className || '', el.getAttribute('data-testid') || '', el.getAttribute('aria-label') || ''].join(' ').toLowerCase();
      return signal.indexOf('bg-surface-l1') === -1 && !el.closest('form, footer, [class*="composer"], [class*="input"]');
    },
    minTextLength: 2,
    stopTokens: ['stop generating', 'stop response', '停止生成', '停止输出', '停止回答'],
  });
})();
