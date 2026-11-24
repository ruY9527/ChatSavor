// ChatSavor — Doubao platform module (Samantha / Flow layout)
// Anchors on action-bar semantics, never on a global "copy" button.
(function () {
  'use strict';
  if (!window.ChatSavorPlatform) return;
  var core = window.ChatSavorCore;

  var NOISE_SELECTOR = [
    '.ai-saver-host', '.ai-saver-modal-host', '.ai-saver-select-host', '.ai-saver-select-mark',
    '[data-foundation-type="send-message-action-bar"]',
    '[data-foundation-type="receive-message-action-bar"]',
    '[data-foundation-type*="action-bar"]',
    '[data-foundation-type*="suggest"]',
    '[class*="message-action-bar"]',
    '[class*="message-action-button"]',
    '[class*="suggest-message"]'
  ].join(', ');

  var THINKING_SELECTOR = '[data-plugin-identifier*="think"], [class*="think-stage"], [class*="thinking-content"], [class*="reasoning-content"], [class*="cot-content"]';

  var USER_SELECTOR = '[data-role="user"], [data-testid*="user_message"], [data-testid*="send_message"]';

  function hasExactClass(el, name) {
    return !!(el && el.classList && el.classList.contains(name));
  }

  function cleanText(el) {
    if (!el) return '';
    var copy = el.cloneNode(true);
    copy.querySelectorAll(NOISE_SELECTOR + ', ' + THINKING_SELECTOR).forEach(function(n) { n.remove(); });
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function resolveTurnItem(el) {
    if (!el || !el.closest) return null;
    return el.closest('[data-message-list-item-id]') ||
      el.closest('[class*="message-container"]') ||
      (el.closest('[data-message-id]') && el.closest('[data-message-id]').parentElement) ||
      el;
  }

  function isUserTurn(el) {
    if (!el) return false;
    if (el.closest && el.closest('[data-foundation-type="send-message-action-bar"]')) return true;
    if (el.closest && el.closest(USER_SELECTOR)) return true;
    var turnItem = resolveTurnItem(el);
    if (!turnItem || turnItem === el && !el.querySelectorAll) return false;
    var query = turnItem.querySelectorAll ? turnItem.querySelectorAll.bind(turnItem) : function() { return []; };
    if (query('[data-foundation-type="send-message-action-bar"]').length &&
        !query('[data-foundation-type="receive-message-action-bar"]').length) return true;
    if (query('[class*="send-msg-bubble"]').length) return true;
    // Exact justify-end on the message row itself marks a user bubble.
    var msg = el.matches && el.matches('[data-message-id]') ? el : (query('[data-message-id]')[0] || null);
    if (msg && hasExactClass(msg, 'justify-end')) return true;
    return false;
  }

  function resolveAssistantBody(turnOrNode) {
    if (!turnOrNode) return null;
    // 1) Inside a turn item: prefer the [data-message-id] row that is not a user row.
    var item = turnOrNode.matches && turnOrNode.matches('[data-message-list-item-id]') ? turnOrNode :
      (turnOrNode.closest ? turnOrNode.closest('[data-message-list-item-id]') : null);
    if (item) {
      var rows = item.querySelectorAll('[data-message-id]');
      var aiRow = null;
      for (var i = 0; i < rows.length; i++) {
        if (!hasExactClass(rows[i], 'justify-end') && !isUserTurn(rows[i])) { aiRow = rows[i]; break; }
      }
      if (aiRow) return aiRow;
    }
    // 2) The node itself is a message row.
    if (turnOrNode.matches && turnOrNode.matches('[data-message-id]') && !isUserTurn(turnOrNode)) return turnOrNode;
    // 3) Markdown body anchor: return its common message row, or the body itself.
    var md = null;
    if (turnOrNode.matches && turnOrNode.matches('.flow-markdown-body, [class*="flow-markdown-body"], [class*="mdbox-theme"]')) md = turnOrNode;
    else if (turnOrNode.querySelector) md = turnOrNode.querySelector('.flow-markdown-body, [class*="flow-markdown-body"], [class*="mdbox-theme"]');
    if (md) {
      var owner = md.closest('[data-message-id]');
      return owner && !isUserTurn(owner) ? owner : md;
    }
    return turnOrNode;
  }

  function findResponses(ctx) {
    var dom = ctx.dom;
    function all(sel) { return dom ? dom.queryAll(sel) : Array.from(document.querySelectorAll(sel)); }
    function usable(el) {
      return el && !el.matches(NOISE_SELECTOR) && !isUserTurn(el) && ctx.isVisible(el) && cleanText(el).length >= 2;
    }
    function finish(list) { return ctx.removeNested(ctx.deduplicate(list)); }

    // Layer 1: receive-message-action-bar → reverse-locate the assistant body.
    var bars = all('[data-foundation-type="receive-message-action-bar"]');
    var found = [];
    bars.forEach(function(bar) {
      var turnItem = resolveTurnItem(bar);
      if (!turnItem || isUserTurn(turnItem)) return;
      var body = resolveAssistantBody(turnItem);
      if (usable(body)) found.push(body);
    });
    if (found.length) return finish(found);

    // Layer 2: flow-markdown-body anchors.
    var mdNodes = all('.flow-markdown-body, [class*="flow-markdown-body"], [class*="mdbox-theme"]').filter(function(el) {
      return !el.matches(THINKING_SELECTOR) && !(el.closest && el.closest(THINKING_SELECTOR));
    });
    found = [];
    mdNodes.forEach(function(node) {
      var el = resolveAssistantBody(resolveTurnItem(node) || node);
      if (usable(el)) found.push(el);
    });
    if (found.length) return finish(found);

    // Layer 3: [data-message-id] rows that are not user turns.
    found = all('[data-message-id]').filter(usable);
    if (found.length) return finish(found);

    // Layer 4: old-layout / minimal-fixture fallback.
    found = [];
    var fallbacks = ['[class*="message-container"] [class*="message-area"]', '[class*="message-area"]', '[data-role="assistant"]', '[class*="assistant-message"]'];
    for (var i = 0; i < fallbacks.length; i++) {
      found = all(fallbacks[i]).filter(function(el) {
        return !(el.closest && el.closest(NOISE_SELECTOR)) && usable(el);
      });
      if (found.length) return finish(found);
    }
    return [];
  }

  function hasButton(el) {
    if (!el) return false;
    if (el.querySelector && el.querySelector(':scope > .ai-saver-host[data-chatsavor-owner="doubao"]')) return true;
    return !!(el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('ai-saver-host'));
  }

  function mountButton(el, onClick) {
    if (!core) return false;
    if (hasButton(el)) return false;
    if (!el.parentElement) return false;
    var host = core.createSaveButton(onClick);
    host.setAttribute('data-chatsavor-owner', 'doubao');
    // Persistently visible: insert right after the assistant body row, never inside
    // an opacity-0 action bar or a BlueprintJS overflow list.
    host.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;padding:4px 0;margin-top:4px;opacity:1;pointer-events:auto;';
    if (el.nextSibling) el.parentElement.insertBefore(host, el.nextSibling);
    else el.parentElement.appendChild(host);
    return true;
  }

  function extractThinking(el) {
    var turn = resolveTurnItem(el);
    var scope = turn || el;
    if (!scope || !scope.querySelectorAll) return '';
    return Array.from(scope.querySelectorAll(THINKING_SELECTOR))
      .map(function(n) { return (n.textContent || '').trim(); })
      .filter(Boolean).join('\n\n');
  }

  function extractReply(el, ctx) {
    var source = ctx.dom ? ctx.dom.clone(el) : el.cloneNode(true);
    var clone = source.nodeType === 1 && source.matches && source.matches('div') ? source : document.createElement('div');
    if (clone !== source) clone.appendChild(source);
    clone.querySelectorAll(NOISE_SELECTOR + ', ' + THINKING_SELECTOR).forEach(function(n) { n.remove(); });
    // Strip Doubao's "表格" / "Table" card toolbar header even when the table is
    // wrapped inside 2–5 nested scroll/body containers.
    clone.querySelectorAll('table').forEach(function(table) {
      var cur = table;
      for (var depth = 0; cur && cur !== clone && depth < 6; depth++) {
        var parent = cur.parentElement;
        if (parent && parent !== clone && parent.querySelectorAll('table').length > 1) break;
        var header = cur.previousElementSibling;
        if (header) {
          var meaningful = header.querySelector('table, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre');
          if (!meaningful) {
            var h = header.cloneNode(true);
            h.querySelectorAll('button, [role="button"], svg').forEach(function(n) { n.remove(); });
            var label = (h.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^(?:表格|table)(?:\s*(?:复制|下载|全屏|放大|预览|copy|download))?$/i.test(label)) {
              header.remove();
              break;
            }
          }
        }
        cur = parent;
      }
    });
    return ctx.core.extractMarkdown(clone);
  }

  function getTurns(ctx) {
    var dom = ctx.dom;
    function all(sel) { return dom ? dom.queryAll(sel) : Array.from(document.querySelectorAll(sel)); }
    var turns = [];
    var seen = new Set();
    function add(role, el) {
      if (!el || seen.has(el) || !ctx.isVisible(el)) return;
      seen.add(el);
      turns.push({ role: role, element: el });
    }
    // User turns: prefer the send bubble; fall back to the message row (never the action bar).
    var userRows = all('[data-message-list-item-id], [data-message-id]').filter(function(el) { return isUserTurn(el); });
    userRows.forEach(function(row) {
      var bubble = row.querySelector && row.querySelector('[class*="send-msg-bubble"]');
      add('user', bubble || (row.matches && row.matches('[data-message-id]') ? row : (row.querySelector('[data-message-id]') || row)));
    });
    findResponses(ctx).forEach(function(el) { add('assistant', el); });
    turns.sort(function(a, b) { return dom ? dom.compare(a.element, b.element) : 0; });
    return turns;
  }

  window.ChatSavorPlatform.create({
    id: 'doubao',
    matchHost: function (host) { return host === 'doubao.com' || host.slice(-11) === '.doubao.com'; },
    responseSelectors: [
      '[data-foundation-type="receive-message-action-bar"]',
      '.flow-markdown-body, [class*="flow-markdown-body"]',
      '[data-message-id]',
      '[class*="message-container"] [class*="message-area"]',
      '[class*="message-area"]',
    ],
    userSelector: USER_SELECTOR,
    minTextLength: 2,
    findResponses: findResponses,
    hasButton: hasButton,
    mountButton: mountButton,
    extractReply: extractReply,
    extractThinking: extractThinking,
    getTurns: getTurns,
  });
})();
