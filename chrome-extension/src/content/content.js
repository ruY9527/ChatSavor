// ChatSavor — generic scanner (built on the shared platform base)
;(function () {
  'use strict';

  // Only platforms without a dedicated adapter remain here.
  var PLATFORM_CONFIGS = [
    { host: 'poe.com', selectors: ['[class*="AssistantMessage"]', '[class*="BotMessage"]'] },
  ];

  var GENERIC_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.assistant',
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="response"]',
  ];

  function getHost() {
    return window.ChatSavorDOM ? window.ChatSavorDOM.host() : location.hostname;
  }

  function getDedicatedPlatformModule() {
    var host = getHost();
    if (host === 'chat.openai.com' || host === 'chatgpt.com') return 'chatgpt';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'deepseek.com' || host.slice(-13) === '.deepseek.com') return 'deepseek';
    if (host === 'doubao.com' || host.slice(-11) === '.doubao.com') return 'doubao';
    if (host === 'kimi.com' || host.slice(-9) === '.kimi.com' || host === 'kimi.moonshot.cn' || host.slice(-17) === '.kimi.moonshot.cn') return 'kimi';
    if (host === 'yuanbao.tencent.com' || host.slice(-20) === '.yuanbao.tencent.com') return 'yuanbao';
    if (host === 'chatglm.cn' || host.slice(-11) === '.chatglm.cn') return 'chatglm';
    if (host === 'tongyi.aliyun.com' || host.slice(-18) === '.tongyi.aliyun.com') return 'tongyi';
    if (host === 'qwen.ai' || host.slice(-8) === '.qwen.ai') return 'qwen';
    if (host === 'grok.com' || host.slice(-9) === '.grok.com' || host === 'x.com' || host.slice(-6) === '.x.com') return 'grok';
    if (host === 'claude.ai' || host.slice(-8) === '.claude.ai') return 'claude';
    if (host === 'perplexity.ai' || host.slice(-13) === '.perplexity.ai') return 'perplexity';
    if (host === 'aistudio.google.com' || host.slice(-19) === '.aistudio.google.com') return 'aistudio';
    return null;
  }

  function getSelectors() {
    var host = getHost();
    for (var i = 0; i < PLATFORM_CONFIGS.length; i++) {
      if (host === PLATFORM_CONFIGS[i].host || host.slice(-(PLATFORM_CONFIGS[i].host.length + 1)) === '.' + PLATFORM_CONFIGS[i].host) {
        return PLATFORM_CONFIGS[i].selectors;
      }
    }
    return GENERIC_SELECTORS;
  }

  function start(overrides) {
    if (getDedicatedPlatformModule()) return;
    if (!window.ChatSavorPlatform) return;
    overrides = overrides || {};
    var hasOverrides = !!(overrides.responseSelector || overrides.userSelector || overrides.excludedSelector);
    window.ChatSavorPlatform.create({
      id: 'generic',
      forceReplace: hasOverrides,
      matchHost: function () { return !getDedicatedPlatformModule(); },
      responseSelectors: overrides.responseSelector ? [overrides.responseSelector].concat(getSelectors()) : getSelectors(),
      userSelector: overrides.userSelector || '[data-message-author-role="user"], [data-role="user"], [class*="user-message"], [class*="human-message"]',
      excludedSelector: overrides.excludedSelector || undefined,
      minTextLength: 2,
    });
  }

  function startWithCustomRules() {
    start();
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
        chrome.storage.local.get('customRules', function(result) {
          var rules = [];
          try { rules = JSON.parse(result && result.customRules || '[]'); } catch (ignored) {}
          var host = getHost();
          var rule = (rules || []).find(function(r) {
            if (!r || !r.hostPattern) return false;
            var p = String(r.hostPattern).toLowerCase();
            // Exact host or *.domain / .domain suffix only — never a loose substring.
            return host === p || host.slice(-(p.length + 1)) === '.' + p;
          });
          if (rule) start(rule);
        });
      }
    } catch (ignored) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWithCustomRules, { once: true });
  } else {
    startWithCustomRules();
  }
})();
