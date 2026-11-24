// ChatSavor — page metadata, smart filenames and Obsidian frontmatter
// Exposed as window.ChatSavorMeta. Loaded before core.js.
(function () {
  'use strict';

  var PLATFORM_NAMES = {
    chatgpt: 'ChatGPT', deepseek: 'DeepSeek', gemini: 'Gemini', doubao: 'Doubao',
    kimi: 'Kimi', chatglm: 'ChatGLM', tongyi: 'Tongyi', qwen: 'Qwen',
    yuanbao: 'Yuanbao', grok: 'Grok', claude: 'Claude', perplexity: 'Perplexity',
    poe: 'Poe', aistudio: 'AIStudio', generic: 'AI',
  };
  var TITLE_SUFFIXES = [
    / - ChatGPT\s*$/, / \| DeepSeek\s*$/, / - DeepSeek\s*$/, / - Gemini\s*$/,
    / - 豆包\s*$/, / - Kimi\s*$/, / - 腾讯元宝\s*$/, / - Grok\s*$/, / \| Claude\s*$/,
  ];
  var GENERIC_TITLES = /^(?:ChatGPT|新对话|New chat|AI Response|Untitled|对话|未命名)$/i;

  function firstMeaningfulLine(markdown) {
    var lines = String(markdown || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^[#>\s*-]+/, '').replace(/[*_`]/g, '').trim();
      if (line) return line;
    }
    return '';
  }

  function currentPlatform() {
    var bridge = window.ChatSavorBridge;
    var adapter = bridge && typeof bridge.status === 'function' ? bridge.status().adapter : null;
    if (adapter) return adapter;
    var host = '';
    try { host = location.hostname || ''; } catch (ignored) {}
    if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'deepseek.com' || host.slice(-13) === '.deepseek.com') return 'deepseek';
    if (host === 'doubao.com' || host.slice(-11) === '.doubao.com') return 'doubao';
    if (host === 'kimi.com' || host.slice(-9) === '.kimi.com' || host === 'kimi.moonshot.cn') return 'kimi';
    if (host === 'yuanbao.tencent.com' || host.slice(-20) === '.yuanbao.tencent.com') return 'yuanbao';
    if (host === 'grok.com' || host.slice(-9) === '.grok.com' || host === 'x.com') return 'grok';
    if (host === 'chatglm.cn' || host.slice(-11) === '.chatglm.cn') return 'chatglm';
    if (host === 'tongyi.aliyun.com' || host.slice(-18) === '.tongyi.aliyun.com') return 'tongyi';
    if (host === 'qwen.ai' || host.slice(-8) === '.qwen.ai') return 'qwen';
    return null;
  }

  function getPageMeta(platformId, markdown) {
    var rawTitle = (document.title || '').trim();
    TITLE_SUFFIXES.forEach(function (pattern) { rawTitle = rawTitle.replace(pattern, ''); });
    rawTitle = rawTitle.trim();
    if (!rawTitle || GENERIC_TITLES.test(rawTitle)) rawTitle = firstMeaningfulLine(markdown);
    if (!rawTitle) rawTitle = String(markdown || '').replace(/[#>*_`\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!rawTitle) rawTitle = 'AI Response';

    var id = platformId || currentPlatform() || 'generic';
    var now = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    var date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var time = date + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    var origin = '';
    var pathname = '';
    try { origin = location.origin || ''; pathname = location.pathname || ''; } catch (ignored) {}
    return {
      title: rawTitle,
      date: date,
      datetime: time,
      platform: PLATFORM_NAMES[id] || id,
      platformId: id,
      url: origin + pathname,
    };
  }

  function buildFilename(meta, ext) {
    var safe = String(meta && meta.title || 'ai-response')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'ai-response';
    var platform = String(meta && meta.platform || 'AI').replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    var date = meta && meta.date || new Date().toISOString().slice(0, 10);
    return date + '_' + platform + '_' + safe + '.' + String(ext || 'md').replace(/^\./, '');
  }

  function yamlEscape(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function withFrontmatter(markdown, meta, enabled) {
    if (enabled !== true) return markdown;
    var id = meta && meta.platformId || 'generic';
    var tag = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ai';
    var header = [
      '---',
      'title: "' + yamlEscape(meta && meta.title || 'AI Response') + '"',
      'platform: ' + yamlEscape(meta && meta.platform || 'AI'),
      'source: ' + yamlEscape(meta && meta.url || ''),
      'exported_at: ' + yamlEscape(meta && meta.datetime || meta && meta.date || ''),
      'tags:',
      '  - ai-chat',
      '  - ' + tag,
      '---',
      '',
    ].join('\n');
    return header + String(markdown || '');
  }

  window.ChatSavorMeta = { getPageMeta: getPageMeta, buildFilename: buildFilename, withFrontmatter: withFrontmatter };
})();
