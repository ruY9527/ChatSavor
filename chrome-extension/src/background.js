// Restore already-open supported tabs after install/reload; never reload the web page.
if (typeof importScripts === 'function') importScripts('connection.js', 'lib/fs-vault.js');
(function() {
  'use strict';
  var manifest = chrome.runtime.getManifest();
  var connection = ChatSavorConnection(chrome);
  var pending = new Map();
  var reports = new Map();
  // Single source of truth for supported hosts: the manifest content-script matches.
  var matches = (manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].matches) || [];

  function matchPatternToHost(pattern) {
    // Supports *://host/*, https://host/*, https://*.host/* patterns used by the manifest.
    try {
      var m = /^[a-z*]+:\/\/(\*\.|)([^/]+)\/\*$/i.exec(pattern);
      if (!m) return null;
      return { wildcard: m[1] === '*.', host: m[2].toLowerCase() };
    } catch (ignored) { return null; }
  }

  function isSupportedUrl(url) {
    try {
      var parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return false;
      var hostname = parsed.hostname.toLowerCase();
      return matches.some(function(pattern) {
        var rule = matchPatternToHost(pattern);
        if (!rule) return false;
        return rule.wildcard ? (hostname === rule.host || hostname.slice(-(rule.host.length + 1)) === '.' + rule.host) : hostname === rule.host;
      });
    } catch (ignored) { return false; }
  }

  function saveReport(tabId, report) {
    reports.set(tabId, report);
    try {
      if (chrome.storage && chrome.storage.session) {
        var key = 'report_' + tabId;
        var payload = {};
        payload[key] = report;
        chrome.storage.session.set(payload);
      }
    } catch (ignored) {}
  }

  function getReport(tabId, callback) {
    if (reports.has(tabId)) { callback(reports.get(tabId)); return; }
    try {
      if (chrome.storage && chrome.storage.session && chrome.storage.session.get) {
        var key = 'report_' + tabId;
        var payload = {};
        payload[key] = null;
        chrome.storage.session.get(payload, function(result) { callback(result && result[key] || null); });
        return;
      }
    } catch (ignored) {}
    callback(null);
  }

  function connectTab(tabId, force) {
    if (pending.has(tabId)) return pending.get(tabId);
    var job = (async function() {
      try {
        var response = await connection.connect(tabId, { force: force === true });
        saveReport(tabId, { ok: true, version: manifest.version, frameId: response.frameId, frames: response.frames });
      } catch (error) {
        var message = String(error.message || error).replace(/https?:\/\/[^\s"'<>]+/gi, function(url) {
          try { return new URL(url).origin + '/[redacted]'; } catch (ignored) { return '[redacted URL]'; }
        });
        saveReport(tabId, { ok: false, error: message });
      } finally { pending.delete(tabId); }
    })();
    pending.set(tabId, job);
    return job;
  }

  async function restoreOpenTabs(force) {
    try {
      var query = matches.length ? { url: matches } : {};
      var tabs = await chrome.tabs.query(query);
      await Promise.all(tabs.filter(function(tab) { return isSupportedUrl(tab.url) && !tab.discarded; }).map(function(tab) { return connectTab(tab.id, force === true); }));
    } catch (error) { console.warn('[ChatSavor] Could not restore open tabs:', error.message); }
  }

  chrome.runtime.onInstalled.addListener(function() { return restoreOpenTabs(true); });
  chrome.runtime.onStartup.addListener(function() { return restoreOpenTabs(false); });
  chrome.tabs.onUpdated.addListener(function(tabId, change, tab) {
    if (change.status === 'complete' && isSupportedUrl(tab.url)) connectTab(tabId);
  });
  chrome.tabs.onRemoved.addListener(function(tabId) {
    reports.delete(tabId);
    try {
      if (chrome.storage && chrome.storage.session && chrome.storage.session.remove) chrome.storage.session.remove('report_' + tabId);
    } catch (ignored) {}
  });
  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  }

  function looksLikeImage(bytes, contentType) {
    if (/^image\//i.test(contentType || '')) return true;
    if (!bytes || bytes.length < 12) return false;
    // PNG / JPEG / GIF / WEBP / SVG (text) magic numbers.
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
    return false;
  }

  function fetchRemoteImage(url, sendResponse) {
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        sendResponse({ ok: false, error: 'unsupported protocol' });
        return;
      }
      if (typeof fetch !== 'function') { sendResponse({ ok: false, error: 'fetch unavailable' }); return; }
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function() { controller.abort(); }, 8000) : null;
      fetch(parsed.href, {
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined,
      }).then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var contentType = ((response.headers && response.headers.get('content-type')) || '').split(';')[0].trim().toLowerCase();
        var len = parseInt(((response.headers && response.headers.get('content-length')) || '0'), 10) || 0;
        if (len > 15 * 1024 * 1024) throw new Error('image too large');
        return response.arrayBuffer().then(function(buffer) { return { buffer: buffer, contentType: contentType }; });
      }).then(function(result) {
        if (timer) clearTimeout(timer);
        if (!result.buffer || result.buffer.byteLength > 15 * 1024 * 1024) throw new Error('image too large');
        var bytes = new Uint8Array(result.buffer);
        if (!looksLikeImage(bytes, result.contentType)) throw new Error('not an image');
        var contentType = result.contentType;
        if (!/^image\//i.test(contentType)) {
          // Infer from magic bytes when the server sent a generic/wrong MIME.
          contentType = bytes[0] === 0x89 ? 'image/png' : (bytes[0] === 0xFF ? 'image/jpeg' :
            (bytes[0] === 0x47 ? 'image/gif' : (bytes[8] === 0x57 ? 'image/webp' : 'image/png')));
        }
        sendResponse({ ok: true, base64: toBase64(result.buffer), contentType: contentType });
      }).catch(function(error) {
        if (timer) clearTimeout(timer);
        sendResponse({ ok: false, error: String(error && error.message || error) });
      });
    } catch (error) {
      sendResponse({ ok: false, error: String(error && error.message || error) });
    }
  }

  function toBytes(b64) {
    if (!b64) return new Uint8Array(0);
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function saveToVault(message, sendResponse) {
    var vault = globalThis.ChatSavorFsVault;
    function promptUser() {
      var token = 'vault_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      try {
        if (chrome.storage && chrome.storage.session && chrome.storage.session.set) {
          var payload = {};
          payload[token] = {
            subDir: message.subDir || '', filename: message.filename || 'note.md',
            markdown: message.markdown || '', assets: message.assets || [],
          };
          chrome.storage.session.set(payload, function() {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/export/writer.html?id=' + encodeURIComponent(token)) });
            sendResponse({ ok: true, mode: 'prompt', token: token });
          });
          return;
        }
      } catch (ignored) {}
      chrome.tabs.create({ url: chrome.runtime.getURL('src/export/writer.html?id=' + encodeURIComponent(token)) });
      sendResponse({ ok: true, mode: 'prompt', token: token });
    }
    if (!vault || typeof vault.getDirectoryHandle !== 'function') { promptUser(); return; }
    vault.getDirectoryHandle().then(function(handle) {
      if (!handle || !handle.queryPermission) { promptUser(); return null; }
      return handle.queryPermission({ mode: 'readwrite' }).then(function(perm) {
        if (perm !== 'granted') { promptUser(); return null; }
        return handle;
      });
    }).then(function(handle) {
      if (!handle) return;
      var assets = (message.assets || []).map(function(a) {
        return { name: a.name, bytes: toBytes(a.base64), mimeType: a.mimeType, originalPath: a.path };
      });
      return vault.writeBundleToDirectory(handle, message.subDir || '', message.filename || 'note.md',
        message.markdown || '', assets, message.filename).then(function(result) {
        sendResponse({ ok: true, mode: 'silent', filename: result.filename, assets: result.assets });
      }).catch(function(error) { sendResponse({ ok: false, error: String(error && error.message || error) }); });
    }).catch(function(error) { sendResponse({ ok: false, error: String(error && error.message || error) }); });
  }

  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message && message.type === 'CHATSAVOR_SAVE_TO_VAULT') {
      saveToVault(message, sendResponse);
      return true;
    }
    if (message && message.type === 'CHATSAVOR_FETCH_IMAGE') {
      fetchRemoteImage(message.url, sendResponse);
      return true; // async channel
    }
    if (message && message.type === 'CHATSAVOR_OPEN_PRINT') {
      var token = 'print_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      function openPrintPage() {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/export/print.html?id=' + encodeURIComponent(token)) });
        sendResponse({ ok: true, token: token });
      }
      try {
        if (chrome.storage && chrome.storage.session && chrome.storage.session.set) {
          var payload = {};
          payload[token] = message.payload || {};
          chrome.storage.session.set(payload, openPrintPage);
          return true; // channel stays open until the payload is persisted
        }
      } catch (ignored) {}
      openPrintPage();
      return true;
    }
    if (message && message.type === 'CHATSAVOR_CONNECTION_REPORT') {
      getReport(message.tabId, sendResponse);
      return true; // keep the message channel open for async storage.session reads
    }
  });
})();
