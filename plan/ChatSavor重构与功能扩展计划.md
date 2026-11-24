# ChatSavor 项目重构、Bug 修复与功能扩展详细实现规范（Execution Spec）

> **用途说明**：本文档面向自动化编程代理（如 DeepSeek Harness）及人类开发者，提供精确到文件、函数、行号、数据结构、边界条件与测试断言的**可执行级实现说明书**。  
> **基准版本**：`v2.0.6`  
> **测试命令**：`npm --prefix chrome-extension test`（基于 Node.js `node --test` + `jsdom`，当前基线为 **69/69 通过**）。

---

## 0. 全局工程约束与防坑总则（执行任何任务前必读）

1. **零构建运行时约束**：
   - `chrome-extension/src/` 下的代码直接由 Chrome Manifest V3 加载，**不要引入 ESM `import/export` 或需要编译的 TypeScript/JSX 语法**，全部使用 IIFE `(function() { 'use strict'; ... })();` 并通过 `window.ChatSavor*`（或 `globalThis.ChatSavor*`）暴露模块。
   - **禁止引入任何运行时外网请求**（不得加载 CDN 脚本/字体/API，所有渲染、导出、公式解析必须 100% 本地离线完成）。
2. **脚本加载顺序约束**：
   - `chrome-extension/manifest.json` 的 `content_scripts[0].js` 决定了 Content Script 的注入顺序。新增共享模块（如 `src/content/platform-base.js`）必须放在 `src/content/core.js` **之后**、`src/content/content.js` 和 `src/content/platforms/*.js` **之前**。
3. **既有测试契约保护**：
   - **每完成一个 Task 必须立刻运行 `npm --prefix chrome-extension test`**，保证所有既有测试与新增测试 100% 通过后再进入下一个 Task。
   - 特别注意 `tests/lifecycle.test.cjs` 中的契约：`src/content/bridge.js` 中的 `SCRIPT_VERSION` **必须是静态字符串字面量**，不得改为运行时调用 `chrome.runtime.getManifest().version`（否则当旧脚本残留在页面且扩展已升级时，无法区分页面脚本版本与扩展版本）。
   - 修改 `controller.js` 的错误提示文案或 `background.js` 的自动恢复域名范围时，必须同步检查并更新 `tests/connection.test.cjs` 和 `tests/lifecycle.test.cjs` 中对应的断言。
4. **隐私与安全约束**：
   - 诊断报告（`status()`、`copy-diagnostics`、`background.js` 错误记录）**严禁包含任何聊天正文、用户提问文本或完整对话 URL 路径**（URL 必须脱敏为 `origin + '/[redacted]'`）。
   - 所有写入 DOM `innerHTML` 或导出为 HTML/Word 的 Markdown 渲染结果，**必须经过 `window.ChatSavorMarkdown.render()` 内的 `sanitizeHtml()`**。
5. **保持 `chatgpt.js` 零回退**：
   - `src/content/platforms/chatgpt.js` 目前已有完整的 2026 布局适配和 20+ 专项回归测试（`tests/chatgpt.test.cjs`）。在 Phase 1 迁移平台基类时，**优先将其他 9 个非 ChatGPT 平台及 `content.js` 迁移至基类**，`chatgpt.js` 可保持独立或在最后单独验证迁移，严禁破坏其现有任何行为。

---

## 第一阶段（Phase 1）：P0/P1 止血修复与平台架构统一

> **执行顺序**：严格按 `T1.1 -> T1.2 -> T1.3 -> T1.4 -> T1.5 -> T1.6 -> T1.7` 顺序执行。

---

### Task T1.1：创建统一平台适配器基类 `src/content/platform-base.js`

- **目标文件**：
  - 新建：`chrome-extension/src/content/platform-base.js`
  - 修改：`chrome-extension/manifest.json`（在 `content_scripts[0].js` 中紧接 `src/content/core.js` 之后加入 `"src/content/platform-base.js"`）

#### 详细实现要求
1. **全局命名空间**：暴露 `window.ChatSavorPlatform = (function() { ... })();`，并在内部维护 `window.ChatSavorAdapters = window.ChatSavorAdapters || {};`。
2. **公开方法 `create(config)`**：接收平台配置对象 `config`，字段定义如下：
   - `id`（string，必填）：平台标识，如 `'gemini'`、`'deepseek'`、`'doubao'`、`'kimi'`、`'chatglm'`、`'tongyi'`、`'qwen'`、`'yuanbao'`、`'grok'`、`'generic'`。
   - `matchHost(host, loc)`（function，必填）：判断当前页面是否属于该平台域名。`host` 优先通过 `window.ChatSavorDOM ? window.ChatSavorDOM.host() : location.hostname` 获取。
   - `isActiveRoute(loc)`（function，可选，默认返回 `true`）：用于 SPA 路由守卫（例如 `x.com` 上仅当 `/i/grok` 时返回 `true`）。若 `matchHost` 为 `true` 但 `isActiveRoute` 为 `false`，适配器保持挂载但不执行扫描、不向页面注入按钮。
   - `watchRoute`（boolean，可选，默认 `false`）：为 `true` 时，监听 `window` 的 `popstate`、`hashchange` 事件，并记录 `lastHref = location.href`，在每次周期回调开头检测 `location.href !== lastHref`；路由进入激活态时触发一次扫描，离开激活态时清空状态。
   - `stabilityMs`（number，默认 `1500`）：文本内容不再变化后的等待时长（毫秒）。
   - `scanIntervalMs`（number，默认 `2000`）：定时扫描周期（毫秒）。
   - `initialDelayMs`（number，默认 `1000`）：首次启动扫描延迟（毫秒）。
   - `minTextLength`（number，默认 `2`）：视为有效回复的最小去空白字符长度。
   - `responseSelectors`（string[]，可选）：按优先级排列的回复内容选择器。
   - `turnSelectors`（string[]，可选）：结构回退选择器。
   - `excludedSelector`（string，默认 `'.ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host, form, footer, nav, aside, textarea, [contenteditable="true"], [role="textbox"]'`）。
   - `userSelector`（string，可选）：**精确的用户消息 CSS 选择器**（严禁使用宽泛子串匹配 `self` / `user`）。
   - `stopSelectors`（string[]，可选）：精确的停止生成按钮选择器（如 `'[data-testid="stop-button"]'`）。
   - `stopTokens`（string[]，默认 `['stop generating', 'stop response', '停止生成', '停止输出', '停止回答', '停止回复', '取消生成']`）：停止按钮文本/属性匹配词，**绝不允许包含裸词 `'stop'`**。
   - `streamingSelector`（string，可选）：局部流式标记选择器（如 `'[data-is-streaming="true"]'`）。
   - `getChatRoot()`（function，可选）：返回聊天主容器节点（默认返回 `document`）。
   - `findResponses(ctx)`（function，可选）：完全自定义查找回复节点数组；若未提供，则执行基类标准查找流程（见下文第 4 点）。
   - `resolveWrapper(el, ctx)`（function，可选）：将命中的子节点归一化到单条回复的外层包装节点。
   - `isLikelyResponse(el, ctx)`（function，可选）：额外过滤条件，返回 boolean。
   - `extractReply(el, ctx)`（function，可选）：自定义提取逻辑；默认调用 `ctx.core.extractMarkdown(el)`。
   - `hasButton(el, ctx)`（function，可选）：判断单条回复 `el` 是否已经挂载按钮。**默认实现必须仅针对当前 `el`**：检查 `el.querySelector(':scope > .ai-saver-host[data-chatsavor-owner="' + config.id + '"]')` 或 `el.nextElementSibling && el.nextElementSibling.classList.contains('ai-saver-host')`。**严禁**检查 `el.parentElement.querySelector(':scope > .ai-saver-host')`（避免同父容器下多条消息互相锁死）。
   - `mountButton(el, onClick, ctx)`（function，可选）：自定义挂载按钮位置；默认调用 `ctx.core.injectButtonAfter(el, onClick)`。
   - `diagnostics(ctx)`（function，可选）：返回附加诊断字段对象。
3. **热重载与防重复注册机制**：
   - 获取当前版本 `var version = window.ChatSavorBridge ? window.ChatSavorBridge.version : '2.0.6';`。
   - 检查 `var prev = window.ChatSavorAdapters[config.id];`。
   - 如果 `prev && prev.version === version && prev.core === window.ChatSavorCore`：直接重新调用 `window.ChatSavorBridge.register(prev)` 并返回 `prev`，不重复启动定时器。
   - 如果 `prev && typeof prev.dispose === 'function'`：先调用 `prev.dispose()` 彻底清除旧的 `setTimeout`、`setInterval`、`MutationObserver`、`popstate`/`hashchange` 事件监听器。
4. **标准工具函数（由 `ctx` 传递给各平台钩子）**：
   - `ctx.isVisible(el)`：
     - 若 `!el || !el.isConnected` 返回 `false`。
     - 若 `dom.closest(el, '[hidden], [aria-hidden="true"]')` 为真返回 `false`。
     - 获取 `var style = (el.ownerDocument.defaultView || window).getComputedStyle(el);`，若 `style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0'` 返回 `false`。
     - 若 `el.getClientRects().length > 0` 返回 `true`。
     - 若 `style.display === 'contents'`，递归检查 `Array.from(el.children).some(ctx.isVisible)`。
     - 否则返回 `false`。（注：在 `jsdom` 环境中 `getClientRects()` 可能返回空，需兼容：若 `typeof el.getClientRects === 'function' && el.getClientRects().length > 0` 返回 `true`；若在真实浏览器中宽高为 0 且非 `display:contents` 返回 `false`；具体可参考 `chatgpt.js` 第 41-52 行写法保持与 `jsdom` 测试完全一致）。
   - `ctx.deduplicate(list)`：使用 `Set` 去重并保持原顺序。
   - `ctx.removeNested(list)`：过滤掉被列表中其他节点包含的子节点（`!list.some(other => other !== el && dom.contains(other, el))`），并按文档顺序排序（`dom.compare`）。
   - `ctx.getText(el)`：优先调用 `dom ? dom.text(el) : (el.textContent || '')`，再 `.trim()`。
   - `ctx.hasVisibleStopButton(scope)`：在 `scope || document` 下查找 `button, [role="button"]`，排除 `.ai-saver-host, .ai-saver-modal-host`，仅检查 `ctx.isVisible(control)` 的控件；先匹配 `stopSelectors`，再将 `textContent + aria-label + title` 拼接转小写后匹配 `stopTokens`。
5. **标准查找流程（默认 `findResponses`）**：
   - 维护局部 `cachedSelector = null`。
   - 优先使用 `cachedSelector` 查询；若结果非空则直接返回（**短路返回，不继续跑后续选择器**）；若结果为空则置 `cachedSelector = null`。
   - 顺序遍历 `responseSelectors`，对每个选择器命中节点调用 `resolveWrapper` -> 去重 -> 过滤（`isVisible`、不在 `excludedSelector` 内、不在 `userSelector` 内且内部不含 `userSelector`、文本长度 `>= minTextLength`、通过 `config.isLikelyResponse`）-> `removeNested`。一旦某个选择器返回非空结果，记录 `cachedSelector` 并立即返回。
   - 若所有 `responseSelectors` 均为空，再尝试 `turnSelectors` 汇总后归一化过滤返回。
6. **核心状态机 `scan(force)`（彻底消除定时器风暴）**：
   - 维护模块私有 `var responseState = new WeakMap();`（绝不使用 `processed = new WeakSet()`！）。
   - 若 `config.isActiveRoute && !config.isActiveRoute(location)`，直接返回。
   - 调用 `var responses = getResponses();`。
   - 计算 `var generating = ctx.hasVisibleStopButton(config.getChatRoot ? config.getChatRoot() : document);` 与 `var now = Date.now();`。
   - 遍历 `responses`（下标 `index`）：
     - 若 `hasButton(el, ctx)` 为 `true`，跳过（无需记录 `processed`，因此若 React/Vue 重渲染删掉按钮，下个周期 `hasButton` 变回 `false` 会自动重新注入！）。
     - 若 `force === true`（用户手动点击 Popup 扫描），直接调用 `inject(el)` 并跳过稳定等待。
     - 读取 `var text = ctx.getText(el);`，若 `!text` 直接跳过。
     - 检查局部流式标记 `var streaming = config.streamingSelector && (dom.closest(el, config.streamingSelector) || dom.queryAll(config.streamingSelector, el).length > 0);`。
     - 检查 `var isLastGenerating = generating && index === responses.length - 1;`（注意：生成中只延迟**最后一条回复**，不影响历史回复注入按钮！）。
     - 读取 `var state = responseState.get(el);`。
     - 若 `!state || state.text !== text || streaming || isLastGenerating`：更新 `responseState.set(el, { text: text, stableSince: now });`，直接 `return`。
     - 若 `now - state.stableSince >= stabilityMs`：调用 `inject(el)`。
7. **`inject(el)` 与 Bridge 注册**：
   - 点击回调：`var result = extractReply(el, ctx); if (result && result.markdown) core.showPreviewModal(result.markdown);`。
   - 构造标准 adapter 对象：
     ```js
     var adapter = {
       platform: config.id,
       version: version,
       core: core,
       scan: scan,
       getResponses: getResponses,
       extractMarkdown: function(el) { return extractReply(el, ctx); },
       diagnostics: function() { return config.diagnostics ? config.diagnostics(ctx) : {}; },
       dispose: dispose,
     };
     ```
   - 存入 `window.ChatSavorAdapters[config.id] = adapter;`，若 `window.ChatSavorBridge` 存在则调用 `window.ChatSavorBridge.register(adapter)`。
   - 启动 `setTimeout(safeScan, initialDelayMs)` 和 `setInterval(safeScan, scanIntervalMs)`，所有 timer ID 存入 `timers` 数组并在 `dispose()` 中全部 `clearTimeout` / `clearInterval`。

---

### Task T1.2：将 9 个非 ChatGPT 平台全部迁移至 `ChatSavorPlatform` 并逐项修复平台 Bug

- **目标文件**：
  - `chrome-extension/src/content/platforms/gemini.js`
  - `chrome-extension/src/content/platforms/deepseek.js`
  - `chrome-extension/src/content/platforms/doubao.js`
  - `chrome-extension/src/content/platforms/kimi.js`
  - `chrome-extension/src/content/platforms/chatglm.js`
  - `chrome-extension/src/content/platforms/tongyi.js`
  - `chrome-extension/src/content/platforms/qwen.js`
  - `chrome-extension/src/content/platforms/yuanbao.js`
  - `chrome-extension/src/content/platforms/grok.js`

#### 各平台精确迁移与修复细则

1. **`gemini.js`**：
   - `id: 'gemini'`，`matchHost: host => host === 'gemini.google.com'`。
   - `responseSelectors`: `['model-response', '.chat-history model-response', 'infinite-scroller model-response', 'model-response message-content', 'model-response .response-container-content', 'model-response .model-response-text']`。
   - `userSelector`: `'user-query, .query-content'`。
   - `resolveWrapper`: `el => el.closest('model-response') || el`。
   - `minTextLength: 2`（修复原 15 字符阈值会漏掉简短回复如“是的”、“42”的问题）。
   - `stopTokens`: `['stop response', 'stop generating', '停止生成', '停止输出', '停止回答', '停止回应']`。

2. **`deepseek.js`**：
   - `id: 'deepseek'`，`matchHost: host => host === 'deepseek.com' || host.slice(-13) === '.deepseek.com'`。
   - 保留 `THINKING_SEL = '.ds-thinking-content'`。
   - `responseSelectors`: `['.ds-markdown--block', '.ds-markdown', '.markdown-body']`。
   - `isLikelyResponse`: 排除 `!el.closest(THINKING_SEL)`。
   - 保留 `findResponseByStructure` 作为 `findResponses` 中选择器全空时的结构回退（基于 `.ds-thinking-content` 的父/祖父节点查找非思考正文块）。
   - **修复 B-07**：启用基类的停止生成按钮检测（`stopTokens` 包含 `'停止生成'`, `'停止回答'`, `'stop generating'`, `'stop'` 以外的精确词，以及 DeepSeek 停止图标按钮属性检测）。

3. **`doubao.js`**：
   - `id: 'doubao'`，`matchHost: host => host === 'doubao.com' || host.slice(-11) === '.doubao.com'`。
   - **修复 B-02**：彻底移除 `hasUserSignalInAncestors` 中对 `user` 子串的宽泛匹配；仅保留精准的用户消息判断：
     - `el.closest('[data-role="user"], [data-testid*="user_message"], [data-testid*="send_message"]')`
     - 或单条消息容器本身（非任意祖先）具有 `justify-end` 类名（豆包发送气泡右对齐特征，仅检查消息项 `.group` 或 `[class*="message-container"]` 自身，绝不向上遍历到 `document.body`）。
   - **修复 B-06**：
     - 删除未使用的死函数 `getInsertionTarget()`（原第 304-327 行）。
     - 在自定义 `findResponses(ctx)` 中按优先级**短路返回**：`findResponseByMessageListDom()` 有结果即返回 -> 否则查 `cachedSelector` -> 否则遍历 `RESPONSE_SELECTORS` 命中即缓存并返回 -> 否则查 `findResponseByActionBar()` -> 否则查 `TURN_SELECTORS`。删除每次扫描都打印的 `console.log('[ChatSavor] Doubao action-bar fallback:', ...)`。
   - 保留豆包特有的 `mountButton`（优先挂载到 `actionHost` 或 `copyControl` 旁，失败回退 `core.injectButtonAfter`）与 `extractReply`（提取 `bodyHost` 避免把底部操作栏文字带入）。
   - 修正 `hasButton`：仅检查当前 `el` 对应的 `actionHost`、`insertPosition.parent`（且确认其属于当前 `el` 内部）或 `el.nextElementSibling`。

4. **`kimi.js`**：
   - `id: 'kimi'`，`matchHost` 匹配 `kimi.com`、`*.kimi.com`、`kimi.moonshot.cn`、`*.kimi.moonshot.cn`。
   - **修复 B-04**：
     - 从排除选择器中**删除** `[class*="message-list-container"]`。
     - 移除 `el.parentElement.querySelector(':scope > .ai-saver-host')`，改用基类默认 `hasButton`（只检查当前 `el` 自身内部或紧邻 `nextElementSibling`）。
   - **修复 B-02**：删除宽泛的 `hasUserSignal`（禁止匹配 `self`/`user`/`question` 子串），改为精确 `userSelector`: `'.is-self, .segment-user, .chat-content-item-user, [data-role="user"], [data-testid*="user"]'`。

5. **`yuanbao.js`**：
   - `id: 'yuanbao'`，`matchHost` 匹配 `yuanbao.tencent.com`、`*.yuanbao.tencent.com`。
   - **修复 B-05**：
     - 删除全局悬浮按钮逻辑（`ensureFloatingButton`、`removeFloatingButton`、`floatingHost`），与全项目“单条回复末尾按钮 + Popup 兜底”的统一设计保持一致。
     - 删除原第 605 行对整个 `document.documentElement` 的 `MutationObserver`，改由基类定时扫描，彻底消除高频回流。
     - 修复原第 385 行逻辑错误：改为检查 `el.getAttribute('data-speaker') === 'ai' || el.getAttribute('data-conv-speaker') === 'ai'`。
     - 删除宽泛的 `hasUserSignal`，改为精确 `userSelector`: `'.agent-chat__list__item--human, [data-conv-speaker="human"], .agent-chat__conv--human, [class*="conv--human"], [data-speaker="human"], [data-speaker="user"]'`。
     - 修正 `hasButton`：仅检查当前 `turn` 内的 `.ai-saver-yuanbao-toolbar-btn` 或当前 `target.nextElementSibling` 是否为 `.ai-saver-host`，不再检查 `parentElement` 的 `:scope > .ai-saver-host`。
   - 保留元宝特有的 `findMainAnswerContent`（排除 `.hyc-component-deepsearch-cot__think` 思考块）和 `createToolbarButton` 挂载逻辑；对于带有 `.hyc-content-md-done` 的已完成回复，可在 `mountButton` / `scan` 中立刻挂载。

6. **`grok.js`**：
   - `id: 'grok'`。
   - **修复 B-03**：
     - `matchHost`: 匹配 `grok.com`、`*.grok.com`、`x.com`、`*.x.com`。
     - `watchRoute: true`。
     - `isActiveRoute`: 若域名为 `grok.com` 或 `*.grok.com` 返回 `true`；若域名为 `x.com` 或 `*.x.com`，仅当 `loc.pathname.indexOf('/i/grok') === 0 || loc.pathname.indexOf('/grok') !== -1` 时返回 `true`。
     - 从 `STOP_TOKENS` 中**删除裸词 `'stop'`**，仅保留 `['stop generating', 'stop response', '停止生成', '停止输出', '停止回答']`。
   - 保留 `isUserBubble`（检查节点自身的 `bg-surface-l1` 类或 `[data-role="user"]`，不向上遍历 `self`/`user` 子串）。
   - `minTextLength: 2`。

7. **`chatglm.js`、`tongyi.js`、`qwen.js`**：
   - 全部迁移至 `ChatSavorPlatform.create(...)`，消除 99% 的重复代码。
   - **修复 B-02 & B-08**：
     - 移除宽泛的 `hasUserSignal`（禁止 `self` / `user` / `question` 子串向上遍历）。
     - 使用精确的 `userSelector`（如 `[data-role="user"], [data-message-author-role="user"], [class*="user-message"], [class*="question-item"], [class*="human"]`）。
     - 为三者分别设置防过度包裹保护：`isLikelyResponse(el)` 中拒绝包含超过 1 条独立回复子块或包含 `userSelector` 子节点的容器（防止 `[class*="message"]` 误命中整个聊天列表外层容器）。
     - 细化各自优先选择器：
       - `chatglm.js`：`['.answer-content-wrap .markdown-body', '.conversation-item.assistant .markdown-body', '.markdown-body', '[class*="answer-content"]', '[data-role="assistant"]']`
       - `tongyi.js`：`['[class*="answerItem"] [class*="markdown"]', '[class*="assistant"] .markdown-body', '.tongyi-markdown', '.markdown-body', '[data-role="assistant"]']`
       - `qwen.js`：`['[data-role="assistant"] .markdown-prose', '.response-message-content', '.markdown-body', '[class*="assistant-message"]', '[data-role="assistant"]']`

---

### Task T1.3：重构通用扫描器 `src/content/content.js`

- **目标文件**：`chrome-extension/src/content/content.js`
- **现状问题**：
  - `injectedParents` WeakSet 锁死父容器导致平铺消息列表仅第 1 条注入按钮。
  - `injectedContentHashes` 取前 80 字哈希，相似回复碰撞跳过且内存泄漏。
  - `window.ChatSavorGenericScannerStarted` 阻止热重载后重新注册到新 `ChatSavorBridge`。
  - `findParentWrapper` 回退为 `container` 时 `insertBefore` 抛 `NotFoundError`。
  - 提取时直接 `cloneNode(true)` 未用 `ChatSavorDOM.clone`，且重复实现了 `createSaveButton`。
  - `PLATFORM_CONFIGS` 中冗余保留了 5 个已有专用适配器的平台。

#### 详细实现要求
1. 保留 `getDedicatedPlatformModule()` 用于检测当前域名是否已有专用平台模块（`chatgpt`、`gemini`、`deepseek`、`doubao`、`kimi`、`yuanbao`、`chatglm`、`tongyi`、`qwen`、`grok`）；若是，则直接 `return`（不注册 generic adapter）。
2. 清理 `PLATFORM_CONFIGS`，仅保留尚未独立成专用文件的平台（如 `claude.ai`、`perplexity.ai`、`poe.com`、`coze.cn`、`coze.com`）。
3. **完全复用 `window.ChatSavorPlatform.create(...)`** 创建 `id: 'generic'` 的适配器：
   - `matchHost`: 当 `!getDedicatedPlatformModule()` 时返回 `true`。
   - `responseSelectors`: 当前匹配到的 `PLATFORM_CONFIGS` 的 `selectors`，若无匹配则回退 `GENERIC_SELECTORS`。
   - `userSelector`: `'[data-message-author-role="user"], [data-role="user"], [class*="user-message"], [class*="human-message"]'`。
   - **按单条回复元素本身挂载按钮**（通过基类的 `removeNested` 去重 + `core.injectButtonAfter(el, onClick)`），彻底删除 `injectedParents`、`watchingState`、`injectedContentHashes`、`createSaveButton` 和 `ChatSavorGenericScannerStarted`。
   - 提取内容自动走 `core.extractMarkdown(el)`（内部已调用 `ChatSavorDOM.clone`）。
4. **验收**：
   - 在模拟 Claude/Poe 平铺列表（3 条回复共享同一 `div.messages` 父容器）下，3 条回复全部各自注入 1 个按钮，互不干扰。
   - 扩展重注入后，`window.ChatSavorBridge` 正常持有最新 `generic` adapter 且无重复定时器。

---

### Task T1.4：修复 `src/content/markdown.js` 5 项核心引擎缺陷

- **目标文件**：`chrome-extension/src/content/markdown.js`

#### 详细实现步骤
1. **修复空指针隐患（原第 117 行）**：
   - 将 `if (node.parentElement.closest(...)) return;` 改为：
     `if (!node.parentElement || node.parentElement.closest('pre, code, script, style, [data-chatsavor-unconverted-math]')) return;`
2. **修复 `blockMath` 遗漏 `\[` 触发（原第 232 行）**：
   - 原代码：`start: function(src) { var index = src.indexOf('$$'); return index < 0 ? undefined : index; }`
   - 修改为：
     ```js
     start: function(src) {
       var match = /\$\$|\\\[/.exec(src);
       return match ? match.index : undefined;
     }
     ```
   - 确保正文中出现 `\[ ... \]` 块级公式时正确触发 `blockMath` tokenizer，不再落入 `inlineMath` 导致 `<p><div>` 非法嵌套。
3. **修复 `sanitizeHtml` 误删任务列表复选框（原第 255 行）**：
   - 将第 255 行选择器中的 `input` 改为 `input:not([type="checkbox"])`。
   - 在第 257-263 行的属性白名单遍历中，针对 `node.tagName === 'INPUT'`：
     - 强制确保 `node.getAttribute('type') === 'checkbox'`（否则移除该节点）。
     - 强制设置 `node.setAttribute('disabled', '')`（防止预览区可随意篡改或触发表单交互）。
     - 仅保留 `type`、`checked`、`disabled` 三个属性，剥离其他所有属性。
4. **允许安全的 Base64 位图内联图片（原第 261 行）**：
   - 在 `href`/`src` 协议检查中，若 `node.tagName === 'IMG' && attribute.name === 'src'` 且匹配 `/^data:image\/(?:png|jpe?g|gif|webp);base64,/i`，允许保留；严格禁止 `data:image/svg+xml`、`javascript:`、`vbscript:` 等危险协议。
5. **消除 `extract()` 双重渲染（原第 202-211 行）**：
   - 当前 `extract(container)` 返回 `{ markdown: markdown, html: render(markdown) }`，但实际所有调用方打开弹窗时又重新调了 `render(markdown)`。
   - 为保持向后兼容（防止外部或单测读取 `result.html`），改为**惰性计算属性**（`Object.defineProperty`）：
     ```js
     if (!markdown) return null;
     var cachedHtml = null;
     var output = { markdown: markdown };
     Object.defineProperty(output, 'html', {
       enumerable: true,
       get: function() {
         if (cachedHtml === null) cachedHtml = render(markdown);
         return cachedHtml;
       }
     });
     return output;
     ```
   - 这样不读取 `result.html` 的路径（如 `showPreviewModal`）零额外开销，需要读取 `result.html` 的测试依然 100% 兼容。

---

### Task T1.5：修复 `src/content/core.js` 安全漏洞、事件泄漏与边界崩溃

- **目标文件**：`chrome-extension/src/content/core.js`

#### 详细实现步骤
1. **修复 `injectButtonAfter` 空指针（原第 41-51 行）**：
   - 开头增加：`if (!container || !container.parentElement) return false;`。
2. **修复 `showPreviewModal` 键盘事件监听器泄漏（原第 57-59 行 & 231-236 行）**：
   - 在 `ChatSavorCore` 闭包顶层定义 `var activeModalCleanup = null;`。
   - 进入 `showPreviewModal` 时：若 `activeModalCleanup` 存在，先调用 `activeModalCleanup();`（它会移除旧的 `host` 并执行 `document.removeEventListener('keydown', escHandler)`），再兜底清理任何残留的 `.ai-saver-modal-host`。
   - 定义 `closeModal` 时，在移除 DOM 与解绑 `keydown` 后将 `activeModalCleanup = null;`；并将 `activeModalCleanup = closeModal;`。
   - 挂载前判断 `var mountRoot = document.body || document.documentElement; if (mountRoot) mountRoot.appendChild(host);`。
3. **修复 `downloadDocx` 的 XSS 漏洞（原第 271-284 行）**：
   - 禁止直接调用 `m.parse(markdown)`！
   - 改为 `var bodyHtml = window.ChatSavorMarkdown ? window.ChatSavorMarkdown.render(markdown) : '<pre>' + escapeHtml(markdown) + '</pre>';`，确保导出的 Word HTML 经过完整的 `sanitizeHtml` 净化且包含 MathML 公式。
   - 暂时将按钮文字由 `.docx` 更正为 `.doc (Word)`（直到 Phase 3 实现真正的 OOXML `.docx` 生成器后再改回 `.docx`），避免误导用户。
4. **修复 `downloadBlob` 同步释放 ObjectURL 竞态（原第 249-256 行）**：
   - 将 `URL.revokeObjectURL(url);` 改为 `setTimeout(function() { URL.revokeObjectURL(url); }, 1000);`。
5. **增加 PDF 导出 UI 状态反馈（原第 216 行 & 258-269 行）**：
   - 点击 `.pdf` 按钮时禁用按钮并显示 `'正在生成 PDF…'`，调用 `downloadPdf(markdown)` 后在 `.then()` 恢复文案，在 `.catch()` 中将错误提示写入弹窗内的 `copyStatus.textContent` 并恢复按钮状态。

---

### Task T1.6：修复 `src/background.js`、`src/connection.js`、`src/popup/controller.js` 全平台支持与状态持久化

- **目标文件**：
  - `chrome-extension/src/background.js`
  - `chrome-extension/src/connection.js`
  - `chrome-extension/src/popup/controller.js`
  - `chrome-extension/tests/connection.test.cjs`（同步文案断言）
  - `chrome-extension/tests/lifecycle.test.cjs`（同步全平台恢复测试）

#### 详细实现步骤
1. **`src/background.js`**：
   - **全平台自动恢复**：
     - 不再硬编码 `var matches = ['*://chatgpt.com/*', '*://chat.openai.com/*'];`。
     - 改为从 `manifest.content_scripts[0].matches` 读取匹配规则数组。
     - 实现辅助函数 `isSupportedUrl(url)`：解析 `new URL(url)`，检查协议为 `http:` 或 `https:`，并与 `matches` 中的主机模式（精确域名或 `*.domain`）比对。
     - `restoreOpenTabs` 和 `chrome.tabs.onUpdated` 全部改用 `isSupportedUrl(tab.url)`。
   - **MV3 Service Worker 报告持久化**：
     - 新增 `saveReport(tabId, report)` 和 `getReport(tabId)`：同时写入内存 `reports` Map 与 `chrome.storage && chrome.storage.session`（如果可用，key 为 `'report_' + tabId`），在 `onRemoved` 时同步删除；`onMessage` 收到 `CHATSAVOR_CONNECTION_REPORT` 时先读内存，未命中则异步读 `chrome.storage.session` 并返回 `true`（保持消息通道开启）。
2. **`src/connection.js`**：
   - **推广 `healthy()` 校验至所有专用平台（原第 6-11 行）**：
     - 检查 `status.version === manifest.version && status.coreReady && status.markdownReady && !!status.adapter`（因为现在包括 generic 在内的所有受支持页面都会注册 adapter）。
   - **优化 `score()` 排序（原第 91-95 行）**：
     - 将 `(status.adapter === 'chatgpt' ? 1 : 0)` 改为 `(status.adapter && status.adapter !== 'generic' ? 1 : 0)`，确保所有专用平台 frame 均优先于空/通用 frame。
3. **`src/popup/controller.js`**：
   - 第 18 行改为：`else if (!status.adapter) statusText.textContent = '网页已连接，但回复识别模块未加载';`。
   - 第 39 行错误提示改为：`'请先切换到支持的 AI 对话网页（如 ChatGPT、DeepSeek、Gemini 等），再打开扩展。'`（注意包含 `ChatGPT` 字样，同时可同步检查 `tests/connection.test.cjs:79` 的正则 `/请先切换到 ChatGPT/` 并更新为 `/请先切换到.*ChatGPT/` 或更清晰断言）。
4. **同步更新 `tests/lifecycle.test.cjs`**：
   - 将原 `background recovery ignores pages outside the two ChatGPT domains` 测试更新为验证：忽略非受支持域名（如 `https://example.com/`），同时正常恢复 `chatgpt.com`、`chat.openai.com`、`chat.deepseek.com`、`gemini.google.com` 等受支持域名。

---

### Task T1.7：补齐 Phase 1 自动化回归测试

- **目标文件**（新建）：
  - `chrome-extension/tests/platform-base.test.cjs`
  - `chrome-extension/tests/platforms.test.cjs`
  - `chrome-extension/tests/export-fixes.test.cjs`

#### 必须覆盖的测试用例清单
1. **`platform-base.test.cjs`**：
   - 平台注册后自动接入 `ChatSavorBridge`，`status().adapter` 与 `responseCount` 准确。
   - 连续多次 `scan()` 对正在流式变化的节点**不会叠加多个定时器**（验证 `WeakMap` 状态机单定时器调度）。
   - 页面重渲染删除 `.ai-saver-host` 后，下一扫描周期自动恢复按钮（无 `WeakSet` 永久锁死）。
   - 扩展重注入（升级版本）时调用旧实例 `dispose()`，清除旧定时器与事件监听器，不重复注入按钮。
   - `watchRoute: true` 场景下，从非目标路由跳转到目标路由时自动开始扫描并注入按钮。
2. **`platforms.test.cjs`**：
   - 9 个平台各自的最小化 DOM Fixture 测试（Gemini、DeepSeek、Doubao、Kimi、Yuanbao、Grok、ChatGLM、Tongyi、Qwen）。
   - **Tailwind `self-stretch` / `self-center` 祖先类不误杀 AI 回复**回归测试（覆盖 Kimi/Doubao/ChatGLM/Tongyi/Qwen/Yuanbao）。
   - **Grok `x.com` 页面包含 `Desktop` 按钮时不阻塞注入**回归测试。
   - **Kimi / 通用扫描器 `content.js` 同父容器多条平铺回复**各自独立注入按钮回归测试。
3. **`export-fixes.test.cjs`**：
   - 任务列表 `- [x] done` / `- [ ] todo` 经 `markdown.js` 渲染后仍保留禁用态 checkbox。
   - 正文后紧跟 `\[ a^2 + b^2 = c^2 \]` 触发 `blockMath` 生成独立 `<div class="chatsavor-math">`，不被 `<p>` 包裹。
   - `extract()` 返回对象支持 `result.markdown` 且 `result.html` 为惰性计算（不读取时不触发渲染）。
   - `core.downloadDocx()` 面对含 `<script>alert(1)</script><img src=x onerror=alert(1)>` 的 Markdown 时输出内容已完全剥离危险标签与事件属性。
   - 连续两次调用 `core.showPreviewModal()` 后按 `Escape`，只触发 1 次关闭逻辑且无残留 `keydown` 监听器。

---

## 第二阶段（Phase 2）：工程瘦身、性能优化与权限规范

> **执行顺序**：`T2.1 -> T2.2 -> T2.3 -> T2.4`

---

### Task T2.1：收窄 `manifest.json` 权限与清理死代码/仓库脏文件

- **目标文件**：
  - 修改：`chrome-extension/manifest.json`
  - 删除：`chrome-extension/src/popup/popup.js`（309 行死代码）
  - 删除：`chrome-extension/src/content/content.css`（空注释文件）
  - 删除：`plan/护患沟通错误选项分析 - 豆包.html` 及 `plan/护患沟通错误选项分析 - 豆包_files/`（第三方静态资源）

#### 详细实现要求
1. **`manifest.json` 精确权限列表**：
   - `host_permissions` 和 `content_scripts[0].matches` 统一收窄为 **仅 HTTPS 且精确匹配已适配域名**：
     ```json
     [
       "https://chat.openai.com/*",
       "https://chatgpt.com/*",
       "https://gemini.google.com/*",
       "https://deepseek.com/*",
       "https://*.deepseek.com/*",
       "https://doubao.com/*",
       "https://*.doubao.com/*",
       "https://chatglm.cn/*",
       "https://*.chatglm.cn/*",
       "https://tongyi.aliyun.com/*",
       "https://*.tongyi.aliyun.com/*",
       "https://qwen.ai/*",
       "https://*.qwen.ai/*",
       "https://kimi.com/*",
       "https://*.kimi.com/*",
       "https://kimi.moonshot.cn/*",
       "https://*.kimi.moonshot.cn/*",
       "https://yuanbao.tencent.com/*",
       "https://*.yuanbao.tencent.com/*",
       "https://grok.com/*",
       "https://*.grok.com/*",
       "https://x.com/*",
       "https://claude.ai/*",
       "https://perplexity.ai/*",
       "https://poe.com/*"
     ]
     ```
   - 彻底移除 `*://*.google.com/*`、`*://*.baidu.com/*`、`*://*.x.com/*` 以及未适配的 `xfyun.cn`、`tiangong.cn`、`ai.360.cn`、`coze.cn`、`coze.com`。
   - 从 `content_scripts[0]` 中移除 `"css": ["src/content/content.css"]` 字段。
2. 更新 `README.md` 中的项目目录树，使其与实际文件结构一致（移除已删除的 `popup.js`、`content.css`，补充 `dom.js`、`bridge.js`、`core.js`、`markdown.js`、`platform-base.js`、`platforms/`、`connection.js`、`controller.js`）。

---

### Task T2.2：版本号单一数据源同步脚本

- **目标文件**：
  - 新建：`chrome-extension/scripts/sync-version.cjs`
  - 修改：`chrome-extension/package.json`（在 `scripts` 中增加 `"sync:version": "node scripts/sync-version.cjs"` 与 `"check:version": "node scripts/sync-version.cjs --check"`）

#### 详细实现要求
1. 读取 `chrome-extension/package.json` 中的 `version` 作为唯一数据源（Single Source of Truth）。
2. `--check` 模式（可纳入 `npm test` 或 CI 校验）：检查 `manifest.json` 的 `version` 和 `src/content/bridge.js` 中的 `var SCRIPT_VERSION = '...'` 是否与 `package.json` 完全一致；不一致则打印具体差异并以退出码 `1` 退出。
3. 默认写入模式：自动更新 `manifest.json` 的 `version` 字段与 `src/content/bridge.js` 中的 `SCRIPT_VERSION` 字面量。

---

### Task T2.3：优化 `src/content/dom.js` DOM 遍历性能

- **目标文件**：`chrome-extension/src/content/dom.js`

#### 详细实现要求
1. **消除 $O(N \times D)$ 的 `closest(element, OWN_UI)` 开销**：
   - 在 `roots(start)` 中改用 `document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter)` 遍历元素。
   - 在 `filter.acceptNode(node)` 中：若 `node.matches && node.matches(OWN_UI)`，直接返回 `NodeFilter.FILTER_REJECT`（TreeWalker 会**跳过整个自身 UI 子树**，无需对每个后代向上调用 `closest`）。
2. **减少无效的 `chrome.dom.openOrClosedShadowRoot()` 跨边界调用**：
   - 普通 HTML 标签（如 `span`, `p`, `a`, `li`, `tr`, `td`, `strong`, `em`, `code`, `pre`, `svg`, `path`）在浏览器规范中**无法附加 Shadow Root**（Shadow DOM 规范仅允许自定义元素含 `-` 以及 `article, aside, blockquote, body, div, footer, h1-h6, header, main, nav, p, section, span`）。
   - 先检查 `element.shadowRoot`（纯 JS 属性读取，极快）；仅当 `element.tagName.indexOf('-') !== -1`（Web Component）或 `element.tagName === 'DIV' || element.tagName === 'SECTION' || element.tagName === 'ARTICLE' || element.tagName === 'MAIN'` 时，才尝试调用 `chrome.dom.openOrClosedShadowRoot(element)`。
3. **验证**：运行 `tests/frames.test.cjs` 和 `tests/chatgpt.test.cjs`，确保开放/封闭 Shadow DOM 与同源 iframe 穿透测试 100% 通过。

---

### Task T2.4：优化 `src/connection.js` 子 Frame 容错注入

- **目标文件**：`chrome-extension/src/connection.js`

#### 详细实现要求
1. 当前 `execute(tabId, payload)` 在 `allFrames: true` 因单个跨域 iframe 报错时，直接降级为仅 `frameIds: [0]`。
2. 保持现有 `execute` 作为主路径（不增加新的 `webNavigation` 权限以保持最小权限原则），但在 `probe` 返回结果过滤无效 frame 时，增加对 `item.result && item.result.error` 的容错日志，确保某个子 frame 抛错不会阻断其他健康 frame 的评分与选择。

---

## 第三阶段（Phase 3）：高价值功能扩展实现规范

> **执行顺序**：按用户价值优先级推进：`T3.1 -> T3.2 -> T3.3 -> T3.4 -> T3.5 -> T3.6 -> T3.7`。

---

### Task T3.1：智能文件命名与 YAML Frontmatter 支持

- **目标文件**：
  - 新建：`chrome-extension/src/content/metadata.js`（注册在 `manifest.json` 的 `core.js` 之前）
  - 修改：`chrome-extension/src/content/core.js`

#### 详细实现要求
1. **`window.ChatSavorMeta.getPageMeta(platformId, markdown)`**：
   - `title`：优先读取 `document.title`，剔除常见平台后缀（如 ` - ChatGPT`、` | DeepSeek`、` - Gemini`、` - 豆包`、` - Kimi`、` - 腾讯元宝`、` - Grok`）；若结果为空或过于泛化（如 `"ChatGPT"`、`"新对话"`），回退提取 `markdown` 第一行非空标题或前 24 个纯文本字符。
   - `date`：当前本地日期 `YYYY-MM-DD` 与完整时间戳 `YYYY-MM-DD HH:mm`。
   - `platform`：平台显示名称映射表（`chatgpt -> ChatGPT`, `deepseek -> DeepSeek` 等）。
   - `url`：`location.origin + location.pathname`（不含敏感 query/hash）。
2. **`window.ChatSavorMeta.buildFilename(meta, ext)`**：
   - 格式：`{YYYY-MM-DD}_{Platform}_{SanitizedTitle}.{ext}`。
   - `SanitizedTitle` 清除 Windows/macOS 非法文件名字符 `[<>:"/\\|?*\x00-\x1F]`，连续空白替换为 `-`，截断至 60 字符，空时回退 `'ai-response'`。
3. **`window.ChatSavorMeta.withFrontmatter(markdown, meta, enabled)`**：
   - 若 `enabled === true`，在正文顶部拼接标准 YAML Frontmatter（对 `title` 中的双引号和反斜杠做安全转义）：
     ```yaml
     ---
     title: "..."
     platform: ChatGPT
     source: https://chatgpt.com/c/...
     exported_at: 2026-11-24 10:30
     tags:
       - ai-chat
       - chatgpt
     ---
     ```
4. **预览弹窗集成**：
   - 在 `core.js` 的预览弹窗头部或工具栏新增一个复选框开关：`[ ] 包含 Frontmatter（Obsidian）`（状态记忆在 `localStorage` 或 `chrome.storage.local`）。
   - `.md` / `.pdf` / `.docx` / `.html` 下载均使用 `buildFilename(meta, ext)` 替代硬编码的 `ai-response.*`。

---

### Task T3.2：整场对话导出 & 多选批量导出

- **目标文件**：
  - 修改：`chrome-extension/src/content/platform-base.js`、`chrome-extension/src/content/platforms/chatgpt.js` 及各平台适配器
  - 修改：`chrome-extension/src/content/bridge.js`
  - 修改：`chrome-extension/src/popup/popup.html`、`chrome-extension/src/popup/controller.js`
  - 修改：`chrome-extension/src/content/core.js`

#### 详细实现要求
1. **统一轮次提取接口 `adapter.getTurns()`**：
   - 返回按文档顺序排列的数组：`[{ role: 'user' | 'assistant', element: Element }]`。
   - 基类提供默认实现：分别查找 `userSelector` 节点与 `getResponses()` 节点，合并后按 `ChatSavorDOM.compare` 排序去重。
   - `chatgpt.js` 单独实现 `getTurns()`，覆盖新旧两种 ChatGPT 布局（`[data-message-author-role="user"|"assistant"]`、`[data-message-role="user"|"assistant"]`、`[data-content-search-unit-key$=":user"|":assistant"]`）。
2. **新增 Bridge 命令**：
   - `EXPORT_ALL`：提取整场对话全部轮次，按模板拼接为单篇 Markdown（每轮以 `## 👤 User` / `## 🤖 Assistant` 分隔，轮次间用 `---` 分隔），调用 `core.showPreviewModal(markdown, { mode: 'conversation', turnsCount })`。
   - `TOGGLE_SELECT_MODE`：在页面上开启/关闭“多选导出模式”。
3. **多选模式页内 UI（Shadow DOM 隔离）**：
   - 开启后，为 `getTurns()` 返回的每条消息左上角/末尾注入一个轻量的复选框标识，并在屏幕底部居中挂载一个可关闭的浮动工具条（Shadow DOM）：
     - 显示 `已选中 X / N 条`
     - 按钮：`全选`、`仅选 AI 回复`、`导出选中`、`取消`
   - 点击 `导出选中` 后，按文档顺序合并所选轮次并打开 `showPreviewModal`，同时自动退出多选模式并清理所有临时复选框 DOM。
4. **Popup 入口**：
   - 在 `popup.html` 的 `.actions` 中增加两个按钮：`导出整场对话`（触发 `EXPORT_ALL`）和 `多选回复导出`（触发 `TOGGLE_SELECT_MODE` 并关闭 Popup）。

---

### Task T3.3：升级导出引擎（矢量可搜索 PDF + 原生 `.docx` + 单文件离线 HTML）

- **目标文件**：
  - 新建：`chrome-extension/src/export/print.html` & `chrome-extension/src/export/print.js`（扩展内独立打印/PDF 页）
  - 修改：`chrome-extension/src/lib/pdf.js`（作为兜底或改造）
  - 新建：`chrome-extension/src/lib/docx-builder.js`（轻量纯 JS 零依赖 OOXML `.docx` 生成器）
  - 修改：`chrome-extension/src/content/core.js`、`chrome-extension/src/background.js`

#### 详细实现要求
1. **高质量可搜索矢量 PDF（推荐方案：扩展独立打印页）**：
   - 用户点击 `.pdf` 时，Content Script 通过 `chrome.runtime.sendMessage({ type: 'CHATSAVOR_OPEN_PRINT', payload: { title, html, filename } })` 发送给 `background.js`。
   - `background.js` 将 payload 临时存入 `chrome.storage.session`（key 为唯一 token），并打开 `chrome.tabs.create({ url: chrome.runtime.getURL('src/export/print.html?id=' + token) })`。
   - `print.html` 读取数据后渲染经过 `sanitizeHtml` 的完整 HTML（自带排版 CSS、表格边框、代码块换行 `@media print { pre { white-space: pre-wrap; } }`、分页保护 `h1,h2,h3 { break-after: avoid; } pre,table,blockquote { break-inside: avoid; }`、离线 KaTeX MathML 公式），并提供顶部打印工具条（隐藏于 `@media print`）且自动触发 `window.print()`。
   - **效果**：生成的 PDF 100% 矢量文字可选中可搜索、公式高清、中文完美无乱码、表格与行内样式完整。
2. **原生 OOXML `.docx` 生成器（`src/lib/docx-builder.js`）**：
   - 实现轻量的 ZIP（Store 无压缩模式，仅需 ~80 行 CRC32 + ZIP Local/Central Directory 封装，零外部依赖）+ 标准 OOXML XML 部件生成：
     - `[Content_Types].xml`、`_rels/.rels`、`word/_rels/document.xml.rels`、`word/styles.xml`、`word/document.xml`。
   - 将 `marked.lexer(markdown)` 生成的 AST Token 映射为 Word 原生 `<w:p>`（Heading1–6、正文、引用、列表）、`<w:tbl>`（带边框与表头底色）、`<w:r>`（粗体 `<w:b/>`、斜体 `<w:i/>`、行内代码等宽字体、删除线 `<w:strike/>`、超链接）、代码块底纹段落。
   - 输出 MIME 为 `application/vnd.openxmlformats-officedocument.wordprocessingml.document`，扩展名为 `.docx`，在 Microsoft Word / WPS / macOS Pages 打开**无任何格式告警**。
3. **单文件离线 HTML 导出**：
   - 在预览弹窗新增 `.html` 导出按钮：将净化后的 HTML 包装进带完整内联 CSS（含浅色/深色自动切换 `@media (prefers-color-scheme: dark)` 与响应式排版）的完整 `<!DOCTYPE html>` 文档并下载。

---

### Task T3.4：深度思考（CoT）精细控制与引用来源脚注化

- **目标文件**：
  - 修改：`chrome-extension/src/content/markdown.js`
  - 修改：`chrome-extension/src/content/platforms/deepseek.js`、`yuanbao.js`、`chatgpt.js`、`kimi.js`
  - 修改：`chrome-extension/src/content/core.js`

#### 详细实现要求
1. **深度思考提取钩子**：
   - 在支持深度思考的平台（DeepSeek `.ds-thinking-content`、元宝 `.hyc-component-deepsearch-cot__think`、ChatGPT 思考折叠块、Kimi 思考块）中，`extractReply(el, options)` 同时提取思考过程文本 `thinking` 与正文 `markdown`。
   - 支持三种输出模式（可在预览弹窗实时切换并重渲染）：
     - `omit`（默认）：不包含思考过程。
     - `details`：在正文顶部插入 `<details><summary>思考过程</summary>\n\n{thinking}\n\n</details>`。
     - `callout`：在正文顶部插入 Obsidian 折叠 Callout：`> [!abstract]- 思考过程\n> ...`。
2. **引用来源脚注化**：
   - 提供统一工具函数 `ChatSavorMarkdown.collectCitations(root)`：提取回复中的联网来源链接并去重编号，在正文插入 `[^1]`，在文末自动生成 `[^1]: [标题](URL)` 脚注列表（兼容 Obsidian、Typora、GitHub Markdown）。

---

### Task T3.5：页内预览弹窗体验升级（实时编辑 + 深色模式 + Obsidian 一键入库）

- **目标文件**：`chrome-extension/src/content/core.js`

#### 详细实现要求
1. **Markdown 实时编辑**：
   - 将预览弹窗的 `Markdown` Tab 由只读 `<pre class="raw-md">` 升级为可编辑 `<textarea class="raw-md-editor">`。
   - 监听 `input` 事件（防抖 200ms）：同步更新当前 `currentMarkdown` 变量，实时重渲染 `预览` Tab 和 `公式` Tab，后续所有复制与导出均基于用户编辑后的最新版本。
2. **自动深色模式（Dark Mode）**：
   - 在 Shadow DOM `<style>` 中引入 CSS 变量（`--cs-bg`、`--cs-surface`、`--cs-text`、`--cs-border`、`--cs-code-bg` 等）。
   - 检测 `window.matchMedia('(prefers-color-scheme: dark)').matches` 或宿主页面背景亮度，自动为 `.modal` 添加 `.dark` 类，提供高对比度护眼暗黑主题，并在头部提供手动日/夜切换图标按钮。
3. **Obsidian 一键入库**：
   - 在底部操作栏提供 `发送到 Obsidian` 按钮（可在设置中配置目标 Vault 名称与保存目录）。
   - 拼接 `obsidian://new?name={encodedTitle}&content={encodedMarkdown}`（含可选 `vault` 参数），注意 URI 长度限制（超过 30,000 字符时自动提示用户改为下载 `.md` 文件放入库中，避免操作系统 URI 截断）。

---

### Task T3.6：补齐热门平台专用适配器（Claude / Perplexity / Google AI Studio）

- **目标文件**（新建并注册至 `manifest.json`）：
  - `chrome-extension/src/content/platforms/claude.js`（匹配 `claude.ai`，识别 `.font-claude-message`、`[data-is-streaming]`、Artifacts 卡片正文）
  - `chrome-extension/src/content/platforms/perplexity.js`（匹配 `perplexity.ai`，识别回答正文并保留来源引用链接）
  - `chrome-extension/src/content/platforms/aistudio.js`（匹配 `aistudio.google.com`，识别模型输出 turn 与思考块）
- 所有新平台均严格通过 `window.ChatSavorPlatform.create(...)` 实现，并在 `tests/platforms.test.cjs` 中补充对应 DOM Fixture 回归测试。

---

### Task T3.7：Options 设置页、本地历史记录与自定义站点规则

- **目标文件**：
  - 新建：`chrome-extension/src/options/options.html`、`chrome-extension/src/options/options.js`
  - 修改：`chrome-extension/manifest.json`（添加 `"options_page": "src/options/options.html"` 与 `"storage"` 权限）
- **核心功能**：
  1. **全局导出偏好**：默认是否开启 Frontmatter、默认 CoT 思考策略、Obsidian Vault 名称与子目录、默认弹窗主题（跟随系统/浅色/深色）、是否启用本地历史记录。
  2. **本地历史记录**：使用 `chrome.storage.local` 最多缓存最近 50 条转换记录（带标题、平台、时间、Markdown 正文），支持关键词搜索、一键复制、二次预览与单条/全部清空。
  3. **自定义站点选择器（支持 Open WebUI / LobeChat / LibreChat / Dify）**：
     - 允许用户添加 `{ hostPattern, responseSelector, userSelector, excludedSelector }` 规则，支持 JSON 导入/导出。
     - `content.js`（generic 适配器）启动时读取自定义规则并优先应用。

---

## 附录：Harness 执行自检命令与验收总表

每次提交或阶段完成后，执行以下验证命令：
```bash
# 1. 运行全量单元测试（要求 0 fail）
npm --prefix chrome-extension test

# 2. 校验版本号一致性（完成 T2.2 后）
npm --prefix chrome-extension run check:version

# 3. 检查工作区无意外遗留脏文件
git status --short
```

### 分阶段 Checklist
- [x] **T1.1** `src/content/platform-base.js` 创建并接入 `manifest.json`
- [x] **T1.2** 9 个非 ChatGPT 平台迁移至基类并修复全部平台 Bug（B-01 ~ B-08）
- [x] **T1.3** `src/content/content.js` 重构修复父容器锁死与热重载（B-09）
- [x] **T1.4** `src/content/markdown.js` 5 项缺陷修复
- [x] **T1.5** `src/content/core.js` XSS / 事件泄漏 / 空指针 / Blob 竞态修复
- [x] **T1.6** `background.js` / `connection.js` / `controller.js` 全平台化与 session 持久化
- [x] **T1.7** Phase 1 新增回归测试全部通过
- [x] **T2.1** `manifest.json` 权限收敛 + 死代码与脏文件清理
- [x] **T2.2** 版本号同步脚本 `scripts/sync-version.cjs`
- [x] **T2.3** `dom.js` TreeWalker 与 ShadowRoot 性能优化
- [x] **T2.4** `connection.js` 子 frame 容错优化
- [x] **T3.1** 智能命名 & YAML Frontmatter
- [x] **T3.2** 整场对话导出 & 多选批量导出
- [x] **T3.3** 矢量 PDF 打印页 + 原生 `.docx` 生成器 + 单文件离线 HTML
- [x] **T3.4** 深度思考（CoT）模式切换 & 引用脚注化
- [x] **T3.5** 预览可编辑 + 深色模式 + Obsidian 一键入库
- [x] **T3.6** Claude / Perplexity / Google AI Studio 专用适配
- [x] **T3.7** Options 设置页 + 本地历史记录 + 自定义站点规则
