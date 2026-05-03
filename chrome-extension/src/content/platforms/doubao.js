// ChatSavor — Doubao platform module

(function() {
  'use strict';

  if (location.hostname !== 'doubao.com' && location.hostname.slice(-11) !== '.doubao.com') return;

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] Doubao module loaded');

  var processed = new WeakSet();
  var STABILITY_MS = 1500;
  var MIN_TEXT_LENGTH = 2;
  var cachedResponseSelector = null;
  var RESPONSE_SELECTORS = [
    '[class*="chat-main-messages"] [class*="message-container"] [class*="message-area"]',
    '[class*="chat-main-messages"] [class*="message-container"]',
    '[class*="chat-main-messages"] [class*="message"]',
    '[class*="message-container"] [class*="message-area"]',
    '[class*="message-area"]',
    '[data-role="assistant"]',
    '[data-testid*="assistant"]',
    '[class*="assistant-message"]',
    '[class*="assistant"] [class*="message-content"]',
    '[class*="assistant"] .markdown-body',
    '[class*="answer"] [class*="message-content"]',
    '[class*="answer"] .markdown-body',
    '[class*="bot"] [class*="message-content"]',
  ];
  var TURN_SELECTORS = [
    '[class*="chat-main-messages"] [class*="message-container"]',
    '[class*="chat-main-messages"] [class*="message-area"]',
    '[class*="chat-main-messages"] [class*="message"]',
    '[data-role="assistant"]',
    '[data-testid*="assistant"]',
    '[class*="assistant-message"]',
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="bot"]',
  ];
  var STOP_TOKENS = [
    '停止回答',
    '停止生成',
    '停止输出',
    '停止回复',
    'stop generating',
    'stop response',
  ];
  var ACTION_TOKENS = [
    '复制',
    '重新生成',
    '重试',
    '点赞',
    '点踩',
    '朗读',
    '分享',
    '有帮助',
    '没帮助',
    'copy',
    'regenerate',
    'retry',
    'like',
    'dislike',
    'share',
  ];
  var COPY_TOKENS = [
    '复制',
    'copy',
  ];

  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function hasInjectedButton(el) {
    if (!el) return false;

    var actionHost = getResponseActionHost(el);
    if (actionHost && actionHost.querySelector('.ai-saver-host')) return true;

    var position = getActionInsertPosition(el);
    if (position && position.parent && position.parent.querySelector) {
      if (position.parent.querySelector('.ai-saver-host')) return true;
    }

    return !!(el.nextElementSibling && el.nextElementSibling.classList &&
      el.nextElementSibling.classList.contains('ai-saver-host'));
  }

  function hasUsableText(el) {
    return ((el.textContent || '').trim().length >= MIN_TEXT_LENGTH);
  }

  function hasClassToken(el, token) {
    return !!(el && el.classList && Array.from(el.classList).some(function(name) {
      return name.indexOf(token) !== -1;
    }));
  }

  function getResponseBodyHost(root) {
    if (!root) return null;

    var firstChild = root.firstElementChild;
    if (!firstChild) return null;

    var body = firstChild.firstElementChild;
    if (body && hasClassToken(body, 'relative') && hasClassToken(body, 'w-full')) return body;

    return null;
  }

  function getResponseActionHost(root) {
    if (!root) return null;

    var firstChild = root.firstElementChild;
    if (!firstChild) return null;

    var children = Array.from(firstChild.children);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (hasClassToken(child, 'select-none') && hasClassToken(child, 'flex-row')) return child;
    }

    return null;
  }

  function hasUserSignalInAncestors(el) {
    var chatRoot = getChatRoot(el);
    var node = el;

    while (node && node !== chatRoot && node !== document.body && node.nodeType === 1) {
      var signal = [
        node.className || '',
        node.getAttribute('data-role') || '',
        node.getAttribute('data-testid') || '',
        node.getAttribute('aria-label') || ''
      ].join(' ').toLowerCase();

      if (signal.indexOf('user') !== -1) return true;
      if (hasClassToken(node, 'justify-end')) return true;
      node = node.parentElement;
    }

    return false;
  }

  function findResponseByMessageListDom() {
    var containers = document.querySelectorAll('[class*="message-list-"] [class*="inter-"] > [class*="container-"]');
    var results = [];

    for (var i = 0; i < containers.length; i++) {
      var candidate = containers[i].querySelector('.group');
      if (!candidate) continue;
      if (hasClassToken(candidate, 'justify-end')) continue;

      var body = getResponseBodyHost(candidate);
      if (!body) continue;
      if (!hasUsableText(body)) continue;

      results.push(candidate);
    }

    return deduplicate(results);
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
    var chatRoot = getChatRoot();
    if (!chatRoot) return false;

    var controls = chatRoot.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (control.offsetParent === null) continue;
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

  function matchesActionToken(value) {
    var normalized = (value || '').trim().toLowerCase();
    if (!normalized) return false;
    for (var i = 0; i < ACTION_TOKENS.length; i++) {
      if (normalized.indexOf(ACTION_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  function matchesCopyToken(value) {
    var normalized = (value || '').trim().toLowerCase();
    if (!normalized) return false;
    for (var i = 0; i < COPY_TOKENS.length; i++) {
      if (normalized.indexOf(COPY_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  function getMatchingActionControls(root) {
    if (!root || !root.querySelectorAll) return [];

    var controls = root.querySelectorAll('button, [role="button"]');
    var matches = [];

    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (control.closest('.ai-saver-host, .ai-saver-modal-host')) continue;

      var text = [
        control.textContent || '',
        control.getAttribute('aria-label') || '',
        control.getAttribute('title') || '',
        control.getAttribute('data-testid') || ''
      ].join(' ');

      if (matchesActionToken(text)) matches.push(control);
    }

    return matches;
  }

  function getChatRoot(el) {
    var messageListRoot = document.querySelector('[class*="message-list-"]');
    if (messageListRoot) return messageListRoot;

    if (el && el.closest) {
      var ownRoot = el.closest('[class*="chat-main-messages"]');
      if (ownRoot) return ownRoot;
    }
    return document.querySelector('[class*="chat-main-messages"]');
  }

  function getActionContainer(el) {
    if (!el || !el.closest) return null;
    return el.closest('[class*="message-container"]') ||
      el.closest('[class*="container-wrapper"]') ||
      el.closest('[class*="message"]') ||
      el.closest('[class*="chat-main-messages"]');
  }

  function findCopyControl(actionRow) {
    if (!actionRow) return null;

    var controls = actionRow.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (control.closest('.ai-saver-host, .ai-saver-modal-host')) continue;

      var text = [
        control.textContent || '',
        control.getAttribute('aria-label') || '',
        control.getAttribute('title') || '',
        control.getAttribute('data-testid') || ''
      ].join(' ');

      if (matchesCopyToken(text)) return control;
    }

    return null;
  }

  function getActionInsertPosition(container) {
    if (!container) return null;

    var copyControl = findCopyControl(container);
    if (copyControl && copyControl.parentElement) {
      return {
        parent: copyControl.parentElement,
        anchor: copyControl,
        mode: 'before-copy'
      };
    }

    var controls = getMatchingActionControls(container);
    if (controls.length > 0) {
      var lastControl = controls[controls.length - 1];
      if (lastControl && lastControl.parentElement) {
        return {
          parent: lastControl.parentElement,
          anchor: lastControl,
          mode: 'after-last-action'
        };
      }
    }

    return null;
  }

  function getInsertionTarget(container) {
    var controls = getMatchingActionControls(container);
    if (controls.length === 0) return null;

    var copyControl = findCopyControl(container);
    if (copyControl && copyControl.parentElement) {
      return {
        parent: copyControl.parentElement,
        before: copyControl,
        mode: 'before-copy'
      };
    }

    var lastControl = controls[controls.length - 1];
    if (lastControl && lastControl.parentElement) {
      return {
        parent: lastControl.parentElement,
        before: null,
        mode: 'append-after-actions'
      };
    }

    return null;
  }

  function hasAssistantActionBar(el) {
    var container = getActionContainer(el);
    if (!container) return false;
    return getMatchingActionControls(container).length > 0;
  }

  function getNestedMessageContainerCount(el) {
    if (!el || !el.querySelectorAll) return 0;
    return el.querySelectorAll('[class*="message-container"]').length;
  }

  function getNestedMessageAreaCount(el) {
    if (!el || !el.querySelectorAll) return 0;
    return el.querySelectorAll('[class*="message-area"]').length;
  }

  function isOverbroadResponse(el) {
    return getNestedMessageContainerCount(el) > 1 || getNestedMessageAreaCount(el) > 1;
  }

  function resolveResponseWrapper(el) {
    var messageArea = el.closest('[class*="message-area"]');
    if (messageArea && hasUsableText(messageArea)) return messageArea;

    var messageContainer = el.closest('[class*="message-container"]');
    if (messageContainer && hasUsableText(messageContainer)) return messageContainer;

    return el.closest('[data-role="assistant"]') ||
      el.closest('[data-testid*="assistant"]') ||
      el.closest('[class*="assistant-message"]') ||
      el.closest('[class*="assistant"]') ||
      el.closest('[class*="answer"]') ||
      el.closest('[class*="bot"]') ||
      el;
  }

  function isLikelyAssistantWrapper(el) {
    var signal = [
      el.className || '',
      el.getAttribute('data-role') || '',
      el.getAttribute('data-testid') || ''
    ].join(' ').toLowerCase();

    if (signal.indexOf('user') !== -1) return false;
    if (hasUserSignalInAncestors(el)) return false;
    if (signal.indexOf('assistant') !== -1) return true;
    if (signal.indexOf('answer') !== -1) return true;
    if (signal.indexOf('bot') !== -1) return true;
    if (hasAssistantActionBar(el)) return true;

    return !!el.querySelector(
      '.markdown-body, [class*="message-content"], [class*="answer-content"], [class*="message-area"], pre, code, table, blockquote'
    );
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    if (el.closest('form, footer, [class*="composer"], [class*="input-area"]')) return false;
    if (hasUserSignalInAncestors(el)) return false;
    if (!isLikelyAssistantWrapper(el)) return false;
    if (!hasUsableText(el)) return false;
    if (isOverbroadResponse(el)) return false;
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
      var wrapper = resolveResponseWrapper(nodes[i]);
      if (wrapper && isLikelyResponse(wrapper)) result.push(wrapper);
    }
    return deduplicate(result);
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

  function findResponseByActionBar() {
    var chatRoot = getChatRoot();
    if (!chatRoot) return [];

    var controls = getMatchingActionControls(chatRoot);
    var candidates = [];

    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      var container = getActionContainer(control);
      if (!container) continue;
      candidates.push(container);
    }

    return normalizeCandidates(candidates);
  }

  function findResponseElements() {
    var results = [];
    var byMessageList = findResponseByMessageListDom();
    if (byMessageList.length > 0) results = results.concat(byMessageList);

    if (cachedResponseSelector) {
      var cached = normalizeCandidates(document.querySelectorAll(cachedResponseSelector));
      if (cached.length > 0) {
        results = results.concat(cached);
      } else {
        cachedResponseSelector = null;
      }
    }

    for (var i = 0; i < RESPONSE_SELECTORS.length; i++) {
      if (RESPONSE_SELECTORS[i] === cachedResponseSelector) continue;
      try {
        var matched = normalizeCandidates(document.querySelectorAll(RESPONSE_SELECTORS[i]));
        if (matched.length > 0) {
          if (!cachedResponseSelector) {
            cachedResponseSelector = RESPONSE_SELECTORS[i];
            console.log('[ChatSavor] Doubao selector:', RESPONSE_SELECTORS[i], '(' + matched.length + ' blocks)');
          }
          results = results.concat(matched);
        }
      } catch (e) {}
    }

    var byActionBar = findResponseByActionBar();
    if (byActionBar.length > 0) {
      console.log('[ChatSavor] Doubao action-bar fallback:', byActionBar.length, 'blocks');
      results = results.concat(byActionBar);
    }

    results = results.concat(findResponseByStructure());
    return deduplicate(results);
  }

  function waitForStable(el, callback) {
    if (processed.has(el) || hasInjectedButton(el)) {
      processed.add(el);
      return;
    }

    var stableTarget = getResponseBodyHost(el) || el;
    var lastLen = (stableTarget.textContent || '').trim().length;
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

      stableTarget = getResponseBodyHost(el) || el;
      var newLen = (stableTarget.textContent || '').trim().length;
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
    if (hasInjectedButton(el)) return true;

    var bodyHost = getResponseBodyHost(el);
    var actionHost = getResponseActionHost(el);
    if (bodyHost && actionHost) {
      var btnHost = core.createSaveButton(function() {
        var result = core.extractMarkdown(bodyHost);
        if (result && result.markdown) core.showPreviewModal(result.markdown);
      });

      btnHost.style.display = 'inline-flex';
      btnHost.style.justifyContent = 'flex-start';
      btnHost.style.padding = '0';
      btnHost.style.marginTop = '0';
      btnHost.style.marginLeft = 'auto';
      btnHost.style.marginRight = '0';
      btnHost.style.flexShrink = '0';
      btnHost.style.opacity = '1';
      btnHost.style.pointerEvents = 'auto';

      actionHost.appendChild(btnHost);
      return true;
    }

    var insertPosition = getActionInsertPosition(el);
    if (insertPosition) {
      if (insertPosition.parent.querySelector('.ai-saver-host')) return true;

      var btnHost = core.createSaveButton(function() {
        var result = core.extractMarkdown(el);
        if (result && result.markdown) core.showPreviewModal(result.markdown);
      });

      btnHost.style.display = 'inline-flex';
      btnHost.style.justifyContent = 'flex-start';
      btnHost.style.padding = '0';
      btnHost.style.marginTop = '0';
      btnHost.style.flexShrink = '0';

      if (insertPosition.mode === 'before-copy') {
        btnHost.style.marginLeft = '8px';
        btnHost.style.marginRight = '8px';
        insertPosition.parent.insertBefore(btnHost, insertPosition.anchor);
      } else {
        btnHost.style.marginLeft = 'auto';
        btnHost.style.marginRight = '0';
        if (insertPosition.anchor.parentElement === insertPosition.parent && insertPosition.anchor.nextSibling) {
          insertPosition.parent.insertBefore(btnHost, insertPosition.anchor.nextSibling);
        } else {
          insertPosition.parent.appendChild(btnHost);
        }
      }
      return true;
    }

    if (!el.parentElement) return false;
    return core.injectButtonAfter(el, function() {
      var result = core.extractMarkdown(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown);
    });
  }

  function scan() {
    var responseEls = findResponseElements();
    responseEls.forEach(function(el) {
      if (!processed.has(el)) waitForStable(el, injectButton);
    });
  }

  setTimeout(scan, 1000);
  setInterval(scan, 2000);
})();
