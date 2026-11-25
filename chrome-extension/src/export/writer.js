// ChatSavor — writer page: one-time permission grant then write the queued bundle.
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = params.get('id') || '';
  var vault = globalThis.ChatSavorFsVault;
  var hint = document.getElementById('hint');
  var status = document.getElementById('status');
  var primary = document.getElementById('primary');
  var replaceBtn = document.getElementById('replace');
  var payload = null;
  var cachedHandle = null;

  function readPayload() {
    return new Promise(function(resolve) {
      try {
        if (!chrome.storage || !chrome.storage.session) { resolve(null); return; }
        var key = {}; key[id] = null;
        chrome.storage.session.get(key, function(result) { resolve(result && result[id] || null); });
      } catch (ignored) { resolve(null); }
    });
  }

  function toBytes(b64) {
    if (!b64) return new Uint8Array(0);
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function performWrite(handle) {
    if (!handle) { status.textContent = '未能获取文件夹句柄。'; return; }
    var assets = (payload.assets || []).map(function(a) {
      return { name: a.name, bytes: toBytes(a.base64), mimeType: a.mimeType, originalPath: a.path };
    });
    vault.writeBundleToDirectory(handle, payload.subDir, payload.filename, payload.markdown, assets, payload.filename)
      .then(function(result) {
        status.textContent = '✅ 已保存：' + (payload.subDir ? payload.subDir + '/' : '') + result.filename +
          '（含 ' + result.assets + ' 张离线图片），后续导出将自动静默保存！';
        try { chrome.storage.session.remove(id); } catch (ignored) {}
      }).catch(function(error) { status.textContent = '写入失败：' + (error && error.message || error); });
  }

  function write() {
    if (!payload || !vault) return;
    // Use the cached handle directly inside the click gesture to preserve User Activation.
    if (cachedHandle) {
      if (cachedHandle.requestPermission) {
        cachedHandle.requestPermission({ mode: 'readwrite' }).then(function(perm) {
          if (perm === 'granted') performWrite(cachedHandle);
          else { cachedHandle = null; status.textContent = '未授予权限，请重新点击选择文件夹。'; }
        }).catch(function(error) { status.textContent = '授权失败：' + (error && error.message || error); });
      } else {
        performWrite(cachedHandle);
      }
      return;
    }
    if (typeof window.showDirectoryPicker !== 'function') { status.textContent = '当前浏览器不支持文件夹选择器。'; return; }
    window.showDirectoryPicker({ mode: 'readwrite' }).then(function(picked) {
      cachedHandle = picked;
      return vault.saveDirectoryHandle(picked);
    }).then(function() { performWrite(cachedHandle); })
      .catch(function(error) { status.textContent = '授权失败：' + (error && error.message || error); });
  }

  readPayload().then(function(result) {
    payload = result;
    if (!payload) { hint.textContent = '未找到待保存内容，请从预览弹窗重新点击“保存到本地库”。'; primary.disabled = true; return; }
    hint.textContent = '目标：' + (payload.subDir || '库根目录') + '/' + payload.filename +
      '（含 ' + (payload.assets || []).length + ' 张图片）';
    // Cache the handle at init so the click handler needs no async IndexedDB round-trip.
    vault.getDirectoryHandle().then(function(handle) {
      cachedHandle = handle || null;
      if (cachedHandle && cachedHandle.name && cachedHandle.queryPermission) {
        return cachedHandle.queryPermission({ mode: 'readwrite' }).then(function(perm) {
          primary.textContent = perm === 'granted' ? '🔓 授权并写入本地文件夹（' + cachedHandle.name + '）' :
            '🔓 授权并写入本地文件夹（' + cachedHandle.name + '）';
        });
      }
    }).catch(function() {});
    primary.addEventListener('click', write);
    replaceBtn.addEventListener('click', function() {
      vault.clearDirectoryHandle().then(function() {
        cachedHandle = null;
        if (typeof window.showDirectoryPicker === 'function') {
          window.showDirectoryPicker({ mode: 'readwrite' }).then(function(picked) {
            cachedHandle = picked;
            return vault.saveDirectoryHandle(picked);
          }).then(function() { status.textContent = '已更换文件夹，请再次点击主按钮写入。'; });
        }
      });
    });
  });
})();
