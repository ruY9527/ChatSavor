// Restore already-open ChatGPT tabs after install/reload; never reload the web page.
if (typeof importScripts === 'function') importScripts('connection.js');
(function() {
  'use strict';
  var manifest = chrome.runtime.getManifest();
  var connection = ChatSavorConnection(chrome);
  var pending = new Map();
  var reports = new Map();
  var matches = ['*://chatgpt.com/*', '*://chat.openai.com/*'];

  function isChatGPT(url) {
    try {
      var parsed = new URL(url);
      return /^https?:$/.test(parsed.protocol) && (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com');
    } catch (ignored) { return false; }
  }

  function connectTab(tabId, force) {
    if (pending.has(tabId)) return pending.get(tabId);
    var job = (async function() {
      try {
        var response = await connection.connect(tabId, { force: force === true });
        reports.set(tabId, { ok: true, version: manifest.version, frameId: response.frameId, frames: response.frames });
      } catch (error) {
        var message = String(error.message || error).replace(/https?:\/\/[^\s"'<>]+/gi, function(url) {
          try { return new URL(url).origin + '/[redacted]'; } catch (ignored) { return '[redacted URL]'; }
        });
        reports.set(tabId, { ok: false, error: message });
      } finally { pending.delete(tabId); }
    })();
    pending.set(tabId, job);
    return job;
  }

  async function restoreOpenTabs(force) {
    try {
      var tabs = await chrome.tabs.query({ url: matches });
      await Promise.all(tabs.filter(function(tab) { return isChatGPT(tab.url) && !tab.discarded; }).map(function(tab) { return connectTab(tab.id, force === true); }));
    } catch (error) { console.warn('[ChatSavor] Could not restore open ChatGPT tabs:', error.message); }
  }

  chrome.runtime.onInstalled.addListener(function() { return restoreOpenTabs(true); });
  chrome.runtime.onStartup.addListener(function() { return restoreOpenTabs(false); });
  chrome.tabs.onUpdated.addListener(function(tabId, change, tab) {
    if (change.status === 'complete' && isChatGPT(tab.url)) connectTab(tabId);
  });
  chrome.tabs.onRemoved.addListener(function(tabId) { reports.delete(tabId); });
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message && message.type === 'CHATSAVOR_CONNECTION_REPORT') sendResponse(reports.get(message.tabId) || null);
  });
})();
