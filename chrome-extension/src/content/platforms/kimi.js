// ChatSavor — Kimi platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  window.ChatSavorPlatform.create({
    id: 'kimi',
    matchHost: function (host) {
      return host === 'kimi.com' || host.slice(-9) === '.kimi.com' ||
        host === 'kimi.moonshot.cn' || host.slice(-17) === '.kimi.moonshot.cn';
    },
    getChatRoot: function () { return document.querySelector('#chat-container') || document.querySelector('.chat-page') || document; },
    responseSelectors: [
      '#chat-container .chat-content-item-assistant',
      '#chat-container .chat-content-item:not(.is-self) .segment-content',
      '#chat-container .chat-content-item:not(.is-self) .text-content',
      '#chat-container .claw-segment:not(.is-self) .segment-content',
      '#chat-container .markdown-body',
      '#chat-container [class*="markdown"]',
      '#chat-container [class*="assistant"] [class*="content"]',
      '#chat-container [class*="assistant"] [class*="message"]',
      '#chat-container [class*="answer"] [class*="content"]',
      '#chat-container [class*="bot"] [class*="content"]',
    ],
    turnSelectors: [
      '#chat-container .chat-content-item-assistant',
      '#chat-container .chat-content-item:not(.is-self)',
      '#chat-container .claw-segment:not(.is-self):not(.segment-user)',
      '#chat-container [data-role="assistant"]',
    ],
    userSelector: '.is-self, .segment-user, .chat-content-item-user, [data-role="user"], [data-testid*="user"]',
    extractThinking: function (el) {
      var scope = el.closest('.chat-content-item-assistant') || el;
      var node = scope.querySelector ? scope.querySelector('[class*="thinking"], [class*="reasoning"], .ds-thinking-content') : null;
      return node ? (node.textContent || '').trim() : '';
    },
    minTextLength: 2,
    excludedSelector: '.ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host, form, footer, nav, aside, textarea, [contenteditable="true"], [role="textbox"], [class*="composer"], [class*="input"]',
  });
})();
