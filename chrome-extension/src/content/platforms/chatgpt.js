// ChatSavor — ChatGPT platform module

(function() {
  'use strict';

  var dom = window.ChatSavorDOM;
  var platformHost = dom ? dom.host() : location.hostname;
  if (platformHost !== 'chatgpt.com' && platformHost !== 'chat.openai.com') return;

  var version = window.ChatSavorBridge ? window.ChatSavorBridge.version : '2.0.6';
  var previousAdapter = window.ChatSavorChatGPTAdapter;
  if (previousAdapter && previousAdapter.version === version && previousAdapter.core === window.ChatSavorCore) {
    if (window.ChatSavorBridge) window.ChatSavorBridge.register(previousAdapter);
    return;
  }
  if (previousAdapter && previousAdapter.dispose) previousAdapter.dispose();

  var core = window.ChatSavorCore;
  if (!core) return;

  console.log('[ChatSavor] ChatGPT module loaded');

  var responseState = new WeakMap();
  var STABILITY_MS = 1500;
  var scanTimers = [];
  var UNIT_SELECTOR = '[data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"]';
  var MESSAGE_SELECTOR = '[data-message-author-role="assistant"], [data-turn="assistant"], [data-message-role="assistant"]';
  var BODY_SELECTOR = '[data-assistant-markdown], [data-markdown-text-style="assistant-message"]';
  var ASSISTANT_SELECTOR = MESSAGE_SELECTOR + ', ' + UNIT_SELECTOR + ', ' + BODY_SELECTOR + ', h4[data-conversation-role="assistant"], h5[data-conversation-role="assistant"]';
  var TURN_SELECTOR = '[data-testid^="conversation-turn-"], article[data-turn]';
  var USER_SELECTOR = '[data-message-author-role="user"], [data-turn="user"], [data-message-role="user"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"], [data-user-message-bubble]';
  var EXCLUDED_SELECTOR = '[data-testid="composer"], #prompt-textarea, [contenteditable="true"], [role="textbox"], footer, .ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host';
  var STOP_TOKENS = [
    'stop generating',
    'stop response',
    '停止生成',
    '停止输出',
    '停止回答',
  ];

  function isVisible(el) {
    if (!el || !el.isConnected || (dom ? dom.closest(el, '[hidden], [aria-hidden="true"]') : el.closest('[hidden], [aria-hidden="true"]'))) return false;
    var view = el.ownerDocument.defaultView || window;
    var style = view.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (el.getClientRects().length > 0) return true;
    // A display:contents wrapper has no box, but its reply can still be visible.
    if (style.display === 'contents') {
      return Array.from(el.children).some(isVisible);
    }
    return false;
  }

  function hasInjectedButton(el) {
    if (el && el.querySelector(':scope > .ai-saver-host[data-chatsavor-owner="chatgpt"]')) return true;
    return !!(el && el.nextElementSibling && el.nextElementSibling.classList &&
      el.nextElementSibling.classList.contains('ai-saver-host'));
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
    var controls = dom ? dom.queryAll('button, [role="button"]') : document.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!isVisible(control)) continue;
      if (control.closest('.ai-saver-host, .ai-saver-modal-host')) continue;
      if (control.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) return true;
      var text = [
        control.textContent || '',
        control.getAttribute('aria-label') || '',
        control.getAttribute('title') || ''
      ].join(' ');
      if (matchesStopToken(text)) return true;
    }
    return false;
  }

  function resolveResponseWrapper(el) {
    // A data-turn-key wraps both the prompt and answer; only the assistant unit is a reply.
    var unit = el.closest(UNIT_SELECTOR);
    if (unit) return unit;
    var message = el.closest('[data-message-role="assistant"]');
    if (message) return message;
    if (el.matches('h4[data-conversation-role="assistant"], h5[data-conversation-role="assistant"]')) return el.parentElement;
    var turn = el.closest(TURN_SELECTOR);
    if (turn) {
      var messages = turn.querySelectorAll('[data-message-author-role="assistant"]');
      if (messages.length === 1) return messages[0];
      // Keep split response blocks together under a single conversion button.
      return turn;
    }
    return el.closest(ASSISTANT_SELECTOR) || el;
  }

  function isLikelyResponse(el) {
    if (!el || !isVisible(el)) return false;
    if (dom ? dom.closest(el, EXCLUDED_SELECTOR) : el.closest(EXCLUDED_SELECTOR)) return false;
    if ((dom ? dom.closest(el, USER_SELECTOR) : el.closest(USER_SELECTOR)) || el.querySelector(USER_SELECTOR)) return false;
    if (!(dom ? dom.text(el) : el.textContent || '').trim()) return false;
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

  function findResponseElements() {
    var candidates = dom ? dom.queryAll(ASSISTANT_SELECTOR) : Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
    // Some layouts expose a conversation turn and Markdown without an author-role attribute.
    var turns = dom ? dom.queryAll(TURN_SELECTOR) : Array.from(document.querySelectorAll(TURN_SELECTOR));
    turns.forEach(function(turn) {
      if (turn.matches(USER_SELECTOR) || turn.querySelector(USER_SELECTOR)) return;
      if (turn.matches(ASSISTANT_SELECTOR) || (dom ? dom.queryAll(ASSISTANT_SELECTOR + ', .markdown, .prose', turn).length : turn.querySelector(ASSISTANT_SELECTOR + ', .markdown, .prose'))) {
        candidates.push(turn);
      }
    });
    var responses = deduplicate(candidates.map(resolveResponseWrapper)).filter(isLikelyResponse);
    // Nested turn wrappers must not produce duplicate buttons for the same reply.
    return responses.filter(function(el) {
      return !responses.some(function(other) { return other !== el && (dom ? dom.contains(other, el) : other.contains(el)); });
    }).sort(function(a, b) {
      if (dom) return dom.compare(a, b);
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  // Convert ChatGPT's interactive DilRenderer components into static,
  // Markdown-friendly structures before turndown strips buttons/div grids.
  function normalizeDilComponents(clone) {
    if (!clone || !clone.querySelectorAll) return;
    // 1) Remove slider tracks and colour-clip bars with no explanatory text.
    clone.querySelectorAll('[data-d-component="slider"], [data-d-clip="true"]').forEach(function(n) { n.remove(); });

    // 2) Preserve segmented-control options as a single readable paragraph.
    clone.querySelectorAll('[data-d-component="segmented-control"]').forEach(function(control) {
      var parts = [];
      control.querySelectorAll('button, [role="radio"], [role="tab"]').forEach(function(btn) {
        var label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (!label) return;
        var selected = btn.getAttribute('aria-checked') === 'true' || btn.getAttribute('data-state') === 'on' || btn.classList.contains('selected');
        parts.push(selected ? '**[✓ ' + label + ']**' : '[' + label + ']');
      });
      var p = document.createElement('p');
      p.textContent = parts.join(' · ');
      control.replaceWith(p);
    });

    // 3) Convert multi-column grids into compact tables with real label headers.
    clone.querySelectorAll('[data-d-component="grid"]').forEach(function(grid) {
      var items = Array.from(grid.children).filter(function(c) { return c && c.nodeType === 1; });
      if (items.length < 2) return;
      var styleAttr = grid.getAttribute('style') || '';
      var colMatch = /repeat\((\d+)/.exec(styleAttr);
      var cols = colMatch ? parseInt(colMatch[1], 10) : Math.min(items.length, 3);
      if (cols < 1) cols = Math.min(items.length, 3);

      function cellParts(item) {
        var fragment = document.createElement('div');
        // Promote image/content wrapped by empty pressable buttons.
        Array.from(item.querySelectorAll('button[data-d-component="pressable"]')).forEach(function(btn) {
          while (btn.firstChild) fragment.appendChild(btn.firstChild);
          btn.remove();
        });
        Array.from(item.childNodes).forEach(function(node) {
          if (node.nodeType === 1 && node.matches && node.matches('button[data-d-component="pressable"]')) return;
          fragment.appendChild(node.cloneNode(true));
        });
        fragment.querySelectorAll('h1, h2, h3, h4').forEach(function(h) {
          var strong = document.createElement('strong');
          strong.textContent = (h.textContent || '').trim();
          h.replaceWith(strong);
        });
        var blocks = [];
        Array.from(fragment.childNodes).forEach(function(node) {
          var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text) return;
          if (node.nodeType === 1 && /^(?:STRONG|IMG)$/.test(node.tagName)) blocks.push(node.outerHTML);
          else blocks.push(text);
        });
        return blocks;
      }

      var parsed = items.map(function(item) {
        var blocks = cellParts(item);
        return { label: blocks.length ? blocks[0] : '', value: blocks.slice(1).join('<br>') };
      });
      var table = document.createElement('table');
      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      var tbody = document.createElement('tbody');
      // The first visual row supplies the real column labels (never "Column 1").
      for (var c = 0; c < cols; c++) {
        var th = document.createElement('th');
        th.innerHTML = parsed[c] && parsed[c].label || '';
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      // Values of the first row, then all following rows, become data cells.
      for (var i = 0; i < items.length; i += cols) {
        var row = document.createElement('tr');
        for (var cc = 0; cc < cols; cc++) {
          var td = document.createElement('td');
          var entry = parsed[i + cc];
          td.innerHTML = entry ? entry.value : '';
          row.appendChild(td);
        }
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      grid.replaceWith(table);
    });

    // 4) Merge leaf-level key/value rows onto one line.
    clone.querySelectorAll('[data-d-component="row"]').forEach(function(row) {
      if (row.querySelector('table, pre, ul, ol, img, [data-d-component="grid"], [data-d-component="card"]')) return;
      var chunks = [];
      Array.from(row.children).forEach(function(cell) {
        if (cell.matches && cell.matches('[data-d-component="spacer"], [data-d-component="box"]')) return;
        var text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) chunks.push(text);
      });
      if (chunks.length < 2) return;
      var p = document.createElement('p');
      p.textContent = chunks.join(' · ');
      row.replaceWith(p);
    });
  }

  function extractReply(el) {
    var clone = dom ? dom.clone(el) : el.cloneNode(true);
    // The transcript's <li> is page structure, not a bullet in the assistant's answer.
    if (clone.matches('li[data-message-role="assistant"]')) {
      var content = document.createElement('div');
      while (clone.firstChild) content.appendChild(clone.firstChild);
      clone = content;
    }
    clone.querySelectorAll('[data-message-attribution], h4[data-conversation-role], h5[data-conversation-role], [data-assistant-message-actions], [data-message-actions], [data-message-content-controls], [data-assistant-placeholder-slot], [popover]').forEach(function(node) { node.remove(); });
    clone.querySelectorAll('button[data-assistant-sources-payload]').forEach(function(button) {
      var replacement = document.createElement('span');
      var sources;
      try { sources = JSON.parse(button.getAttribute('data-assistant-sources-payload')); } catch (ignored) {}
      if (Array.isArray(sources)) sources.slice(0, 20).forEach(function(source) {
        try {
          var url = new URL(source.url);
          if (!/^https?:$/.test(url.protocol)) return;
          if (replacement.childNodes.length) replacement.appendChild(document.createTextNode(' '));
          var link = document.createElement('a');
          link.href = url.href;
          link.textContent = source.title || source.attribution || button.textContent.trim() || url.hostname;
          replacement.appendChild(link);
        } catch (ignored) {}
      });
      if (!replacement.childNodes.length) replacement.textContent = button.textContent;
      button.replaceWith(replacement);
    });
    normalizeDilComponents(clone);
    var result = core.extractMarkdown(clone);
    if (result) {
      var thinkingNodes = (dom ? dom.queryAll('[class*="thinking"], [class*="reasoning"], [data-testid*="thinking"]', el) : Array.from(el.querySelectorAll('[class*="thinking"], [class*="reasoning"], [data-testid*="thinking"]')));
      var thinking = thinkingNodes.map(function(n) { return (n.textContent || '').trim(); }).filter(Boolean).join('\n\n');
      if (thinking) result.thinking = thinking;
    }
    return result;
  }

  function injectButton(el) {
    if (!el || !el.parentElement) return false;
    if (hasInjectedButton(el)) return true;
    var onClick = function() {
      var result = extractReply(el);
      if (result && result.markdown) core.showPreviewModal(result.markdown, result.thinking ? { thinking: result.thinking } : undefined);
    };
    // Keep <ol> children valid and put the action inside this message, never after the thread.
    if (el.matches('li[data-message-role="assistant"], ' + UNIT_SELECTOR)) {
      var host = core.createSaveButton(onClick);
      host.setAttribute('data-chatsavor-owner', 'chatgpt');
      el.appendChild(host);
      return true;
    }
    return core.injectButtonAfter(el, onClick);
  }

  function scan(force) {
    var responseEls = findResponseElements();
    var generating = hasVisibleStopButton();
    var now = Date.now();
    responseEls.forEach(function(el, index) {
      if (hasInjectedButton(el)) return;
      if (force === true) { injectButton(el); return; }
      var text = (dom ? dom.text(el) : el.textContent || '').trim();
      var state = responseState.get(el);
      var streaming = dom ? dom.closest(el, '[data-is-streaming="true"]') || dom.queryAll('[data-is-streaming="true"]', el).length : el.closest('[data-is-streaming="true"]') || el.querySelector('[data-is-streaming="true"]');
      if (!state || state.text !== text || streaming || (generating && index === responseEls.length - 1)) {
        responseState.set(el, { text: text, stableSince: now });
        return;
      }
      if (now - state.stableSince >= STABILITY_MS) injectButton(el);
    });
  }

  function safeScan() {
    try { scan(); }
    catch (error) { if (window.ChatSavorBridge) window.ChatSavorBridge.recordError(error); }
  }

  function getTurns() {
    var userSel = '[data-message-author-role="user"], [data-turn="user"], [data-message-role="user"], [data-content-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":user"]';
    var assistantSel = '[data-message-author-role="assistant"], [data-turn="assistant"], [data-message-role="assistant"], [data-content-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key$=":assistant"], [data-assistant-markdown], [data-markdown-text-style="assistant-message"]';
    var turns = [];
    (dom ? dom.queryAll(userSel) : Array.from(document.querySelectorAll(userSel))).forEach(function(el) { turns.push({ role: 'user', element: el }); });
    findResponseElements().forEach(function(el) { turns.push({ role: 'assistant', element: el }); });
    var seen = new Set();
    turns = turns.filter(function(turn) {
      if (seen.has(turn.element)) return false;
      seen.add(turn.element);
      return isVisible(turn.element);
    });
    turns.sort(function(a, b) { return dom ? dom.compare(a.element, b.element) : 0; });
    return turns;
  }

  window.ChatSavorChatGPTAdapter = {
    platform: 'chatgpt', version: version, core: core, scan: scan, getResponses: findResponseElements, getTurns: getTurns, extractMarkdown: extractReply,
    dispose: function() { scanTimers.forEach(function(id) { clearTimeout(id); clearInterval(id); }); },
    diagnostics: function() {
      var nodes = dom ? dom.queryAll(ASSISTANT_SELECTOR) : Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
      return {
        visibleAssistantNodes: nodes.filter(isVisible).length,
        excludedAssistantNodes: nodes.filter(function(node) { return !!node.closest(EXCLUDED_SELECTOR); }).length,
        stopButtonVisible: hasVisibleStopButton(),
        sampleStructure: Array.from(document.querySelectorAll('main .markdown, main .prose, [data-message-author-role], [data-turn]')).slice(0, 6).map(function(node) {
          var ancestors = [];
          for (var parent = node.parentElement; parent && ancestors.length < 4; parent = parent.parentElement) ancestors.push(parent.tagName.toLowerCase());
          return { tag: node.tagName.toLowerCase(), classes: String(node.className || '').slice(0, 160), authorRole: node.getAttribute('data-message-author-role'), turn: node.getAttribute('data-turn'), ancestorTags: ancestors };
        })
      };
    }
  };
  if (window.ChatSavorBridge) window.ChatSavorBridge.register(window.ChatSavorChatGPTAdapter);
  scanTimers.push(setTimeout(safeScan, 1000));
  scanTimers.push(setInterval(safeScan, 2000));
})();
