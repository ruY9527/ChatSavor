// Use explicit frame IDs: broadcasting a message can return an empty outer frame first.
globalThis.ChatSavorConnection = function(api) {
  'use strict';
  var manifest = api.runtime.getManifest();

  function healthy(response) {
    var status = response && response.status;
    if (!response || !response.ok || !status) return false;
    // All supported pages — including generic — register an adapter now.
    return status.version === manifest.version && status.coreReady && status.markdownReady && !!status.adapter;
  }

  async function execute(tabId, payload) {
    try { return await api.scripting.executeScript(Object.assign({ target: { tabId: tabId, allFrames: true } }, payload)); }
    catch (error) {
      // An inaccessible third-party iframe must not prevent the main document from working.
      return api.scripting.executeScript(Object.assign({ target: { tabId: tabId, frameIds: [0] } }, payload));
    }
  }

  async function probe(tabId) {
    var result = await execute(tabId, { func: function() {
      try {
        var response = window.ChatSavorBridge ? window.ChatSavorBridge.handle('STATUS') : { ok: false, unconnected: true, host: location.hostname };
        if (response.status && !response.status.responseCount) {
          var dom = window.ChatSavorDOM;
          var scopes = dom ? dom.roots() : [document];
          function shape(node) {
            var record = { tag: node.tagName.toLowerCase(), classes: typeof node.className === 'string' ? node.className.slice(0, 240) : '' };
            ['role', 'data-testid', 'data-role', 'data-author', 'data-message-type', 'data-message-role', 'data-sender', 'data-turn'].forEach(function(name) {
              var value = node.getAttribute(name);
              if (value) record[name] = value.slice(0, 100);
            });
            ['data-assistant-markdown', 'data-markdown-text-style', 'data-conversation-role', 'data-conversation-transcript', 'data-user-message-bubble', 'data-turn-key', 'data-chatgpt-selection-message-id', 'data-content-search-unit-key', 'data-chatgpt-search-unit-key'].forEach(function(name) {
              if (!node.hasAttribute(name)) return;
              var value = node.getAttribute(name);
              record[name] = /unit-key$/.test(name) ? '…:' + value.split(':').pop() : /turn-key|message-id/.test(name) ? true : value || true;
            });
            return record;
          }
          var mains = [];
          scopes.forEach(function(root) { mains = mains.concat(Array.from(root.querySelectorAll('main, [role="main"]'))); });
          var nodes = [];
          mains.forEach(function(main) { nodes = nodes.concat(Array.from(main.querySelectorAll('p, pre, table, h1, h2, h3, [dir="auto"], [data-message-content]'))); });
          var samples = nodes.filter(function(node) {
            return !node.closest('.ai-saver-host, .ai-saver-modal-host, form, nav') && (node.textContent || '').trim().length > 0;
          }).slice(0, 20).map(function(node) {
            var chain = [];
            for (var current = node; current && chain.length < 7; current = dom ? dom.parent(current) : current.parentElement) chain.push(shape(current));
            return { textLength: (node.textContent || '').trim().length, ancestors: chain };
          });
          response.status.markup = {
            samples: samples,
            mainTree: mains.slice(0, 2).map(function(main) {
              return Array.from(main.querySelectorAll('*')).filter(function(node) { return !node.matches('script, style, svg, path, use') && !node.closest('.ai-saver-host, .ai-saver-modal-host'); }).slice(0, 100).map(shape);
            }),
            actions: mains.flatMap(function(main) { return Array.from(main.querySelectorAll('button, [role="button"]')); }).slice(0, 30).map(function(node) {
              var record = shape(node);
              var label = node.getAttribute('aria-label') || node.getAttribute('title') || '';
              if (/^(?:copy|复制|edit|编辑|good response|bad response|read aloud|朗读|retry|重试)/i.test(label)) record.action = label.slice(0, 60);
              return record;
            })
          };
        }
        return response;
      }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    } });
    return (result || []).map(function(item) {
      var response = item.result;
      if (response && response.error) {
        // A failing cross-origin child frame must not block scoring of healthy frames.
        console.warn('[ChatSavor] Frame ' + item.frameId + ' probe error: ' + String(response.error).slice(0, 160));
      }
      return { frameId: item.frameId, response: response };
    });
  }

  async function connect(tabId, options) {
    options = options || {};
    var frames = options.force ? [] : await probe(tabId);
    var ready = frames.filter(function(item) { return healthy(item.response); });
    var repliesFound = ready.some(function(item) { return item.response.status.responseCount > 0; });
    var missingFrame = frames.some(function(item) { return !item.response || item.response.unconnected; });
    if (options.force || !ready.length || (!repliesFound && missingFrame)) {
      await execute(tabId, { files: manifest.content_scripts[0].js });
      frames = await probe(tabId);
      ready = frames.filter(function(item) { return healthy(item.response); });
    }
    if (!ready.length) throw new Error('网页转换脚本没有完整加载，请复制检测结果。');
    // Start scanning in each document, while keeping each conversion command in its own frame.
    await Promise.all(ready.map(async function(item) {
      try {
        var response = await api.tabs.sendMessage(tabId, { type: 'CHATSAVOR_COMMAND', command: 'CONNECT' }, { frameId: item.frameId });
        if (response && response.status) item.response = preserveMarkup(response, item.response);
      } catch (ignored) {}
    }));
    function score(item) {
      var status = item.response.status;
      return (options.command === 'SELECTION' && status.selectionAvailable ? 1000000 : 0) +
        (status.responseCount || 0) * 1000 + (status.buttonCount || 0) * 10 + (status.adapter && status.adapter !== 'generic' ? 1 : 0);
    }
    ready.sort(function(a, b) { return score(b) - score(a) || a.frameId - b.frameId; });
    var selected = ready[0];
    var response = selected.response;
    if (options.command && options.command !== 'STATUS' && options.command !== 'CONNECT') {
      response = preserveMarkup(await api.tabs.sendMessage(tabId, { type: 'CHATSAVOR_COMMAND', command: options.command }, { frameId: selected.frameId }), response);
    }
    response = Object.assign({}, response, { frameId: selected.frameId, frames: frames.map(function(item) {
      var status = item.response && item.response.status;
      return { frameId: item.frameId, version: status && status.version, host: status ? status.host : item.response && item.response.host, responseCount: status && status.responseCount || 0, buttonCount: status && status.buttonCount || 0, structure: status && status.structure };
    }) });
    return response;
  }

  function preserveMarkup(response, previous) {
    // Runtime replies contain a fresh status object; keep the probe's structural evidence.
    if (response && response.status && !response.status.responseCount && previous && previous.status && previous.status.markup) {
      return Object.assign({}, response, { status: Object.assign({}, response.status, { markup: previous.status.markup }) });
    }
    return response;
  }

  return { connect: connect, healthy: healthy };
};
