// ChatSavor — Claude platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var USER_SELECTOR = '[data-role="user"], [data-message-author-role="user"], [class*="user-message"], [class*="human"]';
  window.ChatSavorPlatform.create({
    id: 'claude',
    matchHost: function (host) { return host === 'claude.ai' || host.slice(-8) === '.claude.ai'; },
    responseSelectors: [
      '.font-claude-message',
      '[data-is-streaming] .font-claude-message',
      '[class*="assistant"] .font-claude-message',
      '[class*="message-content"]',
      '[data-role="assistant"]',
    ],
    turnSelectors: ['.font-claude-message', '[data-role="assistant"]', '[class*="assistant"]'],
    userSelector: USER_SELECTOR,
    streamingSelector: '[data-is-streaming="true"]',
    minTextLength: 2,
    extractReply: function (el, ctx) {
      // Always keep Claude's main prose answer. An Artifact card is supplementary:
      // only fall back to it when the message element itself has no readable body.
      var ownText = ctx.getText(el);
      if (!ownText || ownText.length < 2) {
        var artifactBody = el.querySelector('[class*="artifact"] [class*="content"]');
        if (artifactBody && ctx.getText(artifactBody).length >= 2) {
          return ctx.core.extractMarkdown(artifactBody);
        }
      }
      return ctx.core.extractMarkdown(el);
    },
    isLikelyResponse: function (el) {
      if (el.querySelector(USER_SELECTOR)) return false;
      return el.querySelectorAll('.font-claude-message').length <= 1;
    },
  });
})();
