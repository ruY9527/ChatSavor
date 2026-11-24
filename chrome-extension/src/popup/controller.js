(function() {
  'use strict';
  var tab;
  var lastStatus;
  var lastError;
  var lastFrames = [];
  var connection = ChatSavorConnection(chrome);
  var busy = false;
  var manifest = chrome.runtime.getManifest();
  var statusText = document.getElementById('page-status');
  var detailText = document.getElementById('page-detail');
  var buttons = Array.from(document.querySelectorAll('button'));
  document.getElementById('version').textContent = manifest.version;

  function displayStatus(status) {
    lastStatus = status;
    if (!status.coreReady || !status.markdownReady) statusText.textContent = '转换脚本加载不完整';
    else if (!status.adapter) statusText.textContent = '网页已连接，但回复识别模块未加载';
    else if (!status.responseCount) statusText.textContent = '网页已连接，暂未识别到回复';
    else statusText.textContent = '已识别 ' + status.responseCount + ' 条回复，' + status.buttonCount + ' 个回复转换按钮';
    detailText.textContent = status.host + ' · 页面脚本 ' + status.version;
  }

  function cleanError(error) {
    return String(error && error.message || error).replace(/https?:\/\/[^\s"'<>]+/gi, function(url) {
      try { return new URL(url).origin + '/[redacted]'; } catch (ignored) { return '[redacted URL]'; }
    });
  }

  async function run(action) {
    if (busy) return;
    busy = true; buttons.forEach(function(button) { button.disabled = true; });
    try { await action(); }
    catch (error) { lastError = cleanError(error); statusText.textContent = '操作未完成'; detailText.textContent = lastError; }
    finally { busy = false; buttons.forEach(function(button) { button.disabled = false; }); }
  }

  async function command(value, reconnect) {
    if (!tab || !/^https?:\/\//.test(tab.url || '')) throw new Error('请先切换到支持的 AI 对话网页（如 ChatGPT、DeepSeek、Gemini 等），再打开扩展。');
    var response = await connection.connect(tab.id, { command: value, force: reconnect === true });
    lastFrames = response.frames || [];
    if (response.status) lastStatus = response.status;
    if (!response.ok) throw new Error(response.error);
    if (response.status) displayStatus(response.status);
    lastError = null;
    if (response.converted) window.close();
  }

  document.getElementById('scan-page').addEventListener('click', function() { run(function() { return command('SCAN', true); }); });
  document.getElementById('convert-latest').addEventListener('click', function() { run(function() { return command('LATEST'); }); });
  document.getElementById('convert-selection').addEventListener('click', function() { run(function() { return command('SELECTION'); }); });
  document.getElementById('export-all').addEventListener('click', function() { run(function() { return command('EXPORT_ALL'); }); });
  document.getElementById('multi-select').addEventListener('click', function() {
    run(async function() {
      await command('TOGGLE_SELECT_MODE');
      window.close();
    });
  });
  document.getElementById('copy-diagnostics').addEventListener('click', function() {
    run(async function() {
      try { await command('STATUS'); } catch (error) { lastError = cleanError(error); }
      var host = null;
      try { host = new URL(tab.url).hostname; } catch (ignored) {}
      var report = { extensionVersion: manifest.version, host: host, page: lastStatus || null, frames: lastFrames, connectionError: lastError || null };
      if (chrome.runtime.sendMessage && tab) {
        try { report.recovery = await chrome.runtime.sendMessage({ type: 'CHATSAVOR_CONNECTION_REPORT', tabId: tab.id }); } catch (ignored) {}
      }
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      detailText.textContent = '检测结果已复制，可粘贴给开发者；不含聊天文字和对话网址。';
    });
  });
  run(async function() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
    await command('STATUS');
  });
})();
