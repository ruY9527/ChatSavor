// ChatSavor — Qwen platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var USER_SELECTOR = '[data-role="user"], [data-message-author-role="user"], [class*="user-message"], [class*="question-item"], [class*="human"]';
  window.ChatSavorPlatform.create({
    id: 'qwen',
    matchHost: function (host) { return host === 'qwen.ai' || host.slice(-8) === '.qwen.ai'; },
    responseSelectors: [
      '[data-role="assistant"] .markdown-prose',
      '.response-message-content',
      '.markdown-body',
      '[class*="assistant-message"]',
      '[data-role="assistant"]',
    ],
    turnSelectors: ['[data-role="assistant"]', '[class*="assistant-message"]', '.response-message-content'],
    userSelector: USER_SELECTOR,
    minTextLength: 2,
    isLikelyResponse: function (el) {
      if (el.querySelector(USER_SELECTOR)) return false;
      var nested = el.querySelectorAll('.markdown-prose, .markdown-body, .response-message-content').length;
      return nested <= 1;
    },
  });
})();
