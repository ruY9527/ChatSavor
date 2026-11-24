// Restore already-open supported tabs after install/reload; never reload the web page.
if (typeof importScripts === 'function') importScripts('connection.js');
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
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
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
