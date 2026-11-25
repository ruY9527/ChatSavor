# ChatSavor 全局 UI 视觉体系与交互体验升级方案（DeepSeek Harness 专用执行规范）

> **文档定位**：本规范面向自动化编码代理（DeepSeek Harness），用于对 ChatSavor 的 **6 大用户界面触点**（网页内嵌操作胶囊、预览与导出工作台弹窗、多选悬浮底栏、扩展 Popup 面板、Options 设置与历史中心、PDF 打印工作台与本地库授权页）进行**系统级视觉重塑与交互减负升级**。
>
> **设计语言目标**：告别早期粗糙的紫粉高饱和渐变条、原生裸露表单控件与“14 个按钮无序堆叠”的拥挤底栏，全面对齐 **Linear / Raycast / Notion** 的现代极简生产力美学——中性岩灰层次（Slate Surface）、精致微边框（Hairline Border）、毛玻璃背景遮罩、清晰的图标+语义分组操作区、一键直达快捷交互，以及完整的浅色/深色（Light / Dark）自适应体验。

---

## 零、 工程红线与 195+ 现有单测零回归契约（执行前必读！）

仓库当前拥有 **195+ 项自动化测试**，大量测试对 DOM 选择器、节点属性以及按钮的 `button.textContent` 存在精确断言。**在美化 UI 与重构布局时，严禁破坏以下契约**：

1. **零构建（Zero-Build）MV3 纯净架构**：
   - 所有脚本保持原生 JS IIFE + `'use strict'`，所有图标必须使用**内联矢量 `<svg>`**（14×14 或 16×16 线性图标，`stroke="currentColor"`），**严禁引入任何外部字体图标库、外部 CSS CDN、Tailwind 运行时或构建打包工具**。
2. **按钮图标零文本污染法则（极其关键！）**：
   - 现有测试（如 `preview-ux.test.cjs`、`bugfix09.test.cjs`、`markdown.test.cjs`、`metadata.test.cjs`、`conversation-export.test.cjs`）通过 `[...shadow.querySelectorAll('button')].find(b => b.textContent === 'xxx')` 查找按钮！
   - 因此给按钮添加 SVG 图标时，**`<svg>` 内部严禁包含 `<title>`、`<text>` 或任何空白换行缩进文本，且图标容器与文字容器之间严禁拼接空格字符**（间距完全由 CSS `display: inline-flex; align-items: center; gap: 5px` 控制）！
   - 标准安全实现模板（保证 `btn.textContent === text` 恒成立）：
     ```js
     function makeBtn(text, className, onClick, svgMarkup) {
       var btn = document.createElement('button');
       btn.type = 'button';
       btn.className = className;
       if (svgMarkup) {
         var iconWrap = document.createElement('span');
         iconWrap.className = 'btn-icon';
         iconWrap.setAttribute('aria-hidden', 'true');
         // 移除 svg 标签间多余空白，杜绝任何空白文本节点影响 btn.textContent
         iconWrap.innerHTML = String(svgMarkup).replace(/>\s+</g, '><').trim();
         btn.appendChild(iconWrap);
       }
       var labelWrap = document.createElement('span');
       labelWrap.className = 'btn-label';
       labelWrap.textContent = text;
       btn.appendChild(labelWrap);
       btn.addEventListener('click', onClick);
       return btn;
     }
     ```
   - 当执行复制成功态文案切换（如 `copyWithFeedback` 或 `正在生成 PDF…`）时，**只更新 `btn.querySelector('.btn-label')` 的 `textContent`**（若无 `.btn-label` 再回退 `btn`），结束后恢复原 `label`，既保留图标不闪烁，又保持测试兼容！
3. **预览弹窗（`core.js`）不可更改的文案与类名白名单**：
   - 宿主与结构类名：`.ai-saver-host`、`.save-btn`、`.ai-saver-modal-host`、`.overlay`、`.modal`（深色模式类名 `.dark`）、`.theme-btn`、`.close-btn`、`.tabs`、`.tab`（激活态 `.active`）、`select.cot-mode`、`.preview`、`textarea.raw-md.raw-md-editor`（必须同时同步 `.value` 和 `.textContent`）、`.formula-list`、`.formula-item`、`.formula-item pre`、`.compatibility`、`.copy-status[role="status"]`、`.frontmatter-toggle`（内部含 `input[type="checkbox"]`）、`select.card-theme-select`。
   - 按钮精确 `textContent`（一个字都不能改！）：
     - `'复制 Markdown'`、`'复制富文本'`、`'发送到 Obsidian'`、`'保存到本地库'`、`'复制长图'`、`'下载长图'`、`'复制 LaTeX'`
     - `'.md'`、`'.pdf'`、`'.docx'`、`'.tex'`、`'.html'`、`'.zip (离线含图)'`
4. **多选模式（`bridge.js`）不可更改的契约**：
   - `.ai-saver-select-host`、`.cs-count`（格式含 `'已选中 X / Y 条'`）、按钮精确 `textContent`：`'全选'`、`'仅选 AI 回复'`、`'导出选中'`、`'取消'`。
   - `.ai-saver-select-mark` **必须保留** `bugfix02.test.cjs` 断言的内联样式与属性：`position: absolute`、`width: 20px`、`height: 20px`、`display: flex`、`role="checkbox"`、`aria-checked="false"|"true"`、未选中 `textContent === ''`、选中后 `textContent === '✓'` 且 `mark.style.background === '#667eea'`！
5. **Popup / Options / Print / Writer 不可删改的 ID 与打印样式契约**：
   - `popup.html` 保留全部 ID：`#version`、`#page-status`、`#page-detail`、`#scan-page`、`#convert-latest`、`#convert-selection`、`#export-all`、`#multi-select`、`#copy-diagnostics`，以及 `controller.js` 中原有的状态与错误提示关键字。
   - `options.html` 保留全部 ID：`#status`、`#frontmatter`、`#cotMode`、`#vault`、`#vaultDir`、`#boundFolderStatus`、`#bindFolder`、`#unbindFolder`、`#theme`、`#historyEnabled`、`#pdfFooterMode`、`#pdfFooterText`、`#pdfWatermarkMode`、`#pdfWatermarkText`、`#save`、`#historySearch`、`#clearHistory`、`#historyList`、`#customRules`、`#saveRules`、`#exportRules`、`#importRules`、`#importFile`。
   - `print.html` **严禁破坏 `@media print` 内的 `@page { size: A4; margin: 0; }`、`.print-frame` 骨架与选择器优先级**！仅优化 `@media screen` 屏幕预览外观与顶部 `#toolbar` 视觉设计。
   - 严禁触碰或重新生成 `src/lib/katex.js`（保护 quirks-mode 补丁）。

---

## 一、 统一设计令牌体系（Design Tokens）

全扩展 6 个界面统一采用以下现代中性色 + 靛蓝主色（Indigo）色彩与圆角规范：

| 语义令牌 | 浅色模式（Light） | 深色模式（Dark） | 说明 |
| --- | --- | --- | --- |
| `--cs-bg` | `#ffffff` | `#0f172a` | 主卡片 / 弹窗底色 |
| `--cs-surface` | `#f8fafc` | `#1e293b` | 工具栏 / 次级面板底色 |
| `--cs-surface-2` | `#f1f5f9` | `#020617` | 页面画布 / 分段控制器槽底色 |
| `--cs-text` | `#0f172a` | `#f1f5f9` | 主标题与正文颜色 |
| `--cs-text-secondary` | `#334155` | `#cbd5e1` | 次级正文颜色 |
| `--cs-muted` | `#64748b` | `#94a3b8` | 辅助说明与元信息颜色 |
| `--cs-border` | `#e2e8f0` | `#334155` | 1px 精致分割线与卡片边框 |
| `--cs-accent` | `#4f46e5` | `#6366f1` | 主操作按钮（Indigo 600/500） |
| `--cs-accent-hover` | `#4338ca` | `#818cf8` | 主按钮悬停色 |
| `--cs-accent-soft` | `#eef2ff` | `rgba(99,102,241,0.16)` | 激活态胶囊 / 高亮弱背景 |
| `--cs-success` | `#059669` | `#34d399` | 成功反馈色 |
| `--cs-danger` | `#dc2626` | `#f87171` | 错误 / 删除危险操作色 |

通用细节规范：
- **字体栈**：`-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif`
- **代码字体栈**：`"JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, Menlo, monospace`
- **动效曲线**：弹窗入场 `csModalIn 180ms cubic-bezier(0.16, 1, 0.3, 1)`（轻微 `scale(0.97) -> scale(1)` + `opacity`），按钮微交互 `transition: all 140ms ease`，焦点态统一提供 `:focus-visible { outline: 2px solid var(--cs-accent); outline-offset: 2px; }`。

---

## 二、 分模块详细升级规范（Task UI-01 ～ Task UI-06）

---

### Task UI-01：升级网页内嵌回复操作胶囊（一键复制 MD + 预览导出双联胶囊）

**修改文件**：[core.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/core.js)（`createSaveButton` 与 `injectButtonAfter`）

#### 现存痛点
当前每条 AI 回复末尾只有一个高饱和紫粉渐变按钮 `'🔄 转换'`，视觉突兀且每次只想复制干净 Markdown 时也必须先打开弹窗再找按钮（3 步操作）。

#### 升级方案
1. **升级 `createSaveButton(onClick, quickCopyHandler)` 为精致双联悬浮胶囊（`.cs-action-pill`）**：
   - 外层 `.ai-saver-host`：`display: flex; justify-content: flex-end; padding: 6px 0 2px; margin-top: 6px;`。
   - Shadow DOM 内部容器 `.cs-action-pill`：
     - 采用半透明微边框胶囊造型，完美融入各家 AI 平台（ChatGPT / DeepSeek / Claude / 豆包）的浅色与深色背景：
     - 浅色默认：`background: rgba(255,255,255,0.92); border: 1px solid rgba(226,232,240,0.95); box-shadow: 0 2px 8px rgba(15,23,42,0.06); border-radius: 999px; padding: 2px; display: inline-flex; align-items: center; gap: 2px; backdrop-filter: blur(8px);`
     - `@media (prefers-color-scheme: dark)` 自适应：`background: rgba(30,41,59,0.88); border-color: rgba(71,85,105,0.7); box-shadow: 0 2px 10px rgba(0,0,0,0.25);`
   - **主按钮 `.save-btn`**（左半胶囊或单按钮）：
     - 保留类名 `.save-btn` 与点击回调 `onClick()`！
     - 内置 13×13 线性文档/导出 SVG 图标 + 文字 `'导出 / 预览'`（字体 `12px`，字重 `500`，颜色 `#4f46e5`，深色下 `#818cf8`；悬停时背景变为 `#4f46e5`、文字变为 `#ffffff`，圆角 `999px`，清爽现代，不再喧宾夺主）。
   - **快捷一键复制按钮 `.quick-copy-btn`**（右半胶囊，当传入 `quickCopyHandler` 时渲染，中间配 `1px × 12px` 细分割线）：
     - 内置 13×13 复制剪贴板 SVG 图标 + `<span class="btn-label">复制 MD</span>`。
     - 点击时阻止冒泡，直接调用 `quickCopyHandler()` 提取当前回复的 Markdown（并根据当前 `frontmatterEnabled()` 决定是否附带 Frontmatter，同时调用 `saveHistory`）写入剪贴板！
     - 复制成功后 `.btn-label` 变为 `'✓ 已复制'` 并赋予翠绿高亮 `.is-copied`（`color: #059669`），`1400ms` 后自动恢复 `'复制 MD'`！
2. **在 `injectButtonAfter(container, onClick)` 中自动接入快捷复制能力**：
   - 在 `injectButtonAfter(container, onClick)` 内部构造 `quickCopyHandler`：调用 `extractMarkdown(container)` 拿到 `{ markdown }`，通过 `window.ChatSavorMarkdown.copy(finalText, false)` 一键复制，让日常高频复制从 **3 次点击缩减为 1 次点击**！（同时直接调用 `createSaveButton(onClick)` 不传第二参数的单测也完全向后兼容）。

---

### Task UI-02：重构预览与导出工作台弹窗（告别 14 按钮乱序堆叠，打造两层分组操作坞 + 宽屏模式）

**修改文件**：[core.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/core.js)（`renderPreviewModal`）

#### 现存痛点
1. 弹窗宽度仅 `720px`，顶部是刺眼的紫粉渐变横幅，预览宽表格或公式时非常局促；
2. 底部 `.modal-footer` 把 **14 个未分组控件**一股脑平铺 `flex-wrap`，折成 3～4 行参差不齐的按钮海，`.md`、`.tex` 与 `极简白` 下拉框、`发送到 Obsidian` 混成一团，毫无主次。

#### 升级方案（精准保留全部测试契约！）

1. **遮罩与弹窗主框架（`.overlay` & `.modal`）**：
   - `.overlay`：`background: rgba(15, 23, 42, 0.52); backdrop-filter: blur(6px); padding: 16px; box-sizing: border-box;`
   - `.modal`：默认宽度升级为 **`860px`**（`max-width: 94vw; max-height: 88vh; border-radius: 16px; border: 1px solid var(--cs-border); box-shadow: 0 25px 65px -12px rgba(15, 23, 42, 0.32); animation: csModalIn 180ms cubic-bezier(0.16, 1, 0.3, 1);`）。
   - **新增宽屏阅读模式 `.modal.expanded`**：宽度扩展至 **`1140px`**（`max-width: 96vw; height: 92vh; max-height: 92vh`），阅读宽幅学术表格与长代码极其舒适！

2. **现代扁平化顶栏（`.modal-header`）**：
   - 取消刺眼的紫粉渐变！采用干净的 `background: var(--cs-bg); color: var(--cs-text); border-bottom: 1px solid var(--cs-border); padding: 14px 20px; display: flex; align-items: center; gap: 10px;`。
   - **左侧品牌与动态标题区**：
     - 一个精致的 `28×28` 圆角靛蓝渐变微徽标（内嵌白色书签/星芒 SVG）+ `<h2>` 标题（根据 `options.mode` 智能显示：`'conversation'` → `'整场对话预览与导出'`，`'selection'` → `'多选回复预览与导出'`，默认 `'AI 回复预览'`）。
     - **实时文档统计胶囊 `.doc-stats`**：在标题旁展示淡雅胶囊徽章，例如 `"{charCount} 字符"`（若 `options.turnsCount` 存在则拼 `" · {turnsCount} 轮"`），在编辑器输入变更时同步刷新字符数！
   - **右侧窗口控制按钮组（`margin-left: auto; display: flex; align-items: center; gap: 6px`）**：
     - **宽屏切换按钮 `.expand-btn`**（`30×30` 幽灵图标按钮，`title="切换宽屏视图"`）：内嵌展开/收起矢量 SVG 图标，点击切换 `modal.classList.toggle('expanded')`。
     - **主题切换按钮 `.theme-btn`**（保留 `.theme-btn` 类名！`30×30` 幽灵图标按钮，`title="切换浅色/深色主题"`）：保留原有点击逻辑（切换 `modal.classList.toggle('dark', isDark)` 并 `persistPref('theme', ...)`），使用精致太阳/月亮 SVG 图标（无文本干扰）。
     - **关闭按钮 `.close-btn`**（保留 `.close-btn` 类名！`30×30` 幽灵图标按钮，悬停浅红/中性高亮）：保留 `closeBtn.textContent = '✕'` 或无文本 SVG。

3. **分段胶囊标签栏与导出选项条（`.tabs`）**：
   - `.tabs`：`display: flex; align-items: center; gap: 10px; padding: 8px 20px; background: var(--cs-surface); border-bottom: 1px solid var(--cs-border); flex-wrap: wrap;`
   - **左侧分段控制器槽 `.tab-group`**（`display: inline-flex; background: var(--cs-surface-2); padding: 3px; border-radius: 9px; gap: 2px;`）：
     - 放置 `.tab` 按钮：`预览`、`Markdown`、`公式 (N)`（注意：`rebuildFormulas` 动态增删 `tabFormulas` 时，插入到 `tabGroup` 末尾，即 `if (!tabFormulas.parentNode) tabGroup.appendChild(tabFormulas)`，这样无论是否有 `cotSelect` 都永远排在 `Markdown` 右侧，且 `shadow.querySelectorAll('.tab')` 顺序完全不变！）。
     - `.tab` 样式：`padding: 5px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--cs-muted); border: none; background: transparent;`
     - `.tab.active` 样式：`background: var(--cs-bg); color: var(--cs-accent); font-weight: 600; box-shadow: 0 1px 3px rgba(15,23,42,0.08);`
   - **右侧文档级开关区 `.tabs-controls`**（`margin-left: auto; display: flex; align-items: center; gap: 12px;`）：
     - 将 **Frontmatter 开关 `label.frontmatter-toggle`** 从拥挤的底栏上移到 `.tabs-controls` 中！用纯 CSS 将其美化为现代 **胶囊拨杆开关（Toggle Switch）**：
       - 结构：`<label class="frontmatter-toggle"><input type="checkbox"><span class="switch-slider" aria-hidden="true"></span><span>Frontmatter</span></label>`（`title="在 .md / ZIP / 本地库 / Obsidian 导出中包含 YAML 元数据头"`；内部依然是 `.frontmatter-toggle input`，`metadata.test.cjs` 100% 兼容！）。
     - 若存在 `thinking`，`select.cot-mode` 也放在 `.tabs-controls` 中，赋予精致自定义下拉箭头样式。

4. **高品质内容阅读与编辑区（`.modal-body`）**：
   - 内边距升级为 `22px 28px`，自定义细滚动条样式（`::-webkit-scrollbar { width: 6px; height: 6px }`）。
   - `.preview` 升级现代文档排版：
     - 正文 `14.5px`，行高 `1.78`，颜色 `var(--cs-text)`；
     - `h1` 底部配细分割线，`h2/h3` 间距呼吸感充足；
     - `table` 圆角外框边框、表头 `var(--cs-surface)` 底色、偶行柔和斑马纹；
     - `pre` 圆角 `10px`、`1px solid var(--cs-border)` 边框，行内 `:not(pre) > code` 带柔和底色胶囊 `padding: 2px 5px; border-radius: 4px;`；
     - `blockquote` 左侧 `3.5px solid var(--cs-accent)` + 圆角浅底色。
   - `textarea.raw-md.raw-md-editor`：圆角 `10px`，等宽字体，聚焦时靛蓝光晕边框 `box-shadow: 0 0 0 3px var(--cs-accent-soft)`，高度自适应 `min-height: 320px`。
   - `.formula-list`（公式标签页）：
     - 若公式数 `> 1`，在列表顶部提供一个便捷栏（含提示文字与非冲突辅助动作，但注意不要使用已有测试拦截的同名按钮文本），每条 `.formula-item` 升级为带圆角边框的独立卡片（顶部显示徽章 `独立公式 #1` / `行内公式 #2` + 右上角 `'复制 LaTeX'` 按钮，下方为代码块预览）。

5. **状态反馈横幅（`.compatibility` & `.copy-status`）**：
   - `.compatibility`：柔和信息提示条（圆角小图标背景，`font-size: 12px; color: var(--cs-muted); background: var(--cs-surface); border-bottom: 1px solid var(--cs-border); padding: 7px 20px;`）。
   - `.copy-status`：当非空时显示在底栏上方（`padding: 8px 20px; font-size: 12.5px; font-weight: 500; border-top: 1px solid var(--cs-border)`），可添加辅助函数 `setStatus(text, tone)` 自动切换 `data-tone="success|error|info"` 配色（同时兼容直接给 `copyStatus.textContent = ...` 赋值的默认蓝色信息条样式）。

6. **全新两层结构化底部操作坞（`.modal-footer` —— 彻底终结按钮乱象！）**：
   `.modal-footer` 采用纵向双行布局（`display: flex; flex-direction: column; gap: 10px; padding: 12px 20px 14px; background: var(--cs-surface); border-top: 1px solid var(--cs-border);`）：

   - **第一行 `.footer-row-top`（高频动作：复制 + 知识库直达 + 社交长图一体舱）**：
     `display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;`
     - **左组 `.action-group`（剪贴板与笔记软件）**：
       1. `btnCopy`（`'复制 Markdown'`）：设为 **全场唯一高权重主色按钮 `.btn.btn-primary`**（配复制图标，因为这是 80% 用户的第一操作！）
       2. `btnRich`（`'复制富文本'`）：`.btn.btn-secondary`（配富文本图标）
       3. `btnObsidian`（`'发送到 Obsidian'`）：`.btn.btn-secondary.btn-obsidian`（配宝石/外链图标，悬停淡紫微高亮）
       4. `btnVault`（`'保存到本地库'`）：`.btn.btn-secondary`（配文件夹落盘图标）
     - **右组 `.card-capsule`（社交长图一体化胶囊组件！）**：
       - 用一个带圆角边框的一体化组合框（`display: inline-flex; align-items: center; background: var(--cs-bg); border: 1px solid var(--cs-border); border-radius: 9px; padding: 2px; gap: 2px;`）将以下 3 个元素严密收纳在一起：
         1. `cardTheme`（`select.card-theme-select`：无外边框嵌入胶囊左侧，`极简白 / 深邃夜 / 学术暖纸`）；
         2. 竖向细分割线 `<span class="capsule-sep" aria-hidden="true"></span>`；
         3. `btnCopyCard`（`'复制长图'`，幽灵胶囊按钮，配图片图标）；
         4. `btnDownloadCard`（`'下载长图'`，幽灵胶囊按钮，配下载图标）。
       - **交互直观度质变**：用户一眼就能看懂主题下拉框是专门控制长图配色的！

   - **第二行 `.footer-row-bottom`（多格式离线文档下载船坞）**：
     `display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding-top: 8px; border-top: 1px dashed var(--cs-border);`
     - 左侧前缀小标签：`<span class="dock-label" aria-hidden="true">导出文档</span>`（`font-size: 11.5px; font-weight: 600; color: var(--cs-muted); margin-right: 4px;`）
     - 依次排列整齐划一的文档格式胶囊按钮（`.btn.btn-format`，带 13×13 精细矢量图标，`background: var(--cs-bg); border: 1px solid var(--cs-border); color: var(--cs-text-secondary); border-radius: 7px; padding: 5px 11px; font-size: 12px; font-weight: 500;`，悬停时边框变 `--cs-accent`、背景变 `--cs-accent-soft`、文字变 `--cs-accent`）：
       1. `btnMd`（`'.md'`）
       2. `btnPdf`（`'.pdf'`）
       3. `btnDocx`（`'.docx'`）
       4. `btnTex`（`'.tex'`）
       5. `btnHtml`（`'.html'`）
       6. `btnZip`（`'.zip (离线含图)'`）

   - **新增键盘快捷键加持**：在 `escHandler` 同一键盘监听中，支持按下 `Ctrl/Cmd + Shift + C` 触发 `btnCopy.click()` 一键复制 Markdown！

---

### Task UI-03：升级多选模式悬浮控制坞（Frosted Command Dock + Esc 退出）

**修改文件**：[bridge.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/bridge.js)（`toggleSelectMode` / `clearSelectMode`）

1. **悬浮控制坞 `.bar` 升级为磨砂暗色胶囊指挥台**：
   - `display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(12px); color: #f8fafc; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 999px; box-shadow: 0 16px 40px rgba(2, 6, 23, 0.42); font-size: 12.5px;`
   - `.cs-count`：胶囊计数徽标（`background: rgba(99, 102, 241, 0.22); color: #c7d2fe; padding: 4px 10px; border-radius: 999px; font-weight: 600; white-space: nowrap;`，保持文案 `'已选中 X / Y 条'`）。
   - 按钮层次区分（严格保持按钮 `textContent`：`'全选'`、`'仅选 AI 回复'`、`'导出选中'`、`'取消'`）：
     - `'全选'`、`'仅选 AI 回复'`：柔和暗灰胶囊按钮（`background: rgba(255,255,255,0.1); border-radius: 999px; padding: 5px 12px;`）；
     - `'导出选中'`：醒目靛蓝主操作按钮（`background: #4f46e5; color: #fff; font-weight: 600; border-radius: 999px; padding: 5px 14px;`；当 `selectedTurns.length === 0` 时视觉半透明提示）；
     - `'取消'`：低调幽灵按钮（悬停浅红文字）。
2. **多选复选框 `.ai-saver-select-mark` 细节打磨（严守 `bugfix02.test.cjs` 断言！）**：
   - 严格保持 `position:absolute;top:8px;right:8px;width:20px;height:20px;border:2px solid #667eea;background:#fff;color:#667eea;border-radius:6px;font-size:13px;font-weight:700;line-height:16px;text-align:center;cursor:pointer;z-index:2147483645;box-sizing:border-box;user-select:none;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(102,126,234,.25);transition:transform .12s ease;`
   - 选中时保持 `mark.style.background = '#667eea'`、`mark.textContent = '✓'`、`aria-checked="true"`！
3. **支持按 `Escape` 键退回普通浏览模式**：在开启多选模式时注册 `keydown` 监听（若未打开预览弹窗且按下 `Escape`，调用 `clearSelectMode()`，并在 `clearSelectMode()` 中安全移除监听）。

---

### Task UI-04：重塑扩展 Popup 弹出面板（状态指示灯卡片 + 2×2 Bento 动作网格 + 设置直达）

**修改文件**：
- [popup.html](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/popup/popup.html)
- [controller.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/popup/controller.js)

#### 现存痛点
当前 Popup 是 `340px` 窄白框 + 紫粉渐变头 + 6 个毫无区分度的长条按钮竖着排成一列，没有深色模式，甚至**连打开“设置与历史记录”页面的入口按钮都没有**！

#### 升级方案
1. **宽度与自适应主题**：`body { width: 360px; }`，内置完整 CSS 变量，通过 `@media (prefers-color-scheme: dark)` 自动跟随系统切换清爽浅色与深邃暗色。
2. **精致顶栏 `.header`**：
   - 左侧：圆角靛蓝品牌图标 SVG + `<h1>ChatSavor <span id="version" class="version-badge"></span></h1>`；
   - 右侧：新增 **`#open-options` 设置与历史图标按钮**（齿轮/时钟组合图标 + `"设置与历史"` 提示，`title="打开设置与本地历史记录"`），在 `controller.js` 中绑定点击事件：优先调用 `chrome.runtime.openOptionsPage()`，若环境未提供则 `chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') })`。
3. **实时页面连接状态卡片 `.status-card`**：
   - 圆角卡片容器（`background: var(--cs-surface); border: 1px solid var(--cs-border); border-radius: 12px; padding: 12px 14px;`）；
   - 顶部状态行：左侧动态呼吸圆点 `<span id="status-dot" class="status-dot"></span>` + `<p id="page-status" role="status">正在检查当前网页…</p>`；
   - 底部详情行：`<p id="page-detail"></p>`；
   - 在 `controller.js` 的 `displayStatus(status)` 与错误捕获分支中同步切换 `statusDot.dataset.state`：
     - `status.responseCount > 0` → `'ready'`（翠绿 `#10b981` + 柔和绿光晕）
     - 已连接但 `responseCount === 0` → `'idle'`（琥珀黄 `#f59e0b`）
     - 错误或非支持页面 → `'error'`（玫瑰红 `#ef4444`）。
   - **严禁更改 `#page-status` 与 `#page-detail` 输出的中文文案内容**（确保 `connection.test.cjs` 全部正则断言 100% 通过！）。
4. **主次分明的 Bento 操作区 `.actions`**：
   - **第一层（Hero 主按钮）**：全宽醒目靛蓝主按钮 `#convert-latest`（内嵌星芒图标 + `转换最新回复`，`padding: 11px 14px; font-weight: 600; border-radius: 10px;`）；
   - **第二层（2×2 网格次级高频操作 `.action-grid`，`display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`）**：
     - `#export-all`（对话气泡图标 + `导出整场对话`）
     - `#multi-select`（多选勾选图标 + `多选回复导出`）
     - `#convert-selection`（选区光标图标 + `转换选中内容`）
     - `#scan-page`（刷新扫描图标 + `重连并显示按钮`）
     - 每个网格卡片按钮采用精致左图标+文字或上下微卡片布局（`background: var(--cs-bg); border: 1px solid var(--cs-border); color: var(--cs-text); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; font-weight: 500;`，悬停微抬升并高亮靛蓝边框）。
5. **低干扰底部工具栏 `.popup-footer`**：
   - 左侧简短提示 `.hint`（`每条 AI 回复末尾会自动出现胶囊按钮`），右侧放置低调幽灵按钮 `#copy-diagnostics`（`复制诊断`），不再占用主操作区黄金面积！

---

### Task UI-05：重塑 Options 设置、本地历史与站点规则管理台（现代分栏卡片工作台）

**修改文件**：
- [options.html](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/options/options.html)
- [options.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/options/options.js)

#### 现存痛点
当前设置页是完全未排版的 90 年代纵向裸 `<label>` 堆叠，历史记录直接把整篇原始 Markdown 塞进 `<pre>`，二次预览打开的是空白页裸 `<pre>`，没有任何布局美感。

#### 升级方案（保留 `options.test.cjs` 全部 10+ 个必测 ID！）
1. **整体布局与自适应深浅色**：
   - 页面背景 `--cs-surface-2`（`#f1f5f9` / 深色 `#020617`），居中主容器 `max-width: 900px; margin: 0 auto; padding: 28px 20px 64px;`。
   - **顶部粘性导航头 `.page-header`**：左侧品牌徽标 + `<h1>ChatSavor 设置与历史中心</h1>` + 副标题说明；右侧显示悬浮胶囊状态提示 `<div id="status" role="status"></div>`（非空时呈现翠绿/靛蓝胶囊 Toast 动画，不再让页面上下跳动）+ 顶部快捷保存按钮触发器。
   - **顶部视图切换分段导航（支持平滑锚点或分区切换，同时确保所有 DOM 元素始终存在于文档中供单测直接访问！）**：提供 `偏好设置` / `导出历史` / `自定义规则` 三个卡片大区（默认全部清晰卡片化展示，顶部可点击快速定位）。
2. **卡片一：全局导出与知识库偏好（`.settings-card`）**：
   - 拆分为两个清晰的内部子分组：
     - **分组 A：Markdown、思维链与本地知识库**
       - 每项采用现代 **左文案（标题 + 灰色小字解释） / 右控件** 的水平对齐设置行（`.setting-row`）：
         1. `#frontmatter`（Toggle 拨杆开关）：默认包含 YAML Frontmatter + 说明文字“为 Obsidian / Logseq 自动生成标题、平台、导出时间属性头”
         2. `#cotMode`（精致下拉框）：默认 CoT 思考过程策略
         3. `#vault` & `#vaultDir`（双列并排输入框）：Obsidian Vault 名称 & 保存目录路径
         4. **本地库静默直写绑定区**：状态胶囊徽章 `#boundFolderStatus`（已绑定时呈现绿色胶囊，未绑定灰色胶囊）+ `#bindFolder` + `#unbindFolder`
     - **分组 B：界面主题与 PDF 默认版式**
       - `#theme`（跟随系统 / 浅色 / 深色）、`#historyEnabled`（Toggle 拨杆开关）
       - PDF 版式双列网格：`#pdfFooterMode`、`#pdfFooterText`、`#pdfWatermarkMode`、`#pdfWatermarkText`
   - 卡片底部右对齐醒目主按钮 `<button id="save">保存偏好设置</button>`。
3. **卡片二：本地导出历史中心（`#historyList` 卡片化升级）**：
   - 顶部工具栏：带放大镜图标的搜索框 `#historySearch` + 历史条数徽标 + 右侧危险次级按钮 `#clearHistory`（`清空全部`）。
   - **空状态设计**：当无历史记录或搜索无匹配时，在 `#historyList` 中渲染优雅的居中空状态提示（图标 + `"暂无导出历史记录，在任意 AI 对话页点击导出后将自动归档于此"`）。
   - **历史条目卡片 `.history-item` 升级**：
     - 顶栏：左侧彩色平台胶囊徽标（如 `ChatGPT` / `DeepSeek` / `Claude`）+ 加粗标题 `item.title` + 右侧导出时间 `item.time` 与字数统计；
     - 摘要预览区 `<pre>`：保留 `<pre>` 元素兼容样式但优化为柔和代码框（最多显示 4～5 行，`max-height: 110px`，字体清晰）；
     - 底部操作栏：
       1. `复制`（点击后写入剪贴板，按钮文字短暂变为 `'✓ 已复制'` 并在 `#status` 提示）；
       2. `下载 .md`（新增实用动作：一键将该条历史重新保存为 `.md` 文件！）；
       3. `二次预览`（优化新窗口样式：写入带干净现代排版 CSS 的阅读页而非裸 `<pre>`）；
       4. `删除`（柔和红字幽灵按钮）。
4. **卡片三：自定义站点 CSS 选择器规则（高级扩展区）**：
   - 说明栏提供清晰的字段说明与一个 **“填入示例规则模板”** 辅助按钮（仅在内容为空数组 `[]` 时填入示例或供用户参考，不破坏初始默认值 `[]`！注意：**初始 HTML 中 `<textarea id="customRules" spellcheck="false">[]</textarea>` 必须保持默认 `[]`**）；
   - `#customRules` 采用深色/高对比等宽代码编辑器风格；底部排列 `#saveRules`、`#exportRules`、`#importRules` 与隐藏 `#importFile`。

---

### Task UI-06：美化 PDF 打印预览工作台与本地库授权页（仅美化屏幕态，零触碰打印排版内核）

**修改文件**：
- [print.html](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/export/print.html)
- [writer.html](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/export/writer.html)

#### 1. `print.html`（严守打印排版红线！）
- **铁律**：`@media print { ... }` 块内的每一行规则、`<table class="print-frame">` 的 HTML 结构、以及 `pdf-watermark.test.cjs` / `pdf-chatgpt-layout.test.cjs` 检查的选择器**原封不动保留**！
- **仅在 `@media screen` 屏幕预览态下升级视觉体验**：
  - 屏幕背景设为柔和工作台灰底 `@media screen { body { background: #f1f5f9; } }`；
  - 屏幕态下的 `#content` 升级为**拟真 A4 纸张投影卡片**（`max-width: 820px; margin: 28px auto 48px; padding: 44px 52px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);`），所见即所得！
  - 顶部 `#toolbar` 升级为**现代毛玻璃悬浮控制栏**：
    - `background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(12px); border-bottom: 1px solid #e2e8f0; padding: 10px 24px; display: flex; align-items: center; gap: 12px; box-shadow: 0 1px 3px rgba(15,23,42,0.04);`
    - 将控件用柔和胶囊分隔符视觉归组：`[品牌标题 ChatSavor PDF 工作台]` | `[页脚选择 #footerMode + #footerText]` | `[水印 #watermarkMode + #watermarkText + 浓度滑块 #watermarkOpacity]` | `[右侧 margin-left:auto：#status 状态胶囊 + #autoPrint 复选框 + 醒目靛蓝主按钮 #print]`！

#### 2. `writer.html`（本地库首次授权确认卡片）
- 将原本简陋的 4 行裸文字升级为**居中精致授权卡片页面**（支持 `@media (prefers-color-scheme: dark)` 自动深浅色）：
  - 页面背景 `#f1f5f9`（深色 `#020617`），垂直水平居中卡片 `.auth-card`（`max-width: 480px; background: var(--cs-bg); border: 1px solid var(--cs-border); border-radius: 16px; padding: 32px; box-shadow: 0 20px 50px rgba(15,23,42,0.10);`）；
  - 顶部 `44×44` 圆角靛蓝浅底文件夹盾牌 SVG 图标 + `<h1>ChatSavor 本地知识库直写</h1>` + 简明隐私说明（“仅写入您指定的笔记文件夹，授权一次后同浏览器会话内可一键静默保存”）；
  - 待保存目标信息框 `<p id="hint" class="target-box">...</p>`（等宽路径卡片样式）；
  - 全宽醒目主按钮 `<button id="primary">...</button>` + 次级按钮 `<button id="replace" class="secondary">...</button>`；
  - 底部状态横幅 `<p id="status"></p>`。

---

## 三、 自动化单元测试新增要求（Task UI-07）

**新增测试文件**：`chrome-extension/tests/ui-redesign.test.cjs`

必须在 JSDOM 真实脚本运行环境下编写并通过以下 **6 项 UI 与交互契约测试**（禁止用源码正则充当测试）：

1. **`UI-01 reply action pill renders both preview button and 1-click quick copy MD button`**：
   - 在模拟对话容器中调用 `ChatSavorCore.injectButtonAfter(replyEl, onClick)`；
   - 断言 `.ai-saver-host` 的 `shadowRoot` 中同时存在 `.save-btn` 与 `.quick-copy-btn`；
   - 点击 `.save-btn` 触发 `onClick`；点击 `.quick-copy-btn` 自动提取 `replyEl` 的 Markdown 写入剪贴板，且按钮反馈文案更新为含 `'已复制'`。
2. **`UI-02 preview modal preserves exact button textContent contracts while organizing two-row footer dock and wide toggle`**：
   - 打开 `ChatSavorCore.showPreviewModal('# 标题\n\n正文 $E=mc^2$', { thinking: '思考内容' })`；
   - 校验 `.footer-row-top`、`.card-capsule`（内含 `select.card-theme-select`、`复制长图`、`下载长图`）、`.footer-row-bottom` 均已渲染；
   - 遍历以下全部 12 个按钮文案断言 `[...shadow.querySelectorAll('button')].find(b => b.textContent === label)` **每一个都能精确命中**（证明 SVG 图标零文本污染）：
     `['复制 Markdown', '复制富文本', '发送到 Obsidian', '保存到本地库', '复制长图', '下载长图', '.md', '.pdf', '.docx', '.tex', '.html', '.zip (离线含图)']`；
   - 点击 `.expand-btn` 断言 `.modal.classList.contains('expanded') === true`，再次点击恢复 `false`。
3. **`UI-02 keyboard shortcut Ctrl+Shift+C inside preview modal copies markdown`**；
4. **`UI-03 multi-select mode Escape key exits cleanly and restores host positions`**；
5. **`UI-04 popup exposes open-options button and updates status-dot data-state for ready/idle/error`**：
   - 加载 `popup.html` + `connection.js` + `controller.js`，验证 `#open-options` 点击调用 `chrome.runtime.openOptionsPage`，且 `#status-dot` 的 `dataset.state` 随识别回复数正确切换为 `'ready'` / `'idle'` / `'error'`；
6. **`UI-05 options history empty state and per-item md download & copy feedback work cleanly`**。

---

## 四、 交付前全量验收命令清单

DeepSeek Harness 执行完毕后，必须依次运行以下检查并确认 **0 失败**：

```bash
npm --prefix chrome-extension test
npm --prefix chrome-extension run check:version
```

自检核对项：
- [x] 全量测试（原有 195 项 + 新增 6 项 = **201+ 项单测**）100% PASS；
- [x] `git diff chrome-extension/src/lib/katex.js` 为空；
- [x] `print.html` 的 `@media print` 分页与无 URL 页眉页脚测试（`pdf-watermark.test.cjs`、`pdf-chatgpt-layout.test.cjs`）100% PASS；
- [x] 所有新增矢量图标均为内联纯净 `<svg>`，零外部网络请求、零构建工具依赖。
