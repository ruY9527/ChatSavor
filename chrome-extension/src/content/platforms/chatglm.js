// ChatSavor — ChatGLM/Zhipu platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var USER_SELECTOR = '[data-role="user"], [data-message-author-role="user"], [class*="user-message"], [class*="question-item"], [class*="human"]';
  var RESPONSE_SELECTORS = [
    '.answer-content-wrap .markdown-body',
    '.conversation-item.assistant .markdown-body',
    '.markdown-body',
    '[class*="answer-content"]',
    '[data-role="assistant"]',
  ];
  window.ChatSavorPlatform.create({
    id: 'chatglm',
    matchHost: function (host) { return host === 'chatglm.cn' || host.slice(-11) === '.chatglm.cn'; },
    responseSelectors: RESPONSE_SELECTORS,
    turnSelectors: ['[data-role="assistant"]', '[class*="assistant"]', '[class*="answer-content"]'],
    userSelector: USER_SELECTOR,
    minTextLength: 2,
    isLikelyResponse: function (el) {
      if (el.querySelector(USER_SELECTOR)) return false;
      var nested = el.querySelectorAll('.markdown-body, [class*="answer-content"]').length;
      return nested <= 1;
    },
  });
})();
