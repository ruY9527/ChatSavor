// ChatSavor — shared FileSystemDirectoryHandle store & writer (MV3).
// Exposed as globalThis.ChatSavorFsVault. Uses IndexedDB 'chatsavor_fs'.
(function () {
  'use strict';

  var DB = 'chatsavor_fs';
  var STORE = 'handles';
  var KEY = 'vaultRoot';

  function openDb() {
    return new Promise(function(resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error || new Error('indexedDB open failed')); };
    });
  }

  function getDirectoryHandle() {
    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function() { reject(req.error || new Error('read failed')); };
      });
    });
  }

  function saveDirectoryHandle(handle) {
    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, KEY);
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { reject(tx.error || new Error('write failed')); };
      });
    });
  }

  function clearDirectoryHandle() {
    return openDb().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { reject(tx.error || new Error('delete failed')); };
      });
    });
  }

  function safeSegments(subDir) {
    return String(subDir || '').split('/').filter(function(seg) {
      return seg && seg !== '..' && seg !== '.' && seg.indexOf('\\') === -1;
    });
  }

  function writeBytes(handle, name, data) {
    return handle.getFileHandle(name, { create: true }).then(function(fileHandle) {
      return fileHandle.createWritable().then(function(writable) {
        return writable.write(data).then(function() { return writable.close(); });
      });
    });
  }

  // assets: [{ name, bytes (Uint8Array|ArrayBuffer|string), slug? }]
  function writeBundleToDirectory(rootHandle, subDir, mdFilename, mdContent, assets, noteSlug) {
    if (!rootHandle || typeof rootHandle.getDirectoryHandle !== 'function') return Promise.reject(new Error('no root handle'));
    var target = rootHandle;
    var segments = safeSegments(subDir);
    var chain = Promise.resolve(target);
    segments.forEach(function(seg) {
      chain = chain.then(function(dir) { return dir.getDirectoryHandle(seg, { create: true }); });
    });
    return chain.then(function(dir) {
      var slug = String(noteSlug || mdFilename || 'note').replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]/g, '_') || 'note';
      var rewritten = String(mdContent || '');
      var jobs = [];
      var assetsReady = Promise.resolve();
      if (assets && assets.length) {
        assetsReady = dir.getDirectoryHandle('assets', { create: true }).then(function(assetsDir) {
          return Promise.all(assets.map(function(asset, idx) {
            var base = String(asset.name || ('fig_' + (idx + 1) + '.png')).replace(/^.*\//, '');
            var prefixed = slug + '_' + base;
            if (asset.originalPath) {
              var cleanOrig = String(asset.originalPath).replace(/^\.\//, '');
              rewritten = rewritten.split('./' + cleanOrig).join('./assets/' + prefixed);
              var escaped = cleanOrig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              rewritten = rewritten.replace(new RegExp('(^|[(" \'\\n])' + escaped, 'g'), '$1./assets/' + prefixed);
            }
            return writeBytes(assetsDir, prefixed, asset.bytes);
          }));
        });
      }
      // Write the markdown only after asset paths have been rewritten.
      jobs.push(assetsReady.then(function() { return writeBytes(dir, mdFilename, rewritten); }));
      return Promise.all(jobs).then(function() { return { filename: mdFilename, assets: (assets || []).length }; });
    });
  }

  globalThis.ChatSavorFsVault = {
    getDirectoryHandle: getDirectoryHandle,
    saveDirectoryHandle: saveDirectoryHandle,
    clearDirectoryHandle: clearDirectoryHandle,
    writeBundleToDirectory: writeBundleToDirectory,
    safeSegments: safeSegments,
  };
})();
