# ChatSavor BUG 修复详细清单（Execution Spec）

> **文档说明**：本清单汇总了对上一轮改造（134 个测试）进行深度代码审查后发现的 **12 项真实 Bug（4 项 P0、6 项 P1、2 项 P2）**。  
> **核心要求**：每个 Bug 必须按“精确修复代码 → 编写**真实运行时行为测试**（严禁仅用正则检查源码字符串来假通过！）→ 运行 `npm --prefix chrome-extension test` 0 fail”的闭环逐项清零。

---

## 一、P0 级严重 Bug（真机环境下核心功能直接失效）

### BUG-01：Options 全局偏好在所有 AI 网页中 100% 不生效（跨源 `localStorage` 隔离）
- **涉及文件与行号**：
  - `chrome-extension/src/options/options.js`（第 39-56 行）
  - `chrome-extension/src/content/core.js`（第 14-19、36-46、101-104、177-181、397-408 行）
- **缺陷根因**：
  1. `options.html` 运行在 `chrome-extension://<ext-id>` 源下，`options.js` 把配置写入了扩展域的 `localStorage`；而 `core.js` 运行在 `chatgpt.com`、`deepseek.com` 等第三方网站源下，**跨源 `localStorage` 完全隔离**，导致用户在设置页保存的 `frontmatter`、`cotMode`、`theme`、`vault` 在所有聊天页面完全读不到。
  2. 设置页中的 `vaultDir`（Obsidian 保存目录）和 `historyEnabled`（是否启用本地历史记录）在 `core.js` 中完全未被读取：关闭“启用本地历史记录”后 `saveHistory()` 依然强行保存。
- **精确修复方案**：
  1. 在 `core.js` 闭包顶层维护一个内存偏好缓存对象 `var cachedPrefs = { frontmatter: false, cotMode: 'omit', vault: '', vaultDir: '', theme: 'auto', historyEnabled: true };`。
  2. 新增 `syncPrefsFromStorage()`：
     - 启动时（以及每次 `showPreviewModal` 打开前）从 `chrome.storage.local.get('prefs', ...)` 异步读取 JSON 并合并到 `cachedPrefs`；如果 `chrome.storage.onChanged` 可用，监听 `'prefs'` 变更并实时更新 `cachedPrefs`（让用户在 Options 页改完设置后，已打开的聊天标签页**无需刷新即可生效**）。
     - 若 `chrome.storage.local` 不可用（例如纯 JSDOM 单元测试环境未注入 `chrome.storage`），回退读取 `localStorage` 兼容既有单测。
  3. 同步改造 `core.js` 中的读写辅助函数：
     - `frontmatterEnabled()`：优先读取 `cachedPrefs.frontmatter`（若页面内勾选框本次手动切换过，同时更新 `cachedPrefs.frontmatter` 与 `chrome.storage.local` 里的 `prefs` 以及 `localStorage`）。
     - `savedCotMode()`、`savedTheme()`、Obsidian `vault` 与 `vaultDir`：统一从 `cachedPrefs` 读取（未设置时回退 `localStorage`）。
     - `saveHistory(markdown, pageMeta)`：开头检查 `if (cachedPrefs.historyEnabled === false) return;`，真正尊重用户关闭历史记录的隐私开关。
     - Obsidian URI 拼接：若 `cachedPrefs.vaultDir` 非空（去除首尾 `/`），则 `name` 参数拼为 `vaultDir + '/' + pageMeta.title`。
  4. `options.js` 中保留 `chrome.storage.local` 作为唯一跨上下文数据源（可移除误导性的跨源 `localStorage` 注释，保留写 `localStorage` 仅用于向后兼容既有测试或同步更新 `tests/options.test.cjs`）。
- **真行为回归测试要求**：
  - 在 `jsdom` 中为 `core.js` 注入一个模拟的 `chrome.storage.local`（包含 `prefs: JSON.stringify({ frontmatter: true, cotMode: 'callout', vault: 'MyVault', vaultDir: 'AI/Notes', theme: 'dark', historyEnabled: false })`），**清空 `localStorage`**；
  - 断言：`showPreviewModal` 打开后自动启用 `.dark` 主题、Frontmatter 复选框默认勾选、CoT 默认选中 `'callout'`、点击“发送到 Obsidian”生成的 URI 包含 `vault=MyVault` 与 `name=AI%2FNotes%2F...`、且 `historyEnabled: false` 时导出不会向 `chrome.storage.local` 写入 `history`。

---

### BUG-02：多选导出模式的复选框在真实浏览器中 0×0 隐形不可见
- **涉及文件与行号**：
  - `chrome-extension/src/content/bridge.js`（第 73-167 行）
  - `chrome-extension/src/content/dom.js`（第 4 行 `OWN_UI`）
- **缺陷根因**：
  1. `bridge.js` 第 120 行把 `.mark { position:absolute; top:2px; right:2px; width:18px; height:18px; ... }` 写在了底部工具条的 **Shadow DOM**（`selectShadow`）样式表里。
  2. 但第 139-151 行创建的勾选框元素 `mark` 类名是 `.ai-saver-select-mark` 且直接 `turn.element.appendChild(mark)` 挂载在**宿主页面主文档**中，既吃不到 Shadow DOM 样式，类名也完全不匹配，导致页面上是一个 0×0 无边框无文字的隐形空 `div`。
  3. 退出多选模式时未还原第 142 行修改过的 `turn.element.style.position = 'relative'`。
  4. `.ai-saver-select-host` 和 `.ai-saver-select-mark` 未加入 `dom.js` 的 `OWN_UI`，导致多选模式下提取正文可能把勾选标记混入克隆 DOM。
- **精确修复方案**：
  1. 为每个 `mark` 直接设置完整的内联样式 `mark.style.cssText = 'position:absolute;top:6px;right:6px;width:20px;height:20px;border:2px solid #667eea;background:#fff;color:#667eea;border-radius:4px;font-size:13px;font-weight:700;line-height:16px;text-align:center;cursor:pointer;z-index:2147483645;box-sizing:border-box;user-select:none;display:flex;align-items:center;justify-content:center;';`，选中时设置 `mark.textContent = '✓'`、背景 `#667eea`、文字 `#fff`；未选中时清空 `mark.textContent = ''`、背景 `#fff`、文字 `#667eea`；同时设置 `mark.setAttribute('role', 'checkbox')` 与 `aria-checked`。
  2. 删除 `selectShadow` 样式表中无用的 `.mark{...}` 规则。
  3. 记录修改过 `position` 的元素列表 `var modifiedPositions = [];`（存 `{ el, prevInlinePosition }`），在 `clearSelectMode()` 中逐个还原 `el.style.position = prevInlinePosition`。
  4. 将 `dom.js` 第 4 行的 `OWN_UI` 扩展为：`'.ai-saver-host, .ai-saver-modal-host, .ai-saver-launcher-host, .ai-saver-select-host, .ai-saver-select-mark'`，并在 `markdown.js` 第 206 行的清理选择器中也补上 `.ai-saver-select-host, .ai-saver-select-mark`。
- **真行为回归测试要求**：
  - 触发 `TOGGLE_SELECT_MODE` 后，断言 `.ai-saver-select-mark` 具有非空可见尺寸内联样式（`width: 20px`、`height: 20px`、`position: absolute`）、点击后 `textContent === '✓'` 且 `aria-checked === 'true'`；
  - 取消多选模式后，断言 `turn.element.style.position` 恢复原值且所有 `.ai-saver-select-mark` 已移除。

---

### BUG-03：自定义站点规则（`customRules`）在 `content.js` 中被 `platform-base.js` 吞掉，100% 不生效
- **涉及文件与行号**：
  - `chrome-extension/src/content/content.js`（第 51-81 行）
  - `chrome-extension/src/content/platform-base.js`（第 42-47 行）
- **缺陷根因**：
  - `content.js` 第 66 行先同步调用 `start()`，在 `window.ChatSavorAdapters['generic']` 缓存了默认适配器。
  - 第 77 行异步从 `chrome.storage.local` 读到 `customRules` 后再次调用 `start(rule)`，进入 `platform-base.js` 第 43 行时命中 `if (prev && prev.version === version && prev.core === core) return prev;`，直接返回了旧适配器，**自定义 `responseSelector` / `userSelector` / `excludedSelector` 彻底被忽略**！
- **精确修复方案**：
  1. 在 `platform-base.js` 的 `create(config)` 中支持显式强制重建标志 `config.forceReplace === true`：当 `config.forceReplace === true` 时，跳过第 43 行的复用短路，直接执行 `if (prev && typeof prev.dispose === 'function') prev.dispose();` 并用新配置创建并注册新适配器。
  2. 在 `content.js` 的 `start(overrides)` 中，当传入有效 `overrides`（如 `overrides.responseSelector || overrides.userSelector || overrides.excludedSelector`）时，传入 `forceReplace: true`。
  3. 同步改进 `content.js` 第 75 行的 `hostPattern` 匹配：禁止把空字符串或裸 `host.indexOf(pattern)` 误匹配无关域名（仅支持精确域名匹配 `host === p`、子域后缀 `*.example.com` 或 `.example.com`）。
- **真行为回归测试要求**（替换原来只测源码字符串的假测试）：
  - 在 `jsdom` 中加载 `dom.js` + `bridge.js` + `markdown.js` + `core.js` + `platform-base.js` + `content.js`，页面 DOM 只有自定义类 `<div class="my-custom-ai-answer">Custom Reply</div>`（无法被默认 `GENERIC_SELECTORS` 命中），并在模拟 `chrome.storage.local` 中写入 `customRules: JSON.stringify([{ hostPattern: 'chat.example.com', responseSelector: '.my-custom-ai-answer' }])`；
  - 等待异步回调并执行 `window.ChatSavorBridge.handle('SCAN')`，断言 `status().responseCount === 1` 且按钮成功挂载在 `.my-custom-ai-answer` 后！

---

### BUG-04：Grok 在 `x.com` 上的 SPA 路由切换依然完全失效
- **涉及文件与行号**：
  - `chrome-extension/src/content/platforms/grok.js`（第 7-20 行）
  - `chrome-extension/src/content/platform-base.js`（第 224-262、295-306 行）
- **缺陷根因（双 Bug 叠加）**：
  1. `grok.js` 第 7-13 行在 `matchHost` 里校验了 `loc.pathname` 必须含 `/grok`，导致用户从 `https://x.com/home` 打开 X 时 `create()` 第 39 行直接 `return null`，**适配器根本没有挂载，也未注册任何路由监听**。
  2. `platform-base.js` 第 259 行 `safeScan()` 从未调用 `onRouteChange()`，且 `scan()` 第 225 行写着 `if (disposed || !activeRoute || !route()) return;`。由于 X 使用 `history.pushState('/i/grok')` 切换路由**不会触发 `popstate` / `hashchange`**，即使挂载了监听器，`activeRoute` 也永远停留在初始的 `false`，永远不会触发扫描。
- **精确修复方案**：
  1. **`grok.js`**：
     - `matchHost(host)` **只判断域名**（`grok.com`、`*.grok.com`、`x.com`、`*.x.com`），不再在 `matchHost` 里检查路径。
     - `isActiveRoute(loc)` 负责路径判断：`grok.com` / `*.grok.com` 恒为 `true`；`x.com` / `*.x.com` 仅当 `loc.pathname.indexOf('/i/grok') === 0 || loc.pathname.indexOf('/grok') !== -1` 时返回 `true`。
  2. **`platform-base.js`**：
     - 在 `safeScan()` 开头：若 `config.watchRoute` 为 `true`，先调用 `onRouteChange()`（检测 `location.href !== lastHref` 或 `route() !== activeRoute`，完美兼容 `history.pushState` SPA 跳转）。
     - 在 `scan(force)` 开头：同步刷新 `if (config.watchRoute) onRouteChange();`，去掉冗余的旧 `activeRoute` 阻断，直接以最新 `route()` 为准。
     - **保护 `x.com/home` 不被劫持**：当 `config.isActiveRoute && !route()` 时，`getResponses()` 返回 `[]`，`getTurns()` 返回 `[]`，`scan()` 直接跳过不向非 Grok 路由注入任何按钮（同时更新 `tests/regressions.test.cjs` 中 `REG grok does not hijack x.com non-grok routes` 的断言，验证：在 `x.com/home` 上 `getResponses()` 为 `[]` 且 0 按钮注入；当通过 `history.pushState({}, '', '/i/grok')` 跳转后，下一周期自动识别回复并注入按钮！）。

---

## 二、P1 级逻辑错误与功能缺陷

### BUG-05：`platform-base.js` 变量遮蔽导致 `ctx.host` 是字符串而非函数
- **涉及文件与行号**：`chrome-extension/src/content/platform-base.js`（第 37、69-71、135 行）
- **缺陷根因**：第 37 行 `var host = ...` 覆盖了第 69 行提升的 `function host()`，导致第 135 行暴露在 `ctx.host` 上的是字符串而非函数。
- **精确修复方案**：将第 37 行的局部变量重命名为 `var initialHost = ...`，保留第 69 行的 `function host()`，确保 `typeof ctx.host === 'function'` 且 `ctx.host()` 返回当前域名字符串。

---

### BUG-06：`claude.js` 含 Artifact 时反向丢弃了 Claude 的正文回答
- **涉及文件与行号**：`chrome-extension/src/content/platforms/claude.js`（第 20-24 行）
- **缺陷根因**：`extractReply` 检测到 `[class*="artifact"] [class*="content"]` 后仅返回 artifact 内容，把回复中的主要文字回答全部丢弃。
- **精确修复方案**：直接提取完整回复 `el`（`ctx.core.extractMarkdown(el)`）；仅当 `el` 自身不含正文且外层存在独立 artifact 面板时才补充提取，绝不丢弃主回答文本。补充单测验证“包含正文 + Artifact 卡片的回复”两者内容都被保留。

---

### BUG-07：`deepseek.js` 的 `stopSelectors` 包含 `[class*="stop"]` 存在误杀风险
- **涉及文件与行号**：`chrome-extension/src/content/platforms/deepseek.js`（第 18 行）
- **缺陷根因**：`[class*="stop"]` 会匹配任何类名包含 `stop` 子串的可见按钮（如 `desktop-menu`），导致 `hasVisibleStopButton()` 误判为正在生成，永远不注入按钮。
- **精确修复方案**：将 `[class*="stop"]` 移除，改为精确选择器 `['[data-testid="stop-button"]', '[aria-label*="停止生成"]', '[aria-label*="Stop generating"]', '[title*="停止生成"]']`（配合 `stopTokens` 匹配）。补充单测验证页面含 `<button class="desktop-switch">切换</button>` 时不影响 DeepSeek 按钮注入。

---

### BUG-08：`bridge.js` 多处导出逻辑缺陷（空消息输出域名、`LATEST` 丢失 `thinking`、多选顺序错乱）
- **涉及文件与行号**：`chrome-extension/src/content/bridge.js`（第 93-103、189-197、222-225 行）
- **缺陷根因**：
  1. 第 191 行 `EXPORT_ALL` 中 `var text = result && result.markdown || status().host;` —— 提取为空的消息竟然把域名（如 `chatgpt.com`）写进导出正文！
  2. 第 224 行 `LATEST` / `SELECTION` 调用 `window.ChatSavorCore.showPreviewModal(result.markdown);` 时未传递 `result.thinking ? { thinking: result.thinking } : undefined`，导致 Popup“转换最新回复”无法显示 CoT 思考切换器。
  3. 第 95 行 `exportSelected()` 直接按用户点击顺序遍历 `selectedTurns`，若用户倒序勾选，导出对话顺序会颠倒。
- **精确修复方案**：
  1. `EXPORT_ALL` 第 191 行改为 `var text = result && result.markdown ? result.markdown.trim() : '';`，过滤掉 `text` 为空的轮次，绝不回退为 `status().host`。
  2. 第 224 行改为 `window.ChatSavorCore.showPreviewModal(result.markdown, result.thinking ? { thinking: result.thinking } : undefined);`。
  3. `exportSelected()` 导出前先按文档顺序排序：`var ordered = selectedTurns.slice().sort(function(a, b) { return window.ChatSavorDOM ? window.ChatSavorDOM.compare(a.element, b.element) : 0; });`。
- **真行为回归测试要求**：
  - `EXPORT_ALL` 含一条空 DOM turn 时，导出结果中不得出现 `chatgpt.com` 或域名字符串；
  - `LATEST` 针对带 `thinking` 的回复时，预览弹窗中必须出现 `.cot-mode` 选择器；
  - 多选模式先点第 2 条再点第 1 条，导出结果必须仍按“第 1 条在前、第 2 条在后”的文档顺序输出。

---

### BUG-09：`core.js` Obsidian 未带 Frontmatter、Word/HTML/PDF 误渲染 YAML、CoT 切换与历史记录不完整
- **涉及文件与行号**：`chrome-extension/src/content/core.js`（第 230-241、257-284、345-410 行）
- **缺陷根因**：
  1. 第 402 行“发送到 Obsidian”直接编码 `markdown`，忽略了用户勾选的 `包含 Frontmatter（Obsidian）`。
  2. 第 350、363、377 行 `.pdf`、`.docx`、`.html` 却把 `withFrontmatter(...)` 拼进正文交给 Markdown 渲染器，导致导出的 Word/HTML/PDF 顶部出现 `<hr>` 和原始 YAML 键值纯文本。
  3. 第 230-240 行切换 CoT 模式时未重建 `formulaDiv`，且用户编辑过 Markdown（`userEdited = true`）后切换 CoT 下拉框毫无反应（应把 `userEdited` 与 `cotSelect` 行为理顺：若用户切换 `cotSelect`，先剥离已有思考块或基于最新 `baseMarkdown` 重新应用思考模式，并同步重建 `formulaDiv` 且动态显隐 `tabFormulas`）。
  4. `saveHistory` 只在下载 `.md` 时调用，导出 `.docx` / `.html` / `.pdf` / 发送 Obsidian 均未记录历史。
- **精确修复方案**：
  1. **Frontmatter 作用范围规范化**：
     - 勾选 Frontmatter 时：**`.md` 下载、复制 Markdown（可选/保持原样或仅导出）、发送到 Obsidian** 携带 YAML Frontmatter。
     - **`.pdf`、`.docx`、`.html`**：绝不把原始 YAML Frontmatter 拼进 Markdown 正文渲染，而是用纯 `markdown` 正文渲染（标题与元信息写入文档 `<title>` / Word 标题，不输出丑陋的 `---` YAML 块）。
  2. **封装统一的 `rebuildFormulas(md)` 函数**：初始化、`cotSelect` 切换、`mdDiv` 编辑防抖回调三处共同调用，确保公式计数、`tabFormulas` 显隐与 `formulaDiv` 列表始终一致。
  3. **在 `.md` / `.html` / `.docx` / `.pdf` / Obsidian 导出时统一调用 `saveHistory(markdown, pageMeta)`**（受 BUG-01 中的 `historyEnabled` 控制）。
- **真行为回归测试要求**：
  - 勾选 Frontmatter 后：点击“发送到 Obsidian”生成的 URI 解码后以 `---\ntitle:` 开头；点击 `.html` / `.docx` 导出结果中不包含 `exported_at:` 原始 YAML 文本；
  - 切换 CoT 下拉框（且思考块内含公式 `$x^2$`）时，`formulaDiv` 实时出现该公式项。

---

### BUG-10：`docx-builder.js` 表头误用 `Heading2`、转义竖线 `\|` 劈列、不支持 4+ 反引号和有序列表
- **涉及文件与行号**：`chrome-extension/src/lib/docx-builder.js`（第 124-172 行）
- **缺陷根因**：
  1. 第 155 行表格表头单元格使用了 `Heading2` 段落样式，会导致 Word 左侧导航大纲视图里出现大量杂乱的二级标题。
  2. 第 150 行直接 `split('|')` 会把表格内数学公式转义的 `\|`（如 `\|x\|`）错误劈分成多列。
  3. 第 132 行只识别 3 个反引号 `/^```/`，不兼容 `markdown.js` 为嵌套代码块生成的 4+ 反引号围栏（如 ```` ````markdown ````）。
  4. 未处理有序列表（如 `1. 第一项`）。
- **精确修复方案**：
  1. 在 `word/styles.xml` 中新增专用表格表头样式 `TableHeader`（加粗、11pt，**不带 `outlineLvl`**），表格首行改用 `TableHeader`（或直接给表头 cell 加 `<w:shd w:val="clear" w:fill="F0F0F0"/>` + 加粗 `**cell**`），绝不用 `Heading2`。
  2. 表格拆列改为按**非转义竖线**拆分（先将 `\\|` 替换为临时占位符，再 `split('|')`，最后还原为 `|`）。
  3. 代码围栏解析记录开围栏长度 `var fenceMatch = /^(`{3,})/.exec(line.trim());`，只有遇到**长度 `>= openFenceLen` 的纯反引号行**才闭合代码块。
  4. 新增有序列表匹配 `/^\s*(\d+\.)\s+(.*)$/`，渲染为 `ListParagraph` 并保留序号。
- **真行为回归测试要求**：
  - 表格含 `| 范数 | $\|x\|_2$ |` 时，生成的 `<w:tr>` 只有 2 个 `<w:tc>` 而不是 4 个，且首行不使用 `Heading2`；
  - 4 反引号包裹内含 3 反引号的代码块完整保留为代码段落；
  - 有序列表 `1. First` 渲染为 `ListParagraph`。

---

## 三、P2 级清理与运维瑕疵

### BUG-11：删除仓库根目录残留的临时调试脚本 `_docx_harness.cjs`
- **涉及文件**：`_docx_harness.cjs`（仓库根目录）
- **修复方案**：直接删除该文件，确认 `git status` 中不再出现临时测试脚本。

---

### BUG-12：`print.js` 读取 `chrome.storage.session` 后未清理临时打印缓存
- **涉及文件与行号**：`chrome-extension/src/export/print.js`（第 33-36 行）
- **缺陷根因**：每次点击 PDF 导出都会往 `chrome.storage.session` 写入一份完整的 HTML，但 `print.js` 读完渲染后从未清理，长期使用会撞到 Chrome `storage.session` 10MB 配额限制。
- **精确修复方案**：在 `print.js` 读取 `result[id]` 并完成 `show(...)` 渲染后，调用 `if (chrome.storage.session.remove) chrome.storage.session.remove(id);` 清理一次性打印缓存（保留页面内已渲染的 DOM，用户仍可反复点击“打印 / 保存为 PDF”按钮）。

---

## 四、验收 Checklist（全部打勾且 0 fail 方可交付）

- [x] **BUG-01** `core.js` / `options.js` 跨源偏好同步（`chrome.storage.local` + `onChanged`）+ `vaultDir` + `historyEnabled` 开关生效 + 真行为测试
- [x] **BUG-02** `bridge.js` 多选复选框主文档内联可见样式 + `position` 还原 + `OWN_UI` 隔离 + 真行为测试
- [x] **BUG-03** `platform-base.js` 支持 `forceReplace` + `content.js` 自定义规则真实生效 + 真行为测试
- [x] **BUG-04** `grok.js` + `platform-base.js` 修复 `x.com` `history.pushState` SPA 路由激活 + 真行为测试
- [x] **BUG-05** `platform-base.js` 修复 `ctx.host` 变量遮蔽
- [x] **BUG-06** `claude.js` 修复含 Artifact 时保留正文回答 + 测试
- [x] **BUG-07** `deepseek.js` 移除过宽 `[class*="stop"]` + 测试
- [x] **BUG-08** `bridge.js` 修复 `EXPORT_ALL` 空消息回退域名、`LATEST` 透传 `thinking`、多选文档排序 + 测试
- [x] **BUG-09** `core.js` 修复 Obsidian 带 Frontmatter、Word/HTML/PDF 不渲染原始 YAML、CoT 同步重建公式、全导出记录历史 + 测试
- [x] **BUG-10** `docx-builder.js` 修复表头 `Heading2`、表格 `\|` 劈列、4+ 反引号、有序列表 + 测试
- [x] **BUG-11** 删除根目录残留文件 `_docx_harness.cjs`
- [x] **BUG-12** `print.js` 读完即清理 `chrome.storage.session` 临时 key
- [x] 运行 `npm --prefix chrome-extension test` 全部通过（0 fail, 0 skipped）且 `npm --prefix chrome-extension run check:version` 通过
