// ChatSavor — shared platform adapter base (native MV3 content script, zero build)
// Exposed as window.ChatSavorPlatform; every non-ChatGPT platform and the generic
// scanner create() their adapter from here so scanning, stability gating and
// hot-reload cleanup share one implementation.
(function () {
  'use strict';

  var DEFAULT_EXCLUDED_SELECTOR = '.ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host, form, footer, nav, aside, textarea, [contenteditable="true"], [role="textbox"]';
  var DEFAULT_STOP_TOKENS = ['stop generating', 'stop response', '停止生成', '停止输出', '停止回答', '停止回复', '取消生成'];
  var DEFAULT_STOP_SELECTORS = ['[data-testid="stop-button"]', '[data-testid="stop-generating-button"]'];

  if (!window.ChatSavorAdapters) window.ChatSavorAdapters = {};

  function getDom() { return window.ChatSavorDOM || null; }

  function matches(el, selector) {
    if (!el || !selector || !el.matches) return false;
    return el.matches(selector);
  }

  function closest(dom, el, selector) {
    return dom ? dom.closest(el, selector) : (el && el.closest ? el.closest(selector) : null);
  }

  function queryAll(dom, selector, scope) {
    if (dom) return dom.queryAll(selector, scope || document);
    return Array.from((scope || document).querySelectorAll(selector));
  }

  function elementText(dom, el) {
    return (dom ? dom.text(el) : (el && el.textContent) || '').trim();
  }

  function create(config) {
    var dom = getDom();
    var core = window.ChatSavorCore;
    var initialHost = dom && typeof dom.host === 'function' ? dom.host() : location.hostname;
    // Platform files load on every matched host; only the matching adapter may register.
    if (config.matchHost && config.matchHost(initialHost, location) !== true) return null;
    var version = window.ChatSavorBridge ? window.ChatSavorBridge.version : '2.0.6';
    var storageKey = config.id;
    var prev = window.ChatSavorAdapters[storageKey];
    // Custom site rules must be able to force a rebuild of the generic adapter;
    // otherwise the version/core short-circuit below keeps the stale selectors.
    if (config.forceReplace !== true && prev && prev.version === version && prev.core === core) {
      if (window.ChatSavorBridge) window.ChatSavorBridge.register(prev);
      return prev;
    }
    if (prev && typeof prev.dispose === 'function') prev.dispose();

    var excludedSelector = typeof config.excludedSelector === 'string' ? config.excludedSelector : DEFAULT_EXCLUDED_SELECTOR;
    var stopTokens = Array.isArray(config.stopTokens) ? config.stopTokens : DEFAULT_STOP_TOKENS;
    var stopSelectors = Array.isArray(config.stopSelectors) ? config.stopSelectors : DEFAULT_STOP_SELECTORS;
    var responseSelectors = Array.isArray(config.responseSelectors) ? config.responseSelectors : [];
    var turnSelectors = Array.isArray(config.turnSelectors) ? config.turnSelectors : [];
    var userSelector = config.userSelector || '';
    var streamingSelector = config.streamingSelector || '';
    var stabilityMs = typeof config.stabilityMs === 'number' ? config.stabilityMs : 1500;
    var scanIntervalMs = typeof config.scanIntervalMs === 'number' ? config.scanIntervalMs : 2000;
    var initialDelayMs = typeof config.initialDelayMs === 'number' ? config.initialDelayMs : 1000;
    var minTextLength = typeof config.minTextLength === 'number' ? config.minTextLength : 2;

    var responseState = new WeakMap();
    var timers = [];
    var routeListeners = null;
    var disposed = false;
    var cachedSelector = null;
    var lastHref = location.href;
    var activeRoute = true;

    function host() {
      return dom && typeof dom.host === 'function' ? dom.host() : location.hostname;
    }

    function route() {
      return config.isActiveRoute ? config.isActiveRoute(location) !== false : true;
    }

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      if (closest(dom, el, '[hidden], [aria-hidden="true"]')) return false;
      var view = el.ownerDocument.defaultView || window;
      var style = view.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
      if (typeof el.getClientRects === 'function' && el.getClientRects().length > 0) return true;
      // A display:contents wrapper has no box, but its reply can still be visible.
      if (style.display === 'contents') return Array.from(el.children).some(isVisible);
      return false;
    }

    function deduplicate(list) {
      var seen = new Set();
      var result = [];
      for (var i = 0; i < list.length; i++) {
        if (!seen.has(list[i])) { seen.add(list[i]); result.push(list[i]); }
      }
      return result;
    }

    function removeNested(list) {
      var result = list.filter(function (el) {
        return !list.some(function (other) { return other !== el && (dom ? dom.contains(other, el) : (other.contains && other.contains(el))); });
      });
      return result.sort(function (a, b) { return dom ? dom.compare(a, b) : 0; });
    }

    function getText(el) { return elementText(dom, el); }

    function matchesStopToken(value) {
      var normalized = (value || '').trim().toLowerCase();
      if (!normalized) return false;
      for (var i = 0; i < stopTokens.length; i++) {
        if (normalized.indexOf(stopTokens[i]) !== -1) return true;
      }
      return false;
    }

    function hasVisibleStopButton(scope) {
      var controls = queryAll(dom, 'button, [role="button"]', scope || document);
      for (var i = 0; i < controls.length; i++) {
        var control = controls[i];
        if (!isVisible(control)) continue;
        if (closest(dom, control, '.ai-saver-host, .ai-saver-modal-host')) continue;
        if (stopSelectors.some(function (sel) { return matches(control, sel); })) return true;
        var text = [control.textContent || '', control.getAttribute('aria-label') || '', control.getAttribute('title') || ''].join(' ');
        if (matchesStopToken(text)) return true;
      }
      return false;
    }

    var ctx = {
      isVisible: isVisible,
      deduplicate: deduplicate,
      removeNested: removeNested,
      getText: getText,
      hasVisibleStopButton: hasVisibleStopButton,
      host: host,
      dom: dom,
      core: core,
      config: config
    };

    function defaultResolveWrapper(el) { return el; }
    function defaultIsLikelyResponse() { return true; }
    function defaultExtractReply(el) { return core ? core.extractMarkdown(el) : null; }

    function defaultHasButton(el) {
      var direct = el && el.querySelector && el.querySelector(':scope > .ai-saver-host[data-chatsavor-owner="' + config.id + '"]');
      return !!direct || !!(el && el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('ai-saver-host'));
    }

    function defaultMountButton(el, onClick) { return core ? core.injectButtonAfter(el, onClick) : false; }

    function passesFilters(el, fromTurn) {
      if (!el || !isVisible(el)) return false;
      if (matches(el, excludedSelector) || closest(dom, el, excludedSelector)) return false;
      if (userSelector && !fromTurn && (closest(dom, el, userSelector) || el.querySelector(userSelector))) return false;
      if (getText(el).length < minTextLength) return false;
      var likely = config.isLikelyResponse || defaultIsLikelyResponse;
      return likely(el, ctx) !== false;
    }

    function normalize(candidates, fromTurn) {
      var mapped = [];
      for (var i = 0; i < candidates.length; i++) {
        var wrapped = config.resolveWrapper ? config.resolveWrapper(candidates[i], ctx) : defaultResolveWrapper(candidates[i], ctx);
        if (wrapped && !Array.isArray(wrapped)) mapped.push(wrapped);
      }
      return removeNested(deduplicate(mapped).filter(function (el) { return passesFilters(el, fromTurn); }));
    }

    function defaultFindResponses() {
      if (cachedSelector) {
        var cached = queryAll(dom, cachedSelector);
        if (cached.length) return normalize(cached, false);
        cachedSelector = null;
      }
      for (var s = 0; s < responseSelectors.length; s++) {
        var selector = responseSelectors[s];
        var found = queryAll(dom, selector);
        var normalized = normalize(found, false);
        if (normalized.length) { cachedSelector = selector; return normalized; }
      }
      var turnCandidates = [];
      turnSelectors.forEach(function (selector) { turnCandidates = turnCandidates.concat(queryAll(dom, selector)); });
      return normalize(turnCandidates, true);
    }

    function getResponses() {
      // On non-active SPA routes (e.g. x.com/home) expose no replies at all.
      if (config.isActiveRoute && !route()) return [];
      if (config.findResponses) return config.findResponses(ctx) || [];
      return defaultFindResponses();
    }

    function getTurns() {
      if (config.isActiveRoute && !route()) return [];
      if (config.getTurns) return config.getTurns(ctx) || [];
      var turns = [];
      if (userSelector) queryAll(dom, userSelector).forEach(function (el) { turns.push({ role: 'user', element: el }); });
      getResponses().forEach(function (el) { turns.push({ role: 'assistant', element: el }); });
      var seen = new Set();
      var unique = turns.filter(function (turn) {
        if (seen.has(turn.element)) return false;
        seen.add(turn.element);
        return isVisible(turn.element);
      });
      unique.sort(function (a, b) { return dom ? dom.compare(a.element, b.element) : 0; });
      return unique;
    }

    function chatRoot() {
      return config.getChatRoot ? (config.getChatRoot(ctx) || document) : document;
    }

    function inject(el) {
      var extract = config.extractReply || defaultExtractReply;
      var onClick = function () {
        var result = extract(el, ctx);
        if (result && config.extractThinking) {
          try { result.thinking = config.extractThinking(el, ctx) || ''; } catch (ignored) {}
        }
        if (result && result.markdown && core) core.showPreviewModal(result.markdown, result.thinking ? { thinking: result.thinking } : undefined);
      };
      var mount = config.mountButton || defaultMountButton;
      mount(el, onClick, ctx);
    }

    function scan(force) {
      if (disposed) return;
      // history.pushState SPA navigation fires no popstate/hashchange; poll it here.
      if (config.watchRoute) onRouteChange();
      if (!route()) return;
      var responses = getResponses();
      if (!responses.length) return;
      var generating = hasVisibleStopButton(chatRoot());
      var now = Date.now();
      for (var index = 0; index < responses.length; index++) {
        var el = responses[index];
        var hasButton = config.hasButton || defaultHasButton;
        if (hasButton(el, ctx)) continue;
        if (force === true) { inject(el); continue; }
        var text = getText(el);
        if (!text) continue;
        var streaming = streamingSelector && (closest(dom, el, streamingSelector) || queryAll(dom, streamingSelector, el).length > 0);
        var isLastGenerating = generating && index === responses.length - 1;
        var state = responseState.get(el);
        if (!state || state.text !== text || streaming || isLastGenerating) {
          responseState.set(el, { text: text, stableSince: now });
          continue;
        }
        if (now - state.stableSince >= stabilityMs) inject(el);
      }
    }

    function onRouteChange() {
      var href = location.href;
      var nowActive = route();
      if (href === lastHref && nowActive === activeRoute) return;
      var hrefChanged = href !== lastHref;
      var enteredActive = nowActive && !activeRoute;
      if (!hrefChanged && !enteredActive && nowActive === activeRoute) return;
      lastHref = href;
      activeRoute = nowActive;
      if (!activeRoute) {
        responseState = new WeakMap();
        return;
      }
      // Route just became active (or href changed while active): scan immediately.
      if (enteredActive || hrefChanged) scan(false);
    }

    function safeScan() {
      try {
        if (config.watchRoute) onRouteChange();
        scan(false);
      } catch (error) { if (window.ChatSavorBridge) window.ChatSavorBridge.recordError(error); }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
      timers = [];
      if (routeListeners) {
        window.removeEventListener('popstate', onRouteChange);
        window.removeEventListener('hashchange', onRouteChange);
        routeListeners = false;
      }
      if (window.ChatSavorAdapters[storageKey] === adapter) delete window.ChatSavorAdapters[storageKey];
    }

    var adapter = {
      platform: config.id,
      version: version,
      core: core,
      scan: scan,
      getResponses: getResponses,
      getTurns: getTurns,
      extractMarkdown: function (el) {
        var extract = config.extractReply || defaultExtractReply;
        var result = extract(el, ctx);
        if (result && config.extractThinking) {
          try { result.thinking = config.extractThinking(el, ctx) || ''; } catch (ignored) {}
        }
        return result;
      },
      diagnostics: function () { return config.diagnostics ? config.diagnostics(ctx) : {}; },
      dispose: dispose
    };

    activeRoute = route();
    window.ChatSavorAdapters[storageKey] = adapter;
    if (window.ChatSavorBridge) window.ChatSavorBridge.register(adapter);

    if (config.watchRoute) {
      window.addEventListener('popstate', onRouteChange);
      window.addEventListener('hashchange', onRouteChange);
      routeListeners = true;
    }
    timers.push(setTimeout(safeScan, initialDelayMs));
    timers.push(setInterval(safeScan, scanIntervalMs));
    return adapter;
  }

  window.ChatSavorPlatform = { create: create };
})();
