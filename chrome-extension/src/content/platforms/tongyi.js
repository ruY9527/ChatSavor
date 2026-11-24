// ChatSavor — Tongyi platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var USER_SELECTOR = '[data-role="user"], [data-message-author-role="user"], [class*="user-message"], [class*="question-item"], [class*="human"]';
  window.ChatSavorPlatform.create({
    id: 'tongyi',
    matchHost: function (host) { return host === 'tongyi.aliyun.com' || host.slice(-18) === '.tongyi.aliyun.com'; },
    responseSelectors: [
      '[class*="answerItem"] [class*="markdown"]',
      '[class*="assistant"] .markdown-body',
      '.tongyi-markdown',
      '.markdown-body',
      '[data-role="assistant"]',
    ],
    turnSelectors: ['[data-role="assistant"]', '[class*="answerItem"]', '[class*="assistant"]'],
    userSelector: USER_SELECTOR,
    minTextLength: 2,
    isLikelyResponse: function (el) {
      if (el.querySelector(USER_SELECTOR)) return false;
      var nested = el.querySelectorAll('.markdown-body, [class*="answerItem"]').length;
      return nested <= 1;
    },
  });
})();
