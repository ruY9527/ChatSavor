// ChatSavor — Tencent Yuanbao platform module (base adapter)
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var core = window.ChatSavorCore;
  var USER_SELECTOR = '.agent-chat__list__item--human, [data-conv-speaker="human"], .agent-chat__conv--human, [class*="conv--human"], [data-speaker="human"], [data-speaker="user"]';
  var EXCLUDED = '.ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host, form, footer, nav, aside, textarea, input, select, [contenteditable="true"], [role="textbox"], [class*="composer"], [class*="input"], [class*="skeleton"], [class*="toast"], [data-sonner-toast]';

  function getChatRoot() {
    return document.querySelector('.agent-dialogue__content--common__content') ||
      document.querySelector('.agent-layout__content') || document.querySelector('.yb-layout__content') ||
      document.querySelector('#app') || document;
  }
  function findMainAnswerContent(scope) {
    if (!scope || !scope.querySelectorAll) return null;
    var contents = Array.from(scope.querySelectorAll('.agent-chat__speech-text--box .hyc-content-md.hyc-content-md-done, .agent-chat__conv--ai__speech_show .hyc-content-md.hyc-content-md-done'));
    var normal = contents.filter(function (el) { return !el.closest('.hyc-component-deepsearch-cot__think') && !el.querySelector('.hyc-common-markdown-style-cot'); });
    if (normal.length) return normal[normal.length - 1];
    var markdown = Array.from(scope.querySelectorAll('.hyc-common-markdown:not(.hyc-common-markdown-style-cot)')).filter(function (el) { return !el.closest('.hyc-component-deepsearch-cot__think'); });
    if (markdown.length) return markdown[markdown.length - 1].closest('.hyc-content-md') || markdown[markdown.length - 1];
    return null;
  }
  function resolveResponseTurn(el) {
    return el.closest('.agent-chat__list__item--ai') || el.closest('[data-conv-speaker="ai"]') ||
      el.closest('.agent-chat__conv--ai') || el.closest('[class*="agent-chat__conv--ai"]') ||
      el.closest('[class*="conv--ai"]') || el.closest('[data-speaker="ai"]') || el.closest('[data-speaker="assistant"]') ||
      el.closest('[data-role="assistant"]') || el;
  }
  function createToolbarButton(contentEl, onClick) {
    var host = document.createElement('div');
    host.className = 'ai-saver-yuanbao-toolbar-btn Toolbar_icon__xGP8b';
    host.setAttribute('title', '转换回复');
    host.style.cssText = 'display:flex;align-items:center;justify-content:center;height:28px;border-radius:6px;cursor:pointer;color:var(--text-text_secondary,rgba(0,0,0,.6));';
    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = ':host{all:initial;display:flex;align-items:center;justify-content:center;height:28px;border-radius:6px;cursor:pointer;color:inherit}.btn{display:inline-flex;align-items:center;padding:0 7px;font-size:12px;line-height:28px;color:currentColor}';
    var btn = document.createElement('span');
    btn.className = 'btn';
    btn.textContent = '⇄ 转换';
    btn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); onClick(); });
    shadow.appendChild(style); shadow.appendChild(btn);
    return host;
  }

  window.ChatSavorPlatform.create({
    id: 'yuanbao',
    matchHost: function (host) { return host === 'yuanbao.tencent.com' || host.slice(-20) === '.yuanbao.tencent.com'; },
    getChatRoot: function () { return getChatRoot(); },
    responseSelectors: [
      '.agent-chat__list__item--ai .agent-chat__speech-text--box .hyc-content-md.hyc-content-md-done',
      '.agent-chat__conv--ai .agent-chat__bubble__content',
      '.agent-chat__conv--ai .hyc-common-markdown',
      '[class*="conv--ai"] [class*="bubble__content"]',
      '[class*="agent-chat__conv--ai"] [class*="markdown"]',
      '.yb-layout__content .hyc-common-markdown',
      '[data-speaker="ai"]', '[data-role="assistant"]',
    ],
    turnSelectors: ['.agent-chat__conv--ai', '[class*="conv--ai"]', '[data-speaker="ai"]', '[data-role="assistant"]'],
    userSelector: USER_SELECTOR,
    excludedSelector: EXCLUDED,
    minTextLength: 2,
    extractThinking: function (el) {
      var scope = resolveResponseTurn(el);
      var node = scope && scope.querySelector ? scope.querySelector('.hyc-component-deepsearch-cot__think, .hyc-common-markdown-style-cot') : null;
      return node ? (node.textContent || '').trim() : '';
    },
    isLikelyResponse: function (el, ctx) {
      // B-05: correct speaker check on the item itself.
      var item = el.closest('.agent-chat__list__item--ai') || el.closest('[data-conv-speaker="ai"]') || el;
      if (el.getAttribute && el.getAttribute('data-speaker') === 'ai') return true;
      if (el.getAttribute && el.getAttribute('data-conv-speaker') === 'ai') return true;
      return item !== el || el.matches('[data-role="assistant"], [class*="conv--ai"], .yb-layout__content article');
    },
    findResponses: function (ctx) {
      var base = ctx.dom;
      var items = base ? base.queryAll('.agent-chat__list__item--ai, [data-conv-speaker="ai"]') :
        Array.from(document.querySelectorAll('.agent-chat__list__item--ai, [data-conv-speaker="ai"]'));
      var results = [];
      items.forEach(function (item) {
        var content = findMainAnswerContent(item);
        if (content && ctx.isVisible(content) && ctx.getText(content).length >= 2) results.push(content);
      });
      if (results.length) return ctx.removeNested(ctx.deduplicate(results));
      var selectors = [
        '.agent-chat__conv--ai .agent-chat__bubble__content', '.agent-chat__conv--ai .hyc-common-markdown',
        '[class*="conv--ai"] [class*="bubble__content"]', '[data-speaker="ai"]', '[data-role="assistant"]',
      ];
      for (var i = 0; i < selectors.length; i++) {
        var nodes = base ? base.queryAll(selectors[i]) : Array.from(document.querySelectorAll(selectors[i]));
        var matched = nodes.filter(function (el) {
          var isUser = ctx.dom ? ctx.dom.closest(el, USER_SELECTOR) : el.closest(USER_SELECTOR);
          return ctx.isVisible(el) && ctx.getText(el).length >= 2 && !isUser;
        });
        if (matched.length) return ctx.removeNested(ctx.deduplicate(matched));
      }
      return [];
    },
    // B-05: only current turn's toolbar button or next sibling — never parentElement.
    hasButton: function (el) {
      var target = resolveResponseTurn(el);
      if (target && target.querySelector('.ai-saver-yuanbao-toolbar-btn')) return true;
      return !!(el.nextElementSibling && el.nextElementSibling.classList.contains('ai-saver-host'));
    },
    mountButton: function (el, onClick) {
      var target = resolveResponseTurn(el);
      if (!target || !target.parentElement) return false;
      var toolbar = target.querySelector('.agent-chat__conv--ai__toolbar .agent-chat__toolbar__right') ||
        target.querySelector('.agent-chat__toolbar .agent-chat__toolbar__right') ||
        target.querySelector('.agent-chat__conv--ai__toolbar') || target.querySelector('.agent-chat__toolbar');
      if (toolbar) { toolbar.appendChild(createToolbarButton(el, onClick)); return true; }
      return core.injectButtonAfter(target, onClick);
    },
  });
})();
