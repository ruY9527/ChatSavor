// Traverse rendered document boundaries without reading cross-origin frame contents.
window.ChatSavorDOM = (function() {
  'use strict';
  var OWN_UI = '.ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host, .ai-saver-select-host, .ai-saver-select-mark';
  var cachedRoots = null;

  function canHostShadow(element) {
    var tag = element.tagName || '';
    return tag.indexOf('-') !== -1 || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN';
  }

  function shadowRoot(element) {
    if (element.namespaceURI && element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
    if (element.matches && element.matches(OWN_UI)) return null;
    // Reading .shadowRoot is a cheap JS property; only cross the native boundary
    // for elements that can actually host a shadow root.
    var open = element.shadowRoot;
    if (open) return open;
    if (!canHostShadow(element)) return null;
    try {
      return typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(element) : null;
    } catch (ignored) { return null; }
  }

  function parent(element) {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    var root = element.getRootNode();
    if (root.host) return root.host;
    try { return element.ownerDocument.defaultView.frameElement; } catch (ignored) { return null; }
  }

  function closest(element, selector) {
    for (var node = element; node; node = parent(node)) if (node.matches && node.matches(selector)) return node;
    return null;
  }

  function contains(ancestor, element) {
    for (var node = element; node; node = parent(node)) if (node === ancestor) return true;
    return false;
  }

  function compare(a, b) {
    if (a === b) return 0;
    function path(node) { var result = []; for (; node; node = parent(node)) result.unshift(node); return result; }
    var left = path(a), right = path(b), i = 0;
    while (i < left.length && i < right.length && left[i] === right[i]) i++;
    if (i === left.length) return -1;
    if (i === right.length) return 1;
    return left[i].compareDocumentPosition(right[i]) & 4 ? -1 : 1;
  }

  function roots(start) {
    if (!start && cachedRoots) return cachedRoots;
    var result = [];
    var seen = new Set();
    function visit(root) {
      if (!root || seen.has(root)) return;
      seen.add(root); result.push(root);
      var walkerFilter = {
        acceptNode: function(element) {
          // FILTER_REJECT prunes the whole UI subtree: no per-descendant closest() walk.
          if (element.matches && element.matches(OWN_UI)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      };
      var walker = root.createTreeWalker ? root.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, walkerFilter) : null;
      if (walker) {
        var element = walker.currentNode;
        while ((element = walker.nextNode())) {
          var shadow = shadowRoot(element);
          if (shadow) visit(shadow);
          if (element.tagName === 'IFRAME') {
            try { if (element.contentDocument) visit(element.contentDocument); } catch (ignored) {}
          }
        }
      } else {
        var elements = root.querySelectorAll('*');
        for (var i = 0; i < elements.length; i++) {
          var node = elements[i];
          if (closest(node, OWN_UI)) continue;
          var fallbackShadow = shadowRoot(node);
          if (fallbackShadow) visit(fallbackShadow);
          if (node.tagName === 'IFRAME') {
            try { if (node.contentDocument) visit(node.contentDocument); } catch (ignored) {}
          }
        }
      }
      if (root.nodeType === 1) {
        var ownShadow = shadowRoot(root);
        if (ownShadow) visit(ownShadow);
      }
    }
    visit(start || document);
    if (!start) {
      cachedRoots = result;
      Promise.resolve().then(function() { cachedRoots = null; });
    }
    return result;
  }

  function queryAll(selector, start) {
    var found = [];
    roots(start).forEach(function(root) { found = found.concat(Array.from(root.querySelectorAll(selector))); });
    return Array.from(new Set(found));
  }

  function contentChildren(node) {
    var shadow = node.nodeType === 1 && shadowRoot(node);
    if (shadow) return Array.from(shadow.childNodes);
    if (node.nodeType === 1 && node.tagName === 'SLOT' && node.assignedNodes) {
      var assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) return assigned;
    }
    return Array.from(node.childNodes || []);
  }

  function text(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType === 1 && (node.matches(OWN_UI) || node.matches('style, script, noscript'))) return '';
    return contentChildren(node).map(text).join('');
  }

  function clone(node) {
    if (node.nodeType === 1 && node.matches(OWN_UI)) return node.ownerDocument.createDocumentFragment();
    if (node.nodeType === 3 || node.nodeType === 8) return node.cloneNode();
    var copy = node.nodeType === 11 ? document.createDocumentFragment() : node.cloneNode(false);
    contentChildren(node).forEach(function(child) { copy.appendChild(clone(child)); });
    return copy;
  }

  function host() {
    if (location.hostname) return location.hostname;
    try { if (location.origin && location.origin !== 'null') return new URL(location.origin).hostname; } catch (ignored) {}
    if (/^(?:about:|blob:|data:)/.test(location.href)) {
      try { if (location.ancestorOrigins && location.ancestorOrigins.length) return new URL(location.ancestorOrigins[0]).hostname; } catch (ignored) {}
      try { return window.parent.location.hostname; } catch (ignored) {}
    }
    return '';
  }

  function structure() {
    var scope = roots();
    var frames = queryAll('iframe').map(function(frame) {
      var origin = null;
      try { origin = new URL(frame.getAttribute('src') || 'about:blank', frame.ownerDocument.baseURI).origin; } catch (ignored) {}
      var accessible = false;
      try { accessible = !!frame.contentDocument; } catch (ignored) {}
      return { origin: origin, accessible: accessible, sandboxed: frame.hasAttribute('sandbox') };
    });
    return {
      documents: scope.filter(function(root) { return root.nodeType === 9; }).length,
      shadowRoots: scope.filter(function(root) { return root.host; }).length,
      frames: frames,
      landmarks: { main: queryAll('main').length, articles: queryAll('article, [role="article"]').length, messageIds: queryAll('[data-message-id]').length },
      testIds: queryAll('[data-testid]').slice(0, 30).map(function(node) { return (node.getAttribute('data-testid') || '').slice(0, 100); }),
      components: Array.from(new Set(scope.flatMap(function(root) { return Array.from(root.querySelectorAll('*')).map(function(node) { return node.tagName.toLowerCase(); }).filter(function(tag) { return tag.indexOf('-') !== -1; }); }))).slice(0, 12),
      bodyElements: Array.from(document.body ? document.body.children : []).slice(0, 8).map(function(node) {
        return { tag: node.tagName.toLowerCase(), id: node.id || '', classes: String(node.className || '').slice(0, 120) };
      })
    };
  }

  return { roots: roots, queryAll: queryAll, closest: closest, parent: parent, contains: contains, compare: compare, text: text, clone: clone, host: host, structure: structure };
})();
