// ChatSavor — DeepSeek platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var THINKING_SEL = '.ds-thinking-content';
  window.ChatSavorPlatform.create({
    id: 'deepseek',
    matchHost: function (host) { return host === 'deepseek.com' || host.slice(-13) === '.deepseek.com'; },
    responseSelectors: ['.ds-markdown--block', '.ds-markdown', '.markdown-body'],
    userSelector: '[data-role="user"], [data-message-author-role="user"], [class*="user-message"]',
    minTextLength: 2,
    isLikelyResponse: function (el) { return !el.closest(THINKING_SEL); },
    extractThinking: function (el) {
      var node = el.parentElement ? el.parentElement.querySelector(THINKING_SEL) : null;
      return node ? (node.textContent || '').trim() : '';
    },
    stopTokens: ['停止生成', '停止回答', '停止输出', 'stop generating', 'stop response'],
    stopSelectors: ['[data-testid="stop-button"]', '[aria-label*="停止生成"]', '[aria-label*="Stop generating"]', '[title*="停止生成"]'],
    findResponses: function (ctx) {
      var w = window;
      var base = ctx.dom || w.ChatSavorDOM;
      var structural = [];
      var thinkingEls = (base ? base.queryAll(THINKING_SEL) : Array.from(document.querySelectorAll(THINKING_SEL)));
      var seen = new Set();
      thinkingEls.forEach(function (thinkingEl) {
        var parent = thinkingEl.parentElement;
        if (!parent) return;
        function collect(scope) {
          Array.from(scope.children).forEach(function (child) {
            if (child === thinkingEl || child === parent || seen.has(child)) return;
            if (child.classList && child.classList.contains('ai-saver-host')) return;
            if (child.closest && child.closest(THINKING_SEL)) return;
            var txt = (base ? base.text(child) : (child.textContent || '')).trim();
            if (txt.length < 2) return;
            seen.add(child);
            structural.push(child);
          });
        }
        collect(parent);
        if (parent.parentElement) collect(parent.parentElement);
      });
      var selectors = ['.ds-markdown--block', '.ds-markdown', '.markdown-body'];
      for (var i = 0; i < selectors.length; i++) {
        var nodes = base ? base.queryAll(selectors[i]) : Array.from(document.querySelectorAll(selectors[i]));
        var normalized = [];
        nodes.forEach(function (el) {
          if (el.closest(THINKING_SEL)) return;
          if (ctx.isVisible(el) && ctx.getText(el).length >= 2) normalized.push(el);
        });
        if (normalized.length) return ctx.removeNested(ctx.deduplicate(normalized));
      }
      return ctx.removeNested(ctx.deduplicate(structural.filter(function (el) { return ctx.isVisible(el); })));
    },
  });
})();
