// ChatSavor — Gemini platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  window.ChatSavorPlatform.create({
    id: 'gemini',
    matchHost: function (host) { return host === 'gemini.google.com'; },
    responseSelectors: [
      'model-response',
      '.chat-history model-response',
      'infinite-scroller model-response',
      'model-response message-content',
      'model-response .response-container-content',
      'model-response .model-response-text',
    ],
    userSelector: 'user-query, .query-content',
    resolveWrapper: function (el) { return el.closest('model-response') || el; },
    minTextLength: 2,
    stopTokens: ['stop response', 'stop generating', '停止生成', '停止输出', '停止回答', '停止回应'],
  });
})();
