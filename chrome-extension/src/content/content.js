;(function() {
  'use strict';

  // ── Platform selectors ──
  var PLATFORM_CONFIGS = [
    { name: 'claude',     host: 'claude.ai',           selectors: ['.font-claude-message', '[class*="assistant"]'] },
    { name: 'chatglm',    host: 'chatglm.cn',           selectors: ['.markdown-body', '[class*="answer"]'] },
    { name: 'tongyi',     host: 'tongyi.aliyun.com',    selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'qwen',       host: 'qwen.ai',              selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'kimi',       host: 'kimi.moonshot.cn',      selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'yuanbao',    host: 'yuanbao.tencent.com',   selectors: ['.agent-chat__conv--ai .agent-chat__bubble__content', '[class*="conv--ai"] [class*="bubble__content"]'] },
    { name: 'perplexity', host: 'perplexity.ai',         selectors: ['[class*="answer"]', '[class*="response"]'] },
    { name: 'poe',        host: 'poe.com',               selectors: ['[class*="AssistantMessage"]', '[class*="BotMessage"]'] },
    { name: 'coze',       host: 'coze.cn',               selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
    { name: 'coze',       host: 'coze.com',              selectors: ['[class*="assistant"]', '[class*="message-content"]'] },
  ];

  var GENERIC_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.assistant',
    '[class*="assistant"]',
    '[class*="answer"]',
    '[class*="response"]',
  ];

  // ── State ──
  var injectedParents = new WeakSet();
  var watchingState = new Map();
  var injectedContentHashes = new Set();

  var STABLE_THRESHOLD = 3;
  var CHECK_INTERVAL = 1000;

  // ── Platform ──
  function getCurrentPlatformConfig() {
    var host = location.hostname;
    for (var i = 0; i < PLATFORM_CONFIGS.length; i++) {
      if (host.indexOf(PLATFORM_CONFIGS[i].host) !== -1) return PLATFORM_CONFIGS[i];
    }
    return null;
  }

  function getSelectors() {
    var config = getCurrentPlatformConfig();
    return config ? config.selectors : GENERIC_SELECTORS;
  }

  function getDedicatedPlatformModule() {
    var host = window.ChatSavorDOM ? window.ChatSavorDOM.host() : location.hostname;
    if (host === 'chat.openai.com' || host === 'chatgpt.com') return 'chatgpt';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'deepseek.com' || host.slice(-13) === '.deepseek.com') return 'deepseek';
    if (host === 'doubao.com' || host.slice(-11) === '.doubao.com') return 'doubao';
    if (host === 'kimi.com' || host.slice(-9) === '.kimi.com') return 'kimi';
    if (host === 'kimi.moonshot.cn' || host.slice(-17) === '.kimi.moonshot.cn') return 'kimi';
    if (host === 'yuanbao.tencent.com' || host.slice(-20) === '.yuanbao.tencent.com') return 'yuanbao';
    if (host === 'chatglm.cn' || host.slice(-11) === '.chatglm.cn') return 'chatglm';
    if (host === 'tongyi.aliyun.com' || host.slice(-18) === '.tongyi.aliyun.com') return 'tongyi';
    if (host === 'qwen.ai' || host.slice(-8) === '.qwen.ai') return 'qwen';
    if (host === 'grok.com' || host.slice(-9) === '.grok.com') return 'grok';
    if (host === 'x.com' || host.slice(-6) === '.x.com') return 'grok';
    return null;
  }

  // ══════════════════════════════════════════════════════════
  //  Group: each content container belongs to its direct parent.
  // ══════════════════════════════════════════════════════════

  function findParentWrapper(container) {
    return container.parentElement || container;
  }

  // Content hash to detect re-rendered DOM
  function getContentHash(children) {
    var text = '';
    for (var i = 0; i < children.length; i++) {
      text += (children[i].textContent || '').substring(0, 80);
    }
    var hash = 0;
    for (var j = 0; j < text.length; j++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(j);
      hash = hash & hash;
    }
    return String(hash);
  }

  function deduplicate(nodeList) {
    var seen = new Set();
    var result = [];
    for (var i = 0; i < nodeList.length; i++) {
      if (!seen.has(nodeList[i])) { seen.add(nodeList[i]); result.push(nodeList[i]); }
    }
    return result;
  }

  function getAllContentContainers() {
    var selectors = getSelectors();
    var all = [];
    for (var s = 0; s < selectors.length; s++) {
      try {
        var found = document.querySelectorAll(selectors[s]);
        for (var i = 0; i < found.length; i++) all.push(found[i]);
      } catch(e) {}
    }
    return deduplicate(all);
  }

  // ══════════════════════════════════════════════════════════
  //  Stability check — track the children's combined text
  //  length. Once it stops changing for STABLE_THRESHOLD
  //  consecutive checks, consider the reply complete.
  // ══════════════════════════════════════════════════════════

  function isGroupStable(children) {
    var len = 0;
    for (var i = 0; i < children.length; i++) {
      len += (children[i].textContent || '').trim().length;
    }
    if (len < 20) return false;

    // Use content-based key so it survives DOM re-renders
    var key = getContentHash(children);
    var state = watchingState.get(key);
    if (!state) {
      watchingState.set(key, { length: len, stableCount: 0 });
      return false;
    }

    if (len !== state.length) {
      state.length = len;
      state.stableCount = 0;
      return false;
    }

    state.stableCount++;
    return state.stableCount >= STABLE_THRESHOLD;
  }

  function hasVisibleStopButton(children) {
    var stopTexts = ['停止', 'Stop', '停止生成', 'Stop generating', '取消生成'];
    // Check stop buttons near the message group, not globally
    var parent = findParentWrapper(children[0]);
    var ancestor = parent.parentElement || parent;
    var btns = ancestor.querySelectorAll('button');
    for (var j = 0; j < btns.length; j++) {
      if (btns[j].offsetParent === null) continue;
      var t = (btns[j].textContent || '').trim();
      for (var k = 0; k < stopTexts.length; k++) {
        if (t === stopTexts[k]) return true;
      }
    }
    return false;
  }

  // ══════════════════════════════════════════════════════════
  //  Content extraction
  // ══════════════════════════════════════════════════════════

  function extractGroup(children) {
    var wrapper = document.createElement('div');
    children.forEach(function(child) { wrapper.appendChild(child.cloneNode(true)); });
    return window.ChatSavorCore.extractMarkdown(wrapper);
  }

  // ══════════════════════════════════════════════════════════
  //  Save button
  // ══════════════════════════════════════════════════════════

  function createSaveButton() {
    var host = document.createElement('div');
    host.style.cssText = 'display:flex; justify-content:flex-end; padding:4px 0; margin-top:4px;';

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:block}',
      '.save-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;',
      'background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:6px;',
      'cursor:pointer;font-size:12px;font-weight:500;box-shadow:0 2px 8px rgba(102,126,234,.4);',
      'transition:all .2s;user-select:none;white-space:nowrap}',
      '.save-btn:hover{background:linear-gradient(135deg,#5a6fd6,#6a3f96);box-shadow:0 4px 12px rgba(102,126,234,.6);transform:translateY(-1px)}',
      '.save-btn:active{transform:translateY(0)}',
    ].join('\n');

    var btn = document.createElement('button');
    btn.className = 'save-btn';
    btn.textContent = '🔄 转换';

    shadow.appendChild(style);
    shadow.appendChild(btn);
    return { host: host, button: btn };
  }

  // ══════════════════════════════════════════════════════════
  //  Main scan loop — runs every CHECK_INTERVAL ms
  // ══════════════════════════════════════════════════════════

  function scanAndInject() {
    var allContainers = getAllContentContainers();
    if (allContainers.length === 0) return;

    // Step 1: Group containers by their direct parent
    var parentToChildren = new Map();
    for (var i = 0; i < allContainers.length; i++) {
      var parent = findParentWrapper(allContainers[i]);
      if (!parentToChildren.has(parent)) {
        parentToChildren.set(parent, []);
      }
      parentToChildren.get(parent).push(allContainers[i]);
    }

    // Step 2: For each group, check stability and inject if ready
    parentToChildren.forEach(function(children, parent) {
      if (injectedParents.has(parent)) return;
      if (parent.querySelector('.ai-saver-host')) {
        injectedParents.add(parent);
        return;
      }
      if (hasVisibleStopButton(children)) return;
      if (!isGroupStable(children)) return;

      var hasContent = false;
      for (var j = 0; j < children.length; j++) {
        if ((children[j].textContent || '').trim().length >= 10) { hasContent = true; break; }
      }
      if (!hasContent) return;

      var hash = getContentHash(children);
      if (injectedContentHashes.has(hash)) {
        injectedParents.add(parent);
        return;
      }

      // Inject one button after the last child
      var parts = createSaveButton();
      parts.host.className = 'ai-saver-host';
      parts.button.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        var content = extractGroup(children);
        if (content) showPreviewModal(content.markdown, content.html);
      });

      var lastChild = children[children.length - 1];
      if (lastChild.nextSibling) {
        parent.insertBefore(parts.host, lastChild.nextSibling);
      } else {
        parent.appendChild(parts.host);
      }

      injectedParents.add(parent);
      injectedContentHashes.add(hash);
      watchingState.delete(hash);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  Preview Modal
  // ══════════════════════════════════════════════════════════

  function showPreviewModal(markdown) {
    return window.ChatSavorCore.showPreviewModal(markdown);
  }

  // ══════════════════════════════════════════════════════════
  //  Init — periodic scan only, no MutationObserver
  // ══════════════════════════════════════════════════════════

  function init() {
    if (window.ChatSavorGenericScannerStarted) return;
    window.ChatSavorGenericScannerStarted = true;
    var dedicatedModule = getDedicatedPlatformModule();
    if (dedicatedModule) {
      console.log('[AI Saver] Skipping generic scanner on', dedicatedModule);
      return;
    }
    if (window.ChatSavorBridge) window.ChatSavorBridge.register({ platform: 'generic', scan: scanAndInject, getResponses: getAllContentContainers });

    console.log('[AI Saver] Starting on', location.hostname);

    // Initial scans for page-load content
    setTimeout(scanAndInject, 1000);
    setTimeout(scanAndInject, 3000);
    setTimeout(scanAndInject, 6000);

    // Periodic scan
    setInterval(scanAndInject, CHECK_INTERVAL);

    console.log('[AI Saver] Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
