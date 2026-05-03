// ChatSavor — Tencent Yuanbao platform module

(function() {
  'use strict';

  function isYuanbaoHost() {
    return location.hostname === 'yuanbao.tencent.com' ||
      location.hostname.slice(-20) === '.yuanbao.tencent.com';
  }

  if (!isYuanbaoHost()) return;

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] Yuanbao module loaded');

  var processed = new WeakSet();
  var STABILITY_MS = 1500;
  var MIN_TEXT_LENGTH = 2;
  var FALLBACK_TEXT_LENGTH = 8;
  var cachedResponseSelector = null;
  var scanTimer = null;
  var floatingHost = null;
  var RESPONSE_SELECTORS = [
    '.agent-chat__list__item--ai .agent-chat__speech-text--box .hyc-content-md.hyc-content-md-done',
    '.agent-chat__list__item--ai .agent-chat__conv--ai__speech_show .hyc-content-md.hyc-content-md-done',
    '.agent-chat__conv--ai .agent-chat__bubble__content',
    '.agent-chat__conv--ai .hyc-common-markdown',
    '.agent-chat__conv--ai .hyc-component-text',
    '.agent-chat__conv--ai [class*="yb_text_markdown"]',
    '.agent-chat__conv--ai [class*="markdown"]',
    '.agent-chat__conv--ai [class*="hyc"]',
    '[class*="agent-chat__conv--ai"] [class*="bubble__content"]',
    '[class*="agent-chat__conv--ai"] [class*="markdown"]',
    '[class*="agent-chat__conv--ai"] [class*="hyc-component-text"]',
    '[class*="conv--ai"] [class*="bubble__content"]',
    '[class*="conv--ai"] [class*="markdown"]',
    '.yb-layout__content .hyc-common-markdown',
    '.yb-layout__content .hyc-component-text',
    '.yb-layout__content [class*="yb_text_markdown"]',
    '.yb-layout__content [class*="markdown"]',
    '.yb-layout__content [class*="hyc-component-text"]',
    '[data-speaker="ai"]',
    '[data-speaker="assistant"]',
    '[data-role="assistant"]',
    '.yb-layout__content article',
    '.yb-layout__content [data-testid*="message"]',
    '.yb-layout__content [class*="message"]',
    '.yb-layout__content [class*="speech"]',
    '.yb-layout__content [class*="bubble"]',
  ];
  var TURN_SELECTORS = [
    '.agent-chat__conv--ai',
    '[class*="agent-chat__conv--ai"]',
    '[class*="chat__conv--ai"]',
    '[class*="conv--ai"]',
    '[data-speaker="ai"]',
    '[data-speaker="assistant"]',
    '[data-role="assistant"]',
    '[data-testid*="assistant"]',
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="bot"]',
  ];
  var STOP_TOKENS = [
    '停止生成',
    '停止回答',
    '停止输出',
    '取消生成',
    'stop generating',
    'stop response',
  ];

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getChatRoot() {
    return document.querySelector('.agent-dialogue__content--common__content') ||
      document.querySelector('.agent-layout__content') ||
      document.querySelector('.yb-layout__content') ||
      document.querySelector('#app') ||
      document;
  }

  function hasInjectedButton(el) {
    if (!el) return false;
    var turn = resolveResponseTurn(el);
    if (turn && turn.querySelector && turn.querySelector('.ai-saver-yuanbao-toolbar-btn')) return true;
    if (el.nextElementSibling && el.nextElementSibling.classList &&
      el.nextElementSibling.classList.contains('ai-saver-host')) return true;
    return !!(el.parentElement && el.parentElement.querySelector(':scope > .ai-saver-host'));
  }

  function hasUsableText(el) {
    return ((el.textContent || '').trim().length >= MIN_TEXT_LENGTH);
  }

  function hasUserSignal(el) {
    var chatRoot = getChatRoot();
    var node = el;
    while (node && node !== chatRoot && node !== document.body && node.nodeType === 1) {
      var signal = [
        node.className || '',
        node.getAttribute('data-role') || '',
        node.getAttribute('data-testid') || '',
        node.getAttribute('aria-label') || ''
      ].join(' ').toLowerCase();
      if (signal.indexOf('agent-chat__conv--human') !== -1) return true;
      if (signal.indexOf('chat__conv--human') !== -1) return true;
      if (signal.indexOf('conv--human') !== -1) return true;
      if (signal.indexOf('user') !== -1) return true;
      if (signal.indexOf('human') !== -1) return true;
      if (signal.indexOf('self') !== -1) return true;
      if (signal.indexOf('question') !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  function matchesStopToken(value) {
    var normalized = (value || '').trim().toLowerCase();
    if (!normalized) return false;
    for (var i = 0; i < STOP_TOKENS.length; i++) {
      if (normalized.indexOf(STOP_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  function hasVisibleStopButton() {
    var controls = document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!isVisible(control)) continue;
      if (control.closest('.ai-saver-host, .ai-saver-modal-host')) continue;
      var text = [
        control.textContent || '',
        control.getAttribute('aria-label') || '',
        control.getAttribute('title') || ''
      ].join(' ');
      if (matchesStopToken(text)) return true;
    }
    return false;
  }

  function isExcludedContainer(el) {
    if (!el || !el.closest) return true;
    return !!el.closest([
      '.ai-saver-host',
      '.ai-saver-modal-host',
      'form',
      'footer',
      'nav',
      'aside',
      'textarea',
      'input',
      'select',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '[class*="composer"]',
      '[class*="input"]',
      '[class*="skeleton"]',
      '[class*="nav"]',
      '[class*="landing"]',
      '[class*="welcome"]',
      '[class*="recommend"]',
      '[class*="hot-search"]',
      '[class*="search_bar"]',
      '[class*="toast"]',
      '[data-sonner-toast]',
    ].join(','));
  }

  function resolveResponseContent(el) {
    return el.closest('.agent-chat__list__item--ai .agent-chat__speech-text--box .hyc-content-md.hyc-content-md-done') ||
      el.closest('.agent-chat__list__item--ai .agent-chat__conv--ai__speech_show .hyc-content-md.hyc-content-md-done') ||
      el.closest('.agent-chat__conv--ai .agent-chat__bubble__content') ||
      el.closest('[class*="agent-chat__conv--ai"] [class*="bubble__content"]') ||
      el.closest('[class*="conv--ai"] [class*="bubble__content"]') ||
      (el.querySelector && (
        findMainAnswerContent(el) ||
        el.querySelector('.agent-chat__bubble__content') ||
        el.querySelector('[class*="bubble__content"]') ||
        el.querySelector('.hyc-common-markdown') ||
        el.querySelector('.hyc-component-text') ||
        el.querySelector('[class*="yb_text_markdown"]') ||
        el.querySelector('[class*="markdown"]') ||
        el.querySelector('[class*="hyc-component-text"]')
      )) ||
      el;
  }

  function resolveResponseTurn(el) {
    return el.closest('.agent-chat__list__item--ai') ||
      el.closest('[data-conv-speaker="ai"]') ||
      el.closest('.agent-chat__conv--ai') ||
      el.closest('[class*="agent-chat__conv--ai"]') ||
      el.closest('[class*="chat__conv--ai"]') ||
      el.closest('[class*="conv--ai"]') ||
      el.closest('[data-speaker="ai"]') ||
      el.closest('[data-speaker="assistant"]') ||
      el.closest('[data-role="assistant"]') ||
      el;
  }

  function resolveFallbackWrapper(el) {
    return el.closest('.agent-chat__list__item--ai') ||
      el.closest('[data-conv-speaker="ai"]') ||
      el.closest('.agent-chat__conv--ai') ||
      el.closest('[class*="agent-chat__conv--ai"]') ||
      el.closest('[class*="chat__conv--ai"]') ||
      el.closest('[class*="conv--ai"]') ||
      el.closest('[data-speaker="ai"]') ||
      el.closest('[data-speaker="assistant"]') ||
      el.closest('[data-role="assistant"]') ||
      el.closest('article') ||
      el.closest('[data-testid*="message"]') ||
      el.closest('[class*="message"]') ||
      el.closest('[class*="speech"]') ||
      el.closest('[class*="bubble"]') ||
      el.closest('[class*="markdown"]') ||
      el.closest('[class*="hyc-component-text"]') ||
      el.closest('[class*="yb_text_markdown"]') ||
      el;
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    var chatRoot = getChatRoot();
    if (chatRoot !== document && !chatRoot.contains(el)) return false;
    if (el.closest('.agent-chat__list__item--human, [data-conv-speaker="human"], .agent-chat__conv--human, [class*="chat__conv--human"], [class*="conv--human"], [data-speaker="human"], [data-speaker="user"]')) return false;
    if (isExcludedContainer(el)) return false;
    if (hasUserSignal(el)) return false;
    if (!hasUsableText(el)) return false;
    return true;
  }

  function deduplicate(list) {
    var seen = new Set();
    var result = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen.has(list[i])) {
        seen.add(list[i]);
        result.push(list[i]);
      }
    }
    return result;
  }

  function normalizeCandidates(nodes) {
    var result = [];
    for (var i = 0; i < nodes.length; i++) {
      var content = resolveResponseContent(nodes[i]);
      if (content && isLikelyResponse(content)) result.push(content);
    }
    return deduplicate(result);
  }

  function findResponseByYuanbaoItems() {
    var items = document.querySelectorAll('.agent-chat__list__item--ai, [data-conv-speaker="ai"]');
    var result = [];
    for (var i = 0; i < items.length; i++) {
      var content = findMainAnswerContent(items[i]);
      if (content && isLikelyResponse(content)) result.push(content);
    }
    return deduplicate(result);
  }

  function findMainAnswerContent(scope) {
    if (!scope || !scope.querySelectorAll) return null;
    var contents = Array.from(scope.querySelectorAll('.agent-chat__speech-text--box .hyc-content-md.hyc-content-md-done, .agent-chat__conv--ai__speech_show .hyc-content-md.hyc-content-md-done'));
    var normal = contents.filter(function(el) {
      return !el.closest('.hyc-component-deepsearch-cot__think') &&
        !el.querySelector('.hyc-common-markdown-style-cot');
    });
    if (normal.length > 0) return normal[normal.length - 1];

    var markdown = Array.from(scope.querySelectorAll('.hyc-common-markdown:not(.hyc-common-markdown-style-cot)')).filter(function(el) {
      return !el.closest('.hyc-component-deepsearch-cot__think');
    });
    if (markdown.length > 0) return markdown[markdown.length - 1].closest('.hyc-content-md') || markdown[markdown.length - 1];

    return null;
  }

  function findResponseByStructure() {
    var candidates = [];
    for (var i = 0; i < TURN_SELECTORS.length; i++) {
      try {
        var nodes = document.querySelectorAll(TURN_SELECTORS[i]);
        for (var j = 0; j < nodes.length; j++) candidates.push(nodes[j]);
      } catch (e) {}
    }
    return normalizeCandidates(candidates);
  }

  function hasBlockContent(el) {
    if (!el || !el.querySelector) return false;
    if (el.querySelector('p, li, pre, code, table, blockquote, h1, h2, h3, h4, h5, h6')) return true;
    return (el.textContent || '').trim().length >= FALLBACK_TEXT_LENGTH;
  }

  function findResponseByTextBlocks() {
    var root = getChatRoot();
    if (!root || root === document) root = document.body || document;
    var selector = [
      'article',
      '[data-testid*="message"]',
      '[class*="message"]',
      '[class*="speech"]',
      '[class*="bubble"]',
      '[class*="markdown"]',
      '[class*="hyc"]',
      '[class*="content"]',
      'p',
      'li',
      'pre',
      'table',
      'blockquote',
    ].join(',');
    var nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll(selector));
    } catch (e) {
      return [];
    }

    var candidates = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!isVisible(node)) continue;
      if (isExcludedContainer(node)) continue;
      if (hasUserSignal(node)) continue;
      if (!hasBlockContent(node)) continue;
      var text = (node.textContent || '').trim();
      if (text.length < FALLBACK_TEXT_LENGTH) continue;
      var wrapper = resolveFallbackWrapper(node);
      var content = resolveResponseContent(wrapper);
      if (content && isLikelyFallbackResponse(content)) candidates.push(content);
    }

    return preferOuterBlocks(deduplicate(candidates));
  }

  function isLikelyFallbackResponse(el) {
    if (!el || !isVisible(el)) return false;
    var chatRoot = getChatRoot();
    if (chatRoot !== document && !chatRoot.contains(el)) return false;
    if (isExcludedContainer(el)) return false;
    if (el.closest('.agent-chat__list__item--human, [data-conv-speaker="human"], .agent-chat__conv--human, [class*="chat__conv--human"], [class*="conv--human"], [data-speaker="human"], [data-speaker="user"]')) return false;
    var text = (el.textContent || '').trim();
    return text.length >= FALLBACK_TEXT_LENGTH;
  }

  function preferOuterBlocks(list) {
    var result = [];
    for (var i = 0; i < list.length; i++) {
      var current = list[i];
      var hasBetterNestedBlock = false;
      for (var j = 0; j < list.length; j++) {
        if (i !== j && current.contains && current.contains(list[j]) && !isMessageLike(current)) {
          hasBetterNestedBlock = true;
          break;
        }
      }
      if (!hasBetterNestedBlock) result.push(current);
    }
    return result;
  }

  function isMessageLike(el) {
    var signal = [
      el.className || '',
      el.getAttribute && (el.getAttribute('data-role') || ''),
      el.getAttribute && (el.getAttribute('data-speaker') || ''),
      el.getAttribute && (el.getAttribute('data-testid') || '')
    ].join(' ').toLowerCase();
    return signal.indexOf('conv--ai') !== -1 ||
      signal.indexOf('assistant') !== -1 ||
      signal.indexOf('speaker="ai"') !== -1 ||
      signal.indexOf('message') !== -1 ||
      signal.indexOf('speech') !== -1 ||
      signal.indexOf('bubble') !== -1 ||
      el.tagName === 'ARTICLE';
  }

  function findResponseElements() {
    var yuanbaoItems = findResponseByYuanbaoItems();
    if (yuanbaoItems.length > 0) return yuanbaoItems;

    if (cachedResponseSelector) {
      var cached = normalizeCandidates(document.querySelectorAll(cachedResponseSelector));
      if (cached.length > 0) return cached;
      cachedResponseSelector = null;
    }

    for (var i = 0; i < RESPONSE_SELECTORS.length; i++) {
      try {
        var matched = normalizeCandidates(document.querySelectorAll(RESPONSE_SELECTORS[i]));
        if (matched.length > 0) {
          cachedResponseSelector = RESPONSE_SELECTORS[i];
          console.log('[ChatSavor] Yuanbao selector:', RESPONSE_SELECTORS[i], '(' + matched.length + ' blocks)');
          return matched;
        }
      } catch (e) {}
    }

    var structural = findResponseByStructure();
    if (structural.length > 0) return structural;

    return findResponseByTextBlocks();
  }

  function waitForStable(el, callback) {
    if (processed.has(el) || hasInjectedButton(el)) {
      processed.add(el);
      return;
    }

    var lastLen = (el.textContent || '').trim().length;
    if (lastLen === 0) return;

    setTimeout(function check() {
      if (processed.has(el) || hasInjectedButton(el)) {
        processed.add(el);
        return;
      }

      if (hasVisibleStopButton()) {
        setTimeout(check, STABILITY_MS);
        return;
      }

      var newLen = (el.textContent || '').trim().length;
      if (newLen === 0) return;

      if (newLen === lastLen) {
        var handled = callback(el);
        if (handled !== false) {
          processed.add(el);
        } else {
          setTimeout(check, STABILITY_MS);
        }
      } else {
        lastLen = newLen;
        setTimeout(check, STABILITY_MS);
      }
    }, STABILITY_MS);
  }

  function injectButton(el) {
    if (!el) return false;
    var target = resolveResponseTurn(el);
    if (!target || !target.parentElement) return false;
    if (hasInjectedButton(target)) return true;
    var toolbar = target.querySelector('.agent-chat__conv--ai__toolbar .agent-chat__toolbar__right') ||
      target.querySelector('.agent-chat__toolbar .agent-chat__toolbar__right') ||
      target.querySelector('.agent-chat__conv--ai__toolbar') ||
      target.querySelector('.agent-chat__toolbar');
    if (toolbar) {
      toolbar.appendChild(createToolbarButton(el));
      return true;
    }
    return core.injectButtonAfter(target, function() {
      var result = core.extractMarkdown(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    });
  }

  function createToolbarButton(contentEl) {
    var host = document.createElement('div');
    host.className = 'ai-saver-yuanbao-toolbar-btn Toolbar_icon__xGP8b';
    host.setAttribute('title', '转换回复');
    host.style.cssText = 'display:flex;align-items:center;justify-content:center;height:28px;border-radius:6px;cursor:pointer;color:var(--text-text_secondary,rgba(0,0,0,.6));';

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;display:flex;align-items:center;justify-content:center;height:28px;border-radius:6px;cursor:pointer;color:inherit;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif}',
      ':host(:hover){background:var(--widget-btn_hover_2,rgba(0,0,0,.05))}',
      '.btn{display:inline-flex;align-items:center;gap:4px;padding:0 7px;font-size:12px;font-weight:500;line-height:28px;color:currentColor;white-space:nowrap}',
      '.icon{font-size:14px;line-height:1;color:currentColor}',
    ].join('\n');

    var btn = document.createElement('span');
    btn.className = 'btn';
    var icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = '⇄';
    var text = document.createElement('span');
    text.textContent = '转换';
    btn.appendChild(icon);
    btn.appendChild(text);
    shadow.appendChild(style);
    shadow.appendChild(btn);

    host.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var result = core.extractMarkdown(contentEl);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    });
    return host;
  }

  function scan() {
    var responseEls = findResponseElements();
    var injected = false;
    responseEls.forEach(function(el) {
      if (isCompletedYuanbaoAnswer(el) && (!processed.has(el) || !hasInjectedButton(el))) {
        var handled = injectButton(el);
        if (handled !== false) {
          injected = true;
          processed.add(el);
        }
      }
    });
    responseEls.forEach(function(el) {
      if (!processed.has(el)) {
        waitForStable(el, function(target) {
          var handled = injectButton(target);
          if (handled !== false) injected = true;
          return handled;
        });
      }
    });
    if (injected || document.querySelector('.ai-saver-host:not(.ai-saver-yuanbao-floating)')) {
      removeFloatingButton();
    } else {
      ensureFloatingButton(responseEls);
    }
  }

  function isCompletedYuanbaoAnswer(el) {
    return !!(el && el.classList && el.classList.contains('hyc-content-md-done'));
  }

  function getLatestResponseElement(preferred) {
    var list = preferred && preferred.length ? preferred : findResponseElements();
    if (!list.length) return null;
    return list[list.length - 1];
  }

  function ensureFloatingButton(preferred) {
    if (floatingHost) return;
    var latest = getLatestResponseElement(preferred);
    if (!latest) return;

    floatingHost = document.createElement('div');
    floatingHost.className = 'ai-saver-host ai-saver-yuanbao-floating';
    floatingHost.style.cssText = 'position:fixed;right:24px;bottom:96px;z-index:2147483646;pointer-events:auto;';

    var shadow = floatingHost.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif}',
      '.save-btn{display:inline-flex;align-items:center;gap:4px;padding:7px 12px;',
      'background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;',
      'cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 6px 18px rgba(102,126,234,.35);',
      'transition:all .2s;user-select:none;white-space:nowrap}',
      '.save-btn:hover{background:linear-gradient(135deg,#5a6fd6,#6a3f96);box-shadow:0 8px 24px rgba(102,126,234,.45);transform:translateY(-1px)}',
      '.save-btn:active{transform:translateY(0)}',
    ].join('\n');

    var btn = document.createElement('button');
    btn.className = 'save-btn';
    btn.textContent = '转换最新回复';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      var el = getLatestResponseElement();
      if (!el) return;
      var result = core.extractMarkdown(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    document.documentElement.appendChild(floatingHost);
  }

  function removeFloatingButton() {
    if (!floatingHost) return;
    floatingHost.remove();
    floatingHost = null;
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function() {
      scanTimer = null;
      scan();
    }, 300);
  }

  setTimeout(scan, 1000);
  setTimeout(scan, 3000);
  setTimeout(scan, 6000);
  setInterval(scan, 2000);
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
