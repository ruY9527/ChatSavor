// ChatSavor — Google AI Studio platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  window.ChatSavorPlatform.create({
    id: 'aistudio',
    matchHost: function (host) { return host === 'aistudio.google.com' || host.slice(-19) === '.aistudio.google.com'; },
    responseSelectors: [
      '[data-role="assistant"] .markdown',
      '[class*="response"] [class*="markdown"]',
      'ms-chat-turn [class*="content"]',
      '[class*="model-response"]',
      '.markdown-body',
      '[data-role="assistant"]',
    ],
    turnSelectors: ['ms-chat-turn', '[class*="model-response"]', '[data-role="assistant"]'],
    userSelector: '[data-role="user"], [class*="user-message"], [class*="human"]',
    minTextLength: 2,
    extractThinking: function (el) {
      var node = el.querySelector('[class*="thought"], [class*="thinking"], [class*="reasoning"]');
      return node ? (node.textContent || '').trim() : '';
    },
    isLikelyResponse: function (el) {
      if (el.querySelector('[data-role="user"], [class*="user-message"]')) return false;
      return el.querySelectorAll('.markdown-body, [class*="model-response"]').length <= 1;
    },
  });
})();
