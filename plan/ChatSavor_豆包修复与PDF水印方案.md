# ChatSavor 豆包转换修复与 PDF 去页脚/矢量水印增强实现规范（Execution Spec）

> **用途说明**：本文档面向自动化编程代理（DeepSeek Harness）及开发者，包含两个专项任务的**可执行级实现规范**：
> 1. **专项一（DOUBAO）**：彻底修复豆包（Doubao）按钮错位至用户提问操作栏、只提取时间戳（如 `星期日 12:30`）、表格头残留“表格”二字及整场/多选导出角色识别问题。
> 2. **专项二（PDF）**：彻底消除 PDF 导出底部的 `chrome-extension://.../print.html?id=... 1/1` 默认浏览器页脚，实现多页安全留白、可选来源页脚及 `position: fixed` 内联 `<svg>` 矢量水印系统（含实时预览与配置记忆）。
>
> **基线测试状态**：`npm --prefix chrome-extension test` 当前 **164/164 通过**。所有改动完成后不得破坏任何既有测试，且所有新增功能必须补齐真实的 JSDOM 运行时行为测试。

---

## 0. 既有测试契约与防踩坑红线（必读）

1. **零构建 MV3 规范**：保持原生 IIFE + `'use strict'` + `window.ChatSavor*` 风格，禁止 ESM `import/export` 和任何外网/CDN 请求。
2. **保护既有测试断言**：
   - `tests/platforms.test.cjs` 第 67 行使用了旧版最小化 Fixture `<div class="message-list-xxx"><div class="message-container-xxx"><div class="message-area-xxx">Doubao reply</div></div></div>`。重写 `doubao.js` 时，在语义选择器（`receive-message-action-bar` / `.flow-markdown-body`）未命中时，保留精确的 `[class*="message-area"]` 作为末尾兜底（排除操作栏与用户消息），确保该测试继续通过。
   - `tests/bugfix12.test.cjs` 中只模拟了 `chrome.storage.session`，**未定义 `chrome.storage.local`**；且断言了 `document.getElementById('content')` 存在。因此 `print.html` 中必须保留 `<article id="content"></article>`，`print.js` 访问 `chrome.storage.local` 时必须做严格判空 `if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.storage.local.get)`。
   - `tests/export-engine.test.cjs` 第 76–77 行断言 `print.html` 包含 `@media print` 与 `break-inside: avoid`，修改 `print.html` 样式时必须保留这两处 CSS 声明。

---

## 第一部分：豆包（Doubao）转换错位与只提取时间戳 Bug 彻底根治

### 背景与真实豆包 DOM 结构（Samantha / Flow 架构）

在真实豆包网页中，单条消息并不存在 `chat-main-messages` 或 `assistant-message` 类名，其真实 DOM 层级如下：

```html
<!-- 1. 用户提问轮次 -->
<div class="w-full inner-item-xxx" data-message-list-item-id="block_101">
  <div class="w-full">
    <div class="flex flex-row w-full justify-end ...">
      <div class="flex flex-col flex-grow max-w-full min-w-0">
        <!-- 用户正文容器（含 justify-end 与 send-msg-bubble） -->
        <div class="flex-row flex w-full justify-end" data-message-id="101">
          <div class="flex max-w-full flex-col gap-8">
            <div class="flex justify-end" data-plugin-identifier="block_type:10000">
              <div class="... bg-g-send-msg-bubble-bg text-g-send-msg-bubble-text">506M token对应的量是多少</div>
            </div>
          </div>
        </div>
        <!-- 用户操作栏（含时间戳“星期日 12:30”及复制/分享/编辑按钮，内层带 .message-action-bar-xxx 和 .group） -->
        <div class="select-none" data-foundation-type="send-message-action-bar">
          <div class="message-action-bar-xxx flex flex-row w-full group">
            <span>星期日 12:30</span>
            <div class="bp5-overflow-list message-action-button-main ...">
              <button aria-label="复制">...</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- 2. AI 回复轮次 -->
<div class="w-full inner-item-xxx" data-message-list-item-id="block_102">
  <div class="w-full">
    <div class="flex flex-row w-full ... group">
      <div class="flex flex-col flex-grow max-w-full min-w-0">
        <!-- AI 正文容器（不含 justify-end，内部含 .flow-markdown-body，可能还有表格卡片头“表格”或思考块） -->
        <div class="relative flex-row flex w-full" data-message-id="102">
          <div class="flex w-full flex-col space-y-20">
            <div data-plugin-identifier="block_type:10000">
              <div class="container-xxx flow-markdown-body mdbox-theme-next">
                <div class="paragraph-element">506M token = 5.06 亿个 token...</div>
                <!-- 豆包表格外层可能包裹工具栏头 -->
                <div class="table-wrapper">
                  <div class="table-header"><span>表格</span><button>复制</button></div>
                  <table><thead><tr><th>维度</th><th>换算结果</th></tr></thead><tbody><tr><td>中文汉字</td><td>约 5 亿</td></tr></tbody></table>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- AI 操作栏（历史消息未悬停时子层可能带 opacity-0 pointer-events-none；内含复制/朗读/赞踩/“星期日 12:30”） -->
        <div class="flex-row flex max-w-full min-w-0 flex-grow select-none" data-foundation-type="receive-message-action-bar">
          <div class="flex flex-col justify-end h-40 w-full select-none opacity-0 pointer-events-none">
            <div class="message-action-bar-xxx flex flex-row w-full group">
              <div class="bp5-overflow-list message-action-button-main ..."><button aria-label="复制">...</button></div>
              <span>星期日 12:30</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- 3. 底部推荐追问（非正文，必须排除） -->
<div data-foundation-type="receive-message-suggest-foundation">...</div>
```

**旧代码出错根因**：
1. 旧 `getResponseBodyHost` 硬编码 `root.firstElementChild.firstElementChild` 类名检查，在真实新版页面失效；
2. 跌落到 `findCopyControl(root)` 时只取全页第 1 个复制按钮（即用户提问的复制按钮），再用 `closest('[class*="message"]')` 命中了用户操作栏自身的 `.message-action-bar-xxx`，导致按钮插进用户操作栏、点击只提取出 `星期日 12:30`！

---

### Task D-01：重构 `chrome-extension/src/content/platforms/doubao.js`

- **目标文件**：`chrome-extension/src/content/platforms/doubao.js`

#### 详细实现步骤

1. **定义精准的排除与角色判定辅助函数**：
   - `NOISE_SELECTOR`（绝不允许作为回复容器，且提取正文时必须剥离）：
     ```js
     var NOISE_SELECTOR = [
       '.ai-saver-host', '.ai-saver-modal-host', '.ai-saver-select-host', '.ai-saver-select-mark',
       '[data-foundation-type="send-message-action-bar"]',
       '[data-foundation-type="receive-message-action-bar"]',
       '[data-foundation-type*="action-bar"]',
       '[data-foundation-type*="suggest"]',
       '[class*="message-action-bar"]',
       '[class*="message-action-button"]',
       '[class*="suggest-message"]'
     ].join(', ');
     ```
   - `THINKING_SELECTOR`（豆包深度思考块选择器）：
     ```js
     var THINKING_SELECTOR = '[data-plugin-identifier*="think"], [class*="think-stage"], [class*="thinking-content"], [class*="reasoning-content"], [class*="cot-content"]';
     ```
   - `resolveTurnItem(node)`：向上定位单条消息的外层边界容器（用于判断该消息整体是 User 还是 AI）：
     ```js
     function resolveTurnItem(el) {
       if (!el || !el.closest) return null;
       return el.closest('[data-message-list-item-id]') ||
         el.closest('[class*="message-container"]') ||
         (el.closest('[data-message-id]') && el.closest('[data-message-id]').parentElement) ||
         el;
     }
     ```
   - `isUserTurn(el)`：只要当前节点或其所属 `turnItem` 满足任一条件，立即判定为用户消息：
     1. `el.closest('[data-foundation-type="send-message-action-bar"]')` 为真；
     2. `turnItem.querySelector('[data-foundation-type="send-message-action-bar"]')` 存在（且**不存在** `receive-message-action-bar`）；
     3. `turnItem.querySelector('[class*="send-msg-bubble"]')` 存在；
     4. 所属 `[data-message-id]` 元素具有 `justify-end` 类（`hasExactClass(msgNode, 'justify-end')`，注意用 `classList.contains('justify-end')` 精确匹配，不用子串）；
     5. `el.closest('[data-role="user"], [data-testid*="user_message"], [data-testid*="send_message"]')` 为真。
   - `resolveAssistantBody(turnOrNode)`：给定一条 AI 消息项或内部节点，定位**纯正文挂载容器**（不含底部的 `receive-message-action-bar`）：
     1. 若节点在 `[data-message-list-item-id]` 内：优先取其内部的 `[data-message-id]`（排除含 `justify-end` 的节点）；
     2. 否则若 `turnOrNode.matches('[data-message-id]')`：直接返回它；
     3. 否则若包含 `.flow-markdown-body, [class*="flow-markdown-body"]`：若有多个 `.flow-markdown-body` 同属一个 `[data-message-id]` 或列容器，返回其共同的 `[data-message-id]`（无则返回该 `.flow-markdown-body` 的直接正文容器，且确保不包含 `NOISE_SELECTOR` 或提取时剥离）；
     4. 兜底返回 `turnOrNode`。

2. **重写 `findResponses(ctx)`（严格分层短路，彻底删除错误的 `findCopyControl + closest('[class*="message"]')`）**：
   - **第 1 层（最权威语义锚点：`receive-message-action-bar` 反向定位正文）**：
     - 查询所有 `[data-foundation-type="receive-message-action-bar"]`。
     - 对每个 bar，定位 `var turnItem = resolveTurnItem(bar);`，若 `!turnItem || isUserTurn(turnItem)` 则跳过。
     - 调用 `var body = resolveAssistantBody(turnItem);`，若 `body` 存在、不匹配 `NOISE_SELECTOR`、`ctx.isVisible(body)` 且**剥离 `NOISE_SELECTOR` 后的纯正文长度 `>= 2`**，加入候选列表。
     - 若候选非空，调用 `ctx.removeNested(ctx.deduplicate(list))` 立即返回！
   - **第 2 层（Markdown 正文类锚点：`.flow-markdown-body`）**：
     - 查询所有 `.flow-markdown-body, [class*="flow-markdown-body"], [class*="mdbox-theme"]`（排除 `THINKING_SELECTOR` 内部的节点）。
     - 向上归并到 `resolveAssistantBody(resolveTurnItem(node) || node)`，过滤 `!isUserTurn(el)`、`!el.matches(NOISE_SELECTOR)`、`ctx.isVisible(el)` 且有效正文长度 `>= 2`。
     - 若非空，去重去嵌套后立即返回！
   - **第 3 层（`[data-message-id]` 非用户行锚点）**：
     - 查询所有 `[data-message-id]`，过滤掉 `!isUserTurn(el)` 且内部有可见正文（排除 `NOISE_SELECTOR` 后长度 `>= 2`）的节点，若非空立即返回。
   - **第 4 层（兼容旧版与 `tests/platforms.test.cjs` 最小化 Fixture 兜底）**：
     - 依次查询 `['[class*="message-container"] [class*="message-area"]', '[class*="message-area"]', '[data-role="assistant"]', '[class*="assistant-message"]']`。
     - 严格过滤 `!el.closest(NOISE_SELECTOR)` 且 `!isUserTurn(el)` 且 `ctx.isVisible(el)`。
   - **严禁**再使用 `el.closest('[class*="message"]')` 这种会命中 `.message-action-bar` 的宽泛选择器！

3. **稳健常驻的按钮挂载位置 `mountButton(el, onClick)` 与 `hasButton(el)`**：
   - **禁止**把按钮塞进带 `opacity-0` / `pointer-events-none` 的隐藏操作栏内层，也**禁止**塞进 BlueprintJS 的 `.bp5-overflow-list` 内部（防止历史消息按钮隐形或被溢出折叠吞掉）。
   - **标准挂载方式**：
     - `el` 是 `findResponses` 返回的单条 AI 正文容器（如 `<div class="relative flex-row flex w-full" data-message-id="...">`）。
     - 使用 `core.createSaveButton(onClick)` 创建按钮宿主 `host`，加上属性 `host.setAttribute('data-chatsavor-owner', 'doubao')`。
     - 将 `host` 作为 `el` 的紧邻后置兄弟节点插入（即位于 AI 正文 `[data-message-id]` 正下方、`[data-foundation-type="receive-message-action-bar"]` 正上方，靠右对齐 `display:flex; justify-content:flex-end; padding:4px 0; margin-top:4px;`）。
     - `hasButton(el)` 检查 `el.nextElementSibling && el.nextElementSibling.classList.contains('ai-saver-host')` 或 `el.querySelector(':scope > .ai-saver-host[data-chatsavor-owner="doubao"]')`。
   - **效果**：无论是最新回复还是未鼠标悬停的历史回复，“转换”按钮在每条 AI 回复正文末尾 **100% 常驻显示、清晰可点**，且绝不会出现在右上角用户提问下方！

4. **深度清洗正文与表格装饰头 `extractReply(el, ctx)` & `extractThinking(el, ctx)`**：
   - `extractThinking(el)`：
     - 在 `resolveTurnItem(el)` 内查找 `THINKING_SELECTOR`，合并其文本返回（无则返回 `''`）。
   - `extractReply(el, ctx)`：
     - 克隆 `el`：`var clone = ctx.dom ? ctx.dom.clone(el) : el.cloneNode(true);`（包装在临时 `<div>` 中处理）。
     - 第 1 步：移除所有噪音节点 `clone.querySelectorAll(NOISE_SELECTOR + ', ' + THINKING_SELECTOR).forEach(n => n.remove());`。
     - 第 2 步：**清洗豆包表格卡片顶部“表格”装饰栏与代码块语言工具头**：
       - 遍历 `clone.querySelectorAll('table')`：检查 `table` 的前置兄弟元素（或 `table.parentElement` 的前置兄弟元素 `headerEl`）。如果该 `headerEl` 不包含 `table, p, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre`，且剥离 `button, [role="button"], svg` 后的纯文本去空白等于 `'表格'` 或 `'Table'`（`/^表格$|^table$/i`），直接 `headerEl.remove()`！
     - 第 3 步：调用 `ctx.core.extractMarkdown(clone)` 返回 `{ markdown }`。

5. **显式实现 `getTurns(ctx)`（修复豆包“导出整场对话”与“多选导出”）**：
   - 查找所有用户轮次：遍历 `[data-message-list-item-id]` 或 `[data-message-id]` 中满足 `isUserTurn` 的项，取其气泡节点 `[class*="send-msg-bubble"]`（若无则取 `[data-message-id]`，这样提取用户问题时天然不包含 `send-message-action-bar` 里的 `星期日 12:30`！）。
   - 查找所有 AI 轮次：调用修复后的 `findResponses(ctx)`。
   - 合并为 `{ role: 'user' | 'assistant', element }`，去重、校验可见性后按 `ctx.dom.compare` 文档顺序排序返回。

---

## 第二部分：PDF 导出隐藏 `chrome-extension://...` 默认页脚与矢量水印系统

### Task P-01：重构 `print.html` 与 `print.js`（去扩展 URL + 多页安全边距 + 矢量水印 + 实时控制栏）

- **目标文件**：
  - 修改：`chrome-extension/src/export/print.html`
  - 修改：`chrome-extension/src/export/print.js`
  - 修改：`chrome-extension/src/content/core.js`（向打印 payload 补充 `platform` 与 `datetime` 字段）

#### 1. `core.js` 传递完整元信息（`downloadPdf`）
在 `chrome-extension/src/content/core.js` 的 `downloadPdf(markdown, prepared)` 中，构造 `CHATSAVOR_OPEN_PRINT` 的 `payload` 时补充 `platform` 和 `datetime`：
```js
payload: {
  title: title,
  html: html,
  filename: (prepared ? prepared.filename : 'ai-response') + '.pdf',
  markdown: preparedText,
  platform: (meta && meta.platform) || 'AI',
  datetime: (meta && meta.datetime) || (meta && meta.date) || ''
}
```

#### 2. `print.html` 页面结构与打印排版架构
1. **彻底消除浏览器默认 `chrome-extension://... 1/1` 页眉页脚**：
   - 在 `@media print` 中设置：
     ```css
     @page {
       size: A4;
       margin: 0;
     }
     ```
   - 同时保留一个可选模式类 `body.native-page-margin`：仅当用户在下拉框主动选择 `浏览器原生页码` 时，才切换一个动态 `<style id="dynamic-page-style">` 写入 `@page { size: A4; margin: 16mm; }`（默认不启用，默认 `@page { margin: 0; }` 100% 隐藏 `chrome-extension://...`）。
   - 加上全局打印色彩保真：
     ```css
     html, body {
       -webkit-print-color-adjust: exact;
       print-color-adjust: exact;
     }
     ```
2. **使用 `<table class="print-frame">` 解决 `@page { margin: 0 }` 下的多页上下留白**：
   - HTML 正文骨架：
     ```html
     <div id="watermark-layer" aria-hidden="true"></div>
     <table class="print-frame" role="presentation">
       <thead>
         <tr><td><div class="page-margin-top"><span id="running-header"></span></div></td></tr>
       </thead>
       <tbody>
         <tr><td class="page-body-cell"><article id="content"></article></td></tr>
       </tbody>
       <tfoot>
         <tr><td><div class="page-margin-bottom"><span id="running-footer"></span></div></td></tr>
       </tfoot>
     </table>
     ```
   - 关键打印样式（**注意保留 `@media print` 和 `break-inside: avoid` 以兼容既有测试**）：
     - `.print-frame { width: 100%; border-collapse: collapse; border: 0; }`
     - `.print-frame > thead > tr > td, .print-frame > tbody > tr > td, .print-frame > tfoot > tr > td { border: 0; padding: 0; }`
     - 屏幕预览下：`#content` 居中卡片显示（`max-width: 820px; margin: 20px auto; padding: 24px 32px;`）。
     - `@media print` 下：
       - `#toolbar { display: none !important; }`
       - `.page-margin-top { height: 16mm; padding: 0 18mm; display: flex; align-items: flex-end; justify-content: space-between; font-size: 9pt; color: #9ca3af; box-sizing: border-box; padding-bottom: 3mm; }`
       - `.page-margin-bottom { height: 16mm; padding: 0 18mm; display: flex; align-items: flex-start; justify-content: space-between; font-size: 9pt; color: #9ca3af; box-sizing: border-box; padding-top: 3mm; }`
       - `.page-body-cell { padding: 0 18mm; }`
       - `#content { max-width: none; margin: 0; padding: 0; }`
       - 保留 `h1, h2, h3 { break-after: avoid; }` 与 `pre, table, blockquote { break-inside: avoid; }`（注意加限定 `#content table` 只对正文内的 Markdown 表格加边框和 `break-inside: avoid`，**绝不能**给外层 `.print-frame` 加 `break-inside: avoid` 或边框！）。
3. **顶部实时预览控制栏 `#toolbar` UI 控件**：
   - **页脚样式 `<select id="footerMode">`**：
     - `none`：`无页眉页脚（纯净）`（默认）
     - `source`：`显示来源与时间`（页眉显示文档标题，页脚显示 `来源：{platform} · 导出时间：{datetime}`）
     - `custom`：`自定义页脚文字`（显示输入框 `<input type="text" id="footerText" placeholder="输入页脚署名…">`）
   - **水印模式 `<select id="watermarkMode">`**：
     - `none`：`无水印`（默认）
     - `tiled`：`全页斜向平铺水印`
     - `corner`：`右下角标水印`
   - **水印文字 `<input type="text" id="watermarkText" placeholder="水印文字（如 ChatSavor）" value="ChatSavor">`**（当 `watermarkMode !== 'none'` 时可用/显示）
   - **水印浓度 `<input type="range" id="watermarkOpacity" min="0.03" max="0.20" step="0.01" value="0.07">`**
   - **自动打印复选框 `<label><input type="checkbox" id="autoPrint" checked> 打开时自动唤起打印</label>`**
   - **主操作按钮 `<button id="print">打印 / 保存为 PDF</button>`** + 状态提示 `<span id="status"></span>`

#### 3. 内联 `<svg>` 矢量水印渲染逻辑（`print.js`）
- `#watermark-layer` 样式：
  `position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; user-select: none; z-index: 9999; overflow: hidden;`
- **实现 `renderWatermark(state)`（纯 DOM API / 安全转义创建 SVG，严禁未转义拼接导致 XSS）**：
  1. `state.watermarkMode === 'none'` 或 `!state.watermarkText.trim()`：清空 `#watermark-layer`。
  2. `state.watermarkMode === 'tiled'`（全页斜向平铺）：
     - 创建 `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">`：
       - `<defs><pattern id="cs-wm-pattern" width="260" height="180" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">`
       - 在 pattern 内创建 `<text x="20" y="100" fill="#111827" fill-opacity="{opacity}" font-size="16" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif" font-weight="500">{escapedText}</text>`
       - 外层 `<rect width="100%" height="100%" fill="url(#cs-wm-pattern)"/>`
  3. `state.watermarkMode === 'corner'`（每页右下角标）：
     - 在 `#watermark-layer` 右下角（`position: absolute; right: 18mm; bottom: 8mm;`）放置 SVG 或轻量角标文本，透明度为 `Math.min(0.45, opacity * 3)`，字号 `11pt`，不遮挡任何正文。
- **地址栏净化**：
  - `print.js` 在读取完 `location.search` 中的 `id` 参数后，尝试调用 `try { history.replaceState(null, '', location.pathname); } catch (ignored) {}` 抹掉地址栏上冗长的 `?id=print_...` 随机串。

#### 4. 配置持久化与自动打印友好体验（`print.js` & `options.html` & `options.js`）
1. **与 `prefs` 互通**：
   - 在 `prefs`（`chrome.storage.local`）中扩展以下可选字段及默认值：
     - `pdfFooterMode`: `'none'`
     - `pdfFooterText`: `''`
     - `pdfWatermarkMode`: `'none'`
     - `pdfWatermarkText`: `'ChatSavor'`
     - `pdfWatermarkOpacity`: `0.07`
     - `pdfAutoPrint`: `true`
   - `print.js` 启动时先尝试读取 `chrome.storage.local.get('prefs', ...)`（若无 `chrome.storage.local` 则安全降级使用上述默认值，确保 `tests/bugfix12.test.cjs` 完全兼容！）。
   - 用户在 `print.html` 工具栏修改任意水印/页脚/自动打印控件时：
     - 立即实时刷新页面上的页眉页脚与 `#watermark-layer` 预览；
     - 若启动时的 `autoPrint` 定时器尚未触发，**一旦用户主动交互工具栏控件，立即 `clearTimeout(autoPrintTimer)`**，让用户从容调好水印后再点“打印 / 保存为 PDF”；
     - 将最新 PDF 设置异步合并回 `chrome.storage.local` 的 `prefs`，下次导出自动沿用。
2. **同步在 `options.html` & `options.js` 增加默认配置项**：
   - 在 `options.html` 的“全局导出偏好”区域新增：
     - 默认 PDF 页脚样式（`#pdfFooterMode`：`none` / `source` / `custom`）与自定义页脚文字（`#pdfFooterText`）
     - 默认 PDF 水印样式（`#pdfWatermarkMode`：`none` / `tiled` / `corner`）与默认水印文字（`#pdfWatermarkText`）
   - 在 `options.js` 的 `loadPrefs()` 和 `$('save')` 点击事件中同步读写这 4 个字段（保留所有原有字段不变，确保 `tests/options.test.cjs` 100% 兼容）。

---

## 第三部分：真行为回归测试要求（Task T-01）

- **目标文件**（新建）：
  - `chrome-extension/tests/doubao-real-layout.test.cjs`
  - `chrome-extension/tests/pdf-watermark.test.cjs`

### 1. `doubao-real-layout.test.cjs` 必测用例
使用上文给出的**真实豆包 Samantha/Flow DOM 结构**（同时包含带 `send-message-action-bar` + `星期日 12:30` + 复制按钮的用户提问、带 `receive-message-action-bar` + `.flow-markdown-body` + 表格卡片头 `表格` + 底部 `星期日 12:30` 的 AI 回复、以及底部 `receive-message-suggest-foundation` 推荐追问）：
1. **按钮绝不错位至用户消息**：验证 `adapter.getResponses()` 只返回 AI 回复（数量为 1），用户提问区域及 `send-message-action-bar` 内**0 个** `.ai-saver-host` 按钮；AI 回复正文容器后成功挂载 **1 个** `.ai-saver-host` 按钮（即使 `receive-message-action-bar` 内层带有 `opacity-0` 也不影响按钮可见性）。
2. **正文完整提取且不混入时间戳和“表格”装饰头**：点击转换后，提取出的 Markdown 包含完整的 AI 正文段落和标准 Markdown 表格（`| 维度 | 换算结果 |`），且**不包含** `星期日 12:30`、**不包含**推荐追问文字、表格上方**没有**多余的孤立 `表格` 行。
3. **多轮对话与 `EXPORT_ALL` 精准角色分离**：2 轮问答（User1 + AI1 + User2 + AI2）调用 `ChatSavorBridge.handle('EXPORT_ALL')`，生成 4 段按序排列的 `👤 User` / `🤖 Assistant` 内容，User 段落仅含提问正文、不含 `星期日 12:30`。

### 2. `pdf-watermark.test.cjs` 必测用例
在 JSDOM 中真实加载 `print.html` 与 `print.js`：
1. **默认隐藏扩展 URL 样式校验**：验证 `print.html` 包含 `@page` 且默认设置 `margin: 0`，包含 `.print-frame` 的 `<thead>` / `<tfoot>` 分页留白骨架，且正文表格选择器 `#content table` 不会污染外层 `.print-frame`。
2. **页脚三模式切换实时生效**：切换 `#footerMode` 为 `none` -> `#running-footer` 为空；切换为 `source` -> `#running-footer` 显示传入的 `platform` 和 `datetime`；切换为 `custom` 并输入文字 -> `#running-footer` 实时显示自定义署名。
3. **矢量 SVG 水印实时渲染与防 XSS**：
   - 默认 `watermarkMode = 'none'` 时 `#watermark-layer` 无 SVG；
   - 切换为 `tiled` 并输入 `内部资料 <script>alert(1)</script>`，断言 `#watermark-layer` 内生成了 `<svg>` 与 `<pattern>`，文本被安全转义为纯文本节点（无 `<script>` 元素），`fill-opacity` 随 `#watermarkOpacity` 变化实时更新；
   - 切换为 `corner` 时生成右下角标水印。
4. **配置持久化与用户交互取消自动打印**：修改工具栏选项后，`chrome.storage.local` 中的 `prefs` 同步保存了 `pdfWatermarkMode` / `pdfWatermarkText` / `pdfFooterMode`；且在自动打印倒计时触发前修改工具栏控件会取消自动 `window.print()`，点击 `#print` 按钮仍可正常调用 `window.print()`。

---

## 四、执行自检 Checklist

- [x] **Task D-01** 重构 `src/content/platforms/doubao.js`（精准角色隔离、常驻挂载、剥离时间戳/表格头/推荐追问、补齐 `getTurns` 与 `extractThinking`）
- [x] **Task P-01** 升级 `core.js`、`print.html`、`print.js`、`options.html`、`options.js`（`@page { margin: 0 }` + `print-frame` 多页留白 + 页脚三模式 + SVG 矢量水印 + 偏好记忆）
- [x] **Task T-01** 新增 `tests/doubao-real-layout.test.cjs` 与 `tests/pdf-watermark.test.cjs` 全部通过
- [x] 全量运行 `npm --prefix chrome-extension test`（164 + 新增测试全部 0 fail, 0 skipped）
- [x] 运行 `npm --prefix chrome-extension run check:version` 通过，且 `git status` 无临时调试垃圾文件
