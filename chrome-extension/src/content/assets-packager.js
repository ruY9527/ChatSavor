// ChatSavor — offline assets collector & packager (content-script side).
// Exposed as window.ChatSavorAssets.
(function () {
  'use strict';

  var EXT = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

  function decodeBase64(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function extFor(mime, url) {
    var m = String(mime || '').split(';')[0].trim().toLowerCase();
    if (EXT[m]) return EXT[m];
    if (/\.svg(?:\?|$)/i.test(url)) return 'svg';
    if (/\.jpe?g(?:\?|$)/i.test(url)) return 'jpg';
    if (/\.webp(?:\?|$)/i.test(url)) return 'webp';
    if (/\.gif(?:\?|$)/i.test(url)) return 'gif';
    return 'png';
  }

  function collectUrls(markdown) {
    var urls = [];
    var seen = new Set();
    var re = /!\[[^\]]*\]\(<?\s*([^\s)]+)\s*>?\)/g;
    var match;
    while ((match = re.exec(markdown))) {
      if (!seen.has(match[1])) { seen.add(match[1]); urls.push(match[1]); }
    }
    var htmlRe = /<img[^>]+src=["']([^"']+)["']/gi;
    while ((match = htmlRe.exec(markdown))) {
      if (!seen.has(match[1])) { seen.add(match[1]); urls.push(match[1]); }
    }
    return urls;
  }

  function fetchRemote(url) {
    return new Promise(function(resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) { resolve(null); return; }
        chrome.runtime.sendMessage({ type: 'CHATSAVOR_FETCH_IMAGE', url: url }, function(response) {
          if (response && response.ok && response.base64) resolve({ bytes: decodeBase64(response.base64), mimeType: response.contentType || 'image/png' });
          else resolve(null);
        });
      } catch (ignored) { resolve(null); }
    });
  }

  function collectAndFetchAssets(markdown, options) {
    options = options || {};
    var urls = collectUrls(String(markdown || ''));
    var assets = [];
    var stats = { total: urls.length, fetched: 0, failed: 0 };
    var rewritten = String(markdown || '');
    var chain = Promise.resolve();
    urls.forEach(function(url, idx) {
      chain = chain.then(function() {
        var bytes = null;
        var mimeType = '';
        if (/^data:image\//i.test(url)) {
          var comma = url.indexOf(',');
          if (comma < 0) return null;
          var meta = url.slice(0, comma);
          mimeType = meta.replace(/^data:/i, '').split(';')[0];
          if (mimeType !== 'image/svg+xml' && !/^image\//i.test(mimeType)) return null;
          bytes = /;base64/i.test(meta) ? decodeBase64(url.slice(comma + 1)) : window.ChatSavorZip.utf8(decodeURIComponent(url.slice(comma + 1)));
          return { bytes: bytes, mimeType: mimeType };
        }
        if (/^https?:\/\//i.test(url)) return fetchRemote(url);
        return null;
      }).then(function(result) {
        if (!result || !result.bytes) { stats.failed++; return; }
        var number = String(assets.length + 1).padStart(2, '0');
        var name = 'fig_' + number + '.' + extFor(result.mimeType, url);
        var path = 'assets/' + name;
        assets.push({ name: name, path: path, bytes: result.bytes, mimeType: result.mimeType, originalUrl: url });
        rewritten = rewritten.split(url).join('./' + path);
        stats.fetched++;
      });
    });
    return chain.then(function() { return { markdown: rewritten, assets: assets, stats: stats }; });
  }

  function buildMarkdownZip(markdown, pageMeta, includeFrontmatter) {
    return collectAndFetchAssets(markdown).then(function(result) {
      var metaApi = window.ChatSavorMeta;
      var finalMd = result.markdown;
      var base = metaApi ? metaApi.buildFilename(pageMeta || {}, 'md').replace(/\.md$/, '') : 'ai-response';
      if (includeFrontmatter && metaApi) finalMd = metaApi.withFrontmatter(finalMd, pageMeta, true);
      var entries = [{ name: base + '.md', data: finalMd }].concat(result.assets.map(function(a) {
        return { name: a.path, data: a.bytes };
      }));
      var zipApi = window.ChatSavorZip;
      var blob = zipApi ? zipApi.pack(entries, 'application/zip') : new Blob([]);
      return { blob: blob, filename: base + '.zip', stats: result.stats, markdown: finalMd, assets: result.assets };
    });
  }

  function inlineAllImagesForHtml(html) {
    var holder = document.createElement('div');
    holder.innerHTML = String(html || '');
    var imgs = Array.from(holder.querySelectorAll('img[src^="http"]'));
    var chain = Promise.resolve();
    imgs.forEach(function(img) {
      chain = chain.then(function() {
        return fetchRemote(img.getAttribute('src')).then(function(result) {
          if (result && result.bytes) {
            var bin = '';
            for (var i = 0; i < result.bytes.length; i++) bin += String.fromCharCode(result.bytes[i]);
            img.setAttribute('src', 'data:' + result.mimeType + ';base64,' + btoa(bin));
          }
        });
      });
    });
    return chain.then(function() { return holder.innerHTML; });
  }

  window.ChatSavorAssets = {
    collectAndFetchAssets: collectAndFetchAssets,
    buildMarkdownZip: buildMarkdownZip,
    inlineAllImagesForHtml: inlineAllImagesForHtml,
    decodeBase64: decodeBase64,
  };
})();
