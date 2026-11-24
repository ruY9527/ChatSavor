// ChatSavor — Perplexity platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  window.ChatSavorPlatform.create({
    id: 'perplexity',
    matchHost: function (host) { return host === 'perplexity.ai' || host.slice(-13) === '.perplexity.ai'; },
    responseSelectors: [
      '[class*="answer"] [class*="markdown"]',
      '[class*="answer"] .prose',
      '[class*="answer"] [class*="response"]',
      '[class*="Answer"]',
      '.markdown-body',
      '[data-role="assistant"]',
    ],
    turnSelectors: ['[class*="answer"]', '[class*="Answer"]', '[data-role="assistant"]'],
    userSelector: '[data-role="user"], [data-message-author-role="user"], [class*="user-message"], [class*="question"]',
    minTextLength: 2,
    isLikelyResponse: function (el) {
      if (el.querySelector('.ai-saver-host')) return false;
      // Keep source citation links inside the exported answer.
      return el.querySelectorAll('a[href^="http"]').length <= 20;
    },
  });
})();
