# ChatSavor PDF 排版截断、页边距失效、波浪号误加删除线、矢量图丢失与平台装饰头修复规范（Execution Spec）

> **用途说明**：本文档面向自动化编程代理（DeepSeek Harness）及开发者，合并了在 **ChatGPT 23 页科研长文 PDF** 与 **豆包对话导出 PDF** 实机测试中暴露的全部 **8 大排版与文字损坏问题**，提供精确到文件、CSS 选择器权重、Marked Tokenizer 返回值语义与运行时测试断言的**可执行级实现规范**。  
> **基线状态**：`npm --prefix chrome-extension test` 当前 **171/171 全部通过**。本次修改不得破坏任何既有测试，并须为全部修复点补齐真实的 JSDOM 运行时行为测试。

---

## 0. 问题现象与根因总表（供实现逐项核对）

| 序号 | 实测 PDF / 预览现象 | 代码级精确根因 | 涉及文件 |
| :--- | :--- | :--- | :--- |
| **1** | **【文字损坏】** `1~2 GB ... 1T~10T` 中间几十个字被莫名画上 `<del>` 删除线，且波浪号被吞掉导致 **`1~2 GB` 变成 `12 GB`** | `markdown.js` 启用 `Marked({ gfm: true })` 后，内置 GFM `del` 规则把成对的**单个半角波浪号 `~...~`** 也解析成了 `<del>` 删除线 | `src/content/markdown.js` |
| **2** | **【页边距归零】** 打印出的 PDF 左右页边距为 `0mm`，所有文字首尾和表格边框死死贴住纸张左右物理边缘 | **CSS 选择器权重覆盖 Bug**：`print.html` 第 20 行 `.print-frame > tbody > tr > td { padding: 0 }` 权重为 `(0,1,3)`，覆盖了第 38 行 `@media print` 内权重仅 `(0,1,0)` 的 `.page-body-cell { padding: 0 18mm }` | `src/export/print.html` |
| **3** | **【右侧裁切与丢列】** 含大图的长文 PDF 整篇右侧文字被切、表格最后一列/表头飞出纸外、居中公式偏右 | `.print-frame` 表格未设 `table-layout: fixed`，且漏写 `#content img { max-width: 100% }`；2000px 宽原图把外层 `.print-frame` 全文撑宽至 2000px，超出 A4 纸右边界全部被裁切 | `src/export/print.html` |
| **4** | **【印刷排版粗糙】** 表头 `<th>` 居中无底色而数据列左对齐，标题/段落/列表缺乏印刷级字号、行距与呼吸间距 | `print.html` 缺失完整的印刷排版 CSS（未设 `#content th { text-align: left; background: #f8fafc }` 及 `h1-h4`、`p`、`ul/ol/li` 间距规范），长表格整表 `break-inside: avoid` 导致跨页大白板 | `src/export/print.html` |
| **5** | **【豆包残留“表格”二字】** 豆包导出的表格上方多出一行孤零零的 `表格` 文本 | `doubao.js` 仅向上查找了 1 层父节点的 `previousElementSibling`，而真实豆包表格外包裹了 2～4 层滚动 `div`（`mdbox-table-container > mdbox-table-body > scroll > table`） | `src/content/platforms/doubao.js` |
| **6** | **【矢量图表全丢】** ChatGPT 2026 `DilRenderer` 的 12+ 张流程图、3×3 实验热力图（含实验数值）、光谱曲线全部消失 | 图表为 `<img data-d-component="svg" src="data:image/svg+xml;charset=utf-8,...">`；Turndown 转义括号破坏了 URI，`sanitizeHtml` 又剥离了所有 `data:image/svg+xml` 的 `src`，且 SVG 内 `var(--color-*)` 脱离原站后失效 | `src/content/markdown.js` |
| **7** | **【交互卡片碎裂】** ChatGPT `data-d-component` 卡片内的分段按钮（如 `8×8 / 16×16 / 32×32`）被删空，横向网格/对比行碎成几十行竖排 | `markdown.js` 无差别删掉了 `<button role="radio">`；`[data-d-component="grid"]` 和 `[data-d-component="row"]` 全是 `<div>`，被 Turndown 拆成独立换行段落 | `src/content/platforms/chatgpt.js` |
| **8** | **【外链图半截灰块】** 外部大图出现 85% 灰色未加载色块及缺图 | `print.js` 固定 `600ms` 即触发 `window.print()`，此时外链大图尚未下载解码完；且 `sanitizeHtml` 剥离了 `img` 的 `referrerpolicy="no-referrer"` | `src/export/print.js`、`src/content/markdown.js` |

---

## 1. 既有测试契约与致命防坑提醒（执行前必读！）

1. **【极易踩坑】Marked 自定义 `tokenizer.del` 返回值陷阱**：
   - 在项目内置的 `src/lib/marked.js` 中，自定义 `tokenizer: { del(src) { ... } }` **未匹配双波浪号时必须返回 `undefined`（直接 `return;`），绝对禁止写 `return false;`！**
   - **原因**：在 Marked 扩展机制中，`return false` 表示“交回给 Marked 内置默认 `del` 分词器处理”，会再次触发单波浪号 `~...~` 删除线 Bug；只有返回 `undefined` 才会彻底阻止单波浪号被误判为 `<del>`！
2. **`tests/pdf-watermark.test.cjs` 契约**：
   - 第 63 行断言 `/#content table\s*\{[^}]*border-collapse/`：`#content table { ... }` 规则块内**必须保留 `border-collapse: collapse;`**。
   - 第 54 行（及 `tests/export-engine.test.cjs` 第 77 行）断言包含 `break-inside: avoid`：必须保留（用于 `#content pre, #content tr, #content blockquote, #content img`）。
   - 第 119–123 行断言：无未完成图片时，打开页面 `700ms` 内自动触发 1 次 `window.print()`；因此当 `#content` 内 `!img.complete` 的图片数量为 `0` 时，`waitForImagesReady` **必须立即同步执行回调**，保持原有的 `600ms` 定时器行为不变！
3. **`tests/export-fixes.test.cjs` 第 58–64 行契约**：
   - 原测试传入残缺未闭合的 `![bad](data:image/svg+xml;base64,PHN2Zz4=)`（解码仅为 `<svg>`）并断言被剥离（`doesNotMatch(html, /data:image\/svg\+xml/)`）。
   - 因此 `normalizeSafeSvgDataUrl(url)` **必须要求解码后的 XML 是完整闭合的合法 `<svg ...>...</svg>` 且零 `parsererror`、零可执行脚本/事件**——残缺的 `PHN2Zz4=` 和恶意 `<svg onload=...>` 继续返回 `null` 被剥离，合法的纯净矢量图则 100% 保留！

---

## 2. 分任务详细实现规格（按顺序执行 `Task L-01 → L-06`）

---

### Task L-01：重构 `print.html` 页边距权重、防撑爆骨架与印刷级排版样式表

- **目标文件**：`chrome-extension/src/export/print.html`

#### 详细修改要求

1. **修复 CSS 选择器权重覆盖 Bug + 锁死外层 `.print-frame` 宽度**：
   - 屏幕与通用基础样式：
     ```css
     .print-frame { width: 100%; max-width: 100%; table-layout: fixed; border-collapse: collapse; border: 0; }
     .print-frame > thead > tr > td,
     .print-frame > tbody > tr > td,
     .print-frame > tfoot > tr > td { border: 0; padding: 0; width: 100%; max-width: 100%; box-sizing: border-box; overflow-wrap: break-word; }
     ```
   - 在 `@media print` 中，**必须使用高权重选择器 + `!important`** 确保左右 `18mm` 页边距绝不被上面的 `(0,1,3)` 选择器覆盖：
     ```css
     @media print {
       @page { size: A4; margin: 0; }
       #toolbar { display: none !important; }
       body { color: #111827; background: #fff; }
       .print-frame > thead > tr > td > .page-margin-top,
       .page-margin-top {
         height: 18mm;
         padding: 0 18mm 3mm !important;
         display: flex !important;
         align-items: flex-end;
         justify-content: space-between;
         font-size: 9pt;
         color: #9ca3af;
         box-sizing: border-box;
       }
       .print-frame > tfoot > tr > td > .page-margin-bottom,
       .page-margin-bottom {
         height: 18mm;
         padding: 3mm 18mm 0 !important;
         display: flex !important;
         align-items: flex-start;
         justify-content: space-between;
         font-size: 9pt;
         color: #9ca3af;
         box-sizing: border-box;
       }
       .print-frame > tbody > tr > td.page-body-cell {
         padding: 0 18mm !important;
         width: 100%;
         max-width: 100%;
         box-sizing: border-box;
       }
       #content {
         max-width: 100% !important;
         width: 100% !important;
         margin: 0 !important;
         padding: 0 !important;
         font-size: 10.5pt;
         line-height: 1.72;
       }
       #content table { font-size: 9.5pt; }
       #content thead { display: table-header-group; }
       h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
       #content pre, #content tr, #content blockquote, #content img { break-inside: avoid; page-break-inside: avoid; }
       pre { white-space: pre-wrap; }
     }
     ```
2. **补齐完整的屏幕预览 + PDF 印刷级排版样式（放在 `@media print` 之前通用生效）**：
   ```css
   #content {
     max-width: 820px;
     width: 100%;
     box-sizing: border-box;
     margin: 24px auto;
     padding: 28px 36px;
     line-height: 1.75;
     font-size: 14.5px;
     color: #1f2937;
     background: #fff;
     overflow-wrap: break-word;
     word-break: break-word;
   }
   #content > *:first-child { margin-top: 0; }
   #content h1 { font-size: 1.55em; font-weight: 700; color: #111827; margin: 1.2em 0 0.55em; padding-bottom: 0.3em; border-bottom: 1px solid #e5e7eb; line-height: 1.35; }
   #content h2 { font-size: 1.3em; font-weight: 700; color: #111827; margin: 1.15em 0 0.5em; line-height: 1.4; }
   #content h3 { font-size: 1.12em; font-weight: 600; color: #1f2937; margin: 1em 0 0.4em; line-height: 1.45; }
   #content h4, #content h5, #content h6 { font-size: 1em; font-weight: 600; color: #374151; margin: 0.85em 0 0.35em; }
   #content p { margin: 0.6em 0; line-height: 1.75; }
   #content ul, #content ol { margin: 0.6em 0; padding-left: 1.5em; }
   #content li { margin: 0.3em 0; line-height: 1.7; }
   #content li > p { margin: 0.25em 0; }
   #content hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.2em 0; }
   #content code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.9em; background: #f3f4f6; padding: 0.15em 0.35em; border-radius: 4px; }
   #content pre { white-space: pre-wrap; word-break: break-word; background: #f6f8fa; border: 1px solid #e5e7eb; padding: 12px 14px; border-radius: 6px; margin: 0.8em 0; line-height: 1.55; }
   #content pre code { background: none; padding: 0; font-size: 0.88em; }
   /* Only Markdown tables inside #content get borders; never the outer .print-frame. */
   #content table { border-collapse: collapse; width: 100%; max-width: 100%; table-layout: auto; margin: 0.85em 0; font-size: 0.92em; }
   #content th, #content td { border: 1px solid #cbd5e1; padding: 7px 11px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; line-height: 1.55; }
   #content th { background: #f8fafc; font-weight: 600; color: #0f172a; }
   #content tbody tr:nth-child(even) td { background: #fcfcfd; }
   #content blockquote { border-left: 3.5px solid #667eea; background: #f8fafc; margin: 0.8em 0; padding: 8px 14px; color: #475569; border-radius: 0 6px 6px 0; }
   #content img { max-width: 100% !important; height: auto !important; max-height: 170mm; object-fit: contain; display: block; margin: 10px auto; }
   #content td img, #content th img { max-height: 75mm; margin: 4px auto; }
   .chatsavor-math { max-width: 100%; }
   div.chatsavor-math { margin: 12px 0; padding: 4px 0; text-align: center; overflow-x: auto; overflow-y: hidden; }
   ```

---

### Task L-02：修复 `markdown.js` 单波浪号 `~` 误触发删除线 + 安全保留 `data:image/svg+xml` 矢量图与 `referrerpolicy`

- **目标文件**：`chrome-extension/src/content/markdown.js`

#### 详细修改要求

1. **彻底修复 `1~2 GB ... 1T~10T` 单波浪号误变删除线 Bug（`getMarked()`）**：
   - 在 `getMarked()` 的 `markedLib.use({ ... })` 中增加 `tokenizer` 配置，规定**只有成对双波浪号 `~~...~~` 才解析为删除线 `<del>`，单个波浪号 `~` 永远作为普通文本保留**：
     ```js
     tokenizer: {
       del: function(src) {
         // Only double-tilde ~~text~~ is strikethrough; single ~ (e.g. 1~2 GB, 1T~10T) is a literal range sign.
         // IMPORTANT: return undefined (NOT false!) when unmatched so Marked does NOT fall back to its built-in single-tilde GFM del rule.
         var match = /^~~(?=\S)([\s\S]*?\S)~~(?!~)/.exec(src);
         if (match) {
           return {
             type: 'del',
             raw: match[0],
             text: match[1],
             tokens: this.lexer.inlineTokens(match[1])
           };
         }
       }
     },
     ```
2. **实现安全 SVG Data URI 净化、CSS 变量固化与 Base64 归一化函数 `normalizeSafeSvgDataUrl(rawUrl)`**：
   - 仅处理以 `data:image/svg+xml`（忽略前导空白与大小写）开头的 URI，否则返回 `null`。
   - **解码**：分离 `^data:image\/svg\+xml((?:;[^,]*)?),([\s\S]*)$`；含 `;base64` 时用 `atob` + UTF-8 解码，否则用 `decodeURIComponent` 解码（抛错返回 `null`）。
   - **严格安全与完整性校验**：
     - 去空白后必须包含 `<svg` 且包含闭合标签 `</svg>`（这样 `tests/export-fixes.test.cjs` 中残缺的 `PHN2Zz4=` 即 `<svg>` 会在此直接返回 `null` 被剥离！）。
     - 黑名单拦截：若匹配 `/<(?:script|foreignobject|iframe|frame|object|embed|meta|link)\b/i`、`\bon[a-z]+\s*=/i`、`/javascript\s*:/i`、`/data\s*:\s*text\/html/i`，立即返回 `null`！
     - 用 `new DOMParser().parseFromString(svgText, 'image/svg+xml')` 解析：若 `!doc.documentElement || doc.documentElement.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')`，返回 `null`！
     - 遍历 SVG 所有元素：移除任何 `on*` 属性；若 `href` / `xlink:href` 值不以 `#` 开头（防止外链请求），移除该属性。
   - **固化宿主 CSS 变量为离线高对比度默认值**：
     - 序列化清洗后的 `<svg>`（`new XMLSerializer().serializeToString(doc.documentElement)`）。
     - 先处理带回退值的变量 `var(--name, fallback)` 保留其回退值或对纯未定义宿主变量做映射：
       - `/var\(--[^),]*(?:text|fg|foreground|prose|ink|label|primary)[^)]*\)/gi` → `'#1f2937'`
       - `/var\(--[^),]*(?:muted|secondary|caption|sub)[^)]*\)/gi` → `'#64748b'`
       - `/var\(--[^),]*(?:border|line|grid|divider|stroke)[^)]*\)/gi` → `'#cbd5e1'`
       - `/var\(--[^),]*(?:bg|background|surface|card|fill)[^)]*\)/gi` → `'#f8fafc'`
     - 确保根 `<svg>` 具有可读默认文字颜色（若无 `color` 样式则补充 `color:#1f2937`）。
   - **重编码为纯净 Base64**：
     - 返回 `'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(serializedSvg)))`（彻底消除 URL 中的括号 `(` `)` 被 Turndown 加反斜杠转义破坏的问题！）。
3. **接入 `extract(container)` 与 `sanitizeHtml(html)`**：
   - 在 `extract(container)` 中（删除装饰性 `svg` 之前）：
     - 遍历 `root.querySelectorAll('img[src^="data:image/svg+xml"]')`：调用 `normalizeSafeSvgDataUrl`，合法则更新 `src`，非法则 `remove()`。
     - 对包含 `>= 2` 个 `<text>` 子节点且不在 `button, [role="button"], a` 内的独立数据图表 `<svg>`：序列化并通过 `normalizeSafeSvgDataUrl` 转为 `<img alt="" src="data:image/svg+xml;base64,...">` 替换原 `<svg>`，再删除剩余纯图标 `<svg>`。
     - 对 `img[src^="http"]` 补上 `referrerpolicy="no-referrer"`。
   - 在 `sanitizeHtml(html)` 中：
     - 将 `referrerpolicy` 加入 `allowed` 属性正则（当 `attribute.name === 'referrerpolicy'` 时仅允许值为 `'no-referrer'`，否则移除该属性）。
     - 当 `node.tagName === 'IMG' && attribute.name === 'src'` 且以 `data:image/svg+xml` 开头时：调用 `normalizeSafeSvgDataUrl(attribute.value)`，返回非空则更新为该安全 Base64 URI 并放行，返回 `null` 则 `node.removeAttribute('src')`！

---

### Task L-03：修复豆包多层包裹下残留 `表格` 装饰头问题

- **目标文件**：`chrome-extension/src/content/platforms/doubao.js`

#### 详细修改要求
在 `doubao.js` 的 `extractReply(el, ctx)` 中，替换原先只查 1 层父节点的表格头清理逻辑，改为**向上最多回溯 5 层单表包裹容器**：
```js
// Strip Doubao's "表格" / "Table" card toolbar header even when <table> is wrapped
// inside 2–5 nested scroll/body container divs (e.g. mdbox-table-container > body > scroll > table).
clone.querySelectorAll('table').forEach(function(table) {
  var cur = table;
  for (var depth = 0; cur && cur !== clone && depth < 6; depth++) {
    var parent = cur.parentElement;
    if (parent && parent !== clone && parent.querySelectorAll('table').length > 1) break;
    var header = cur.previousElementSibling;
    if (header) {
      var meaningful = header.querySelector('table, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre');
      if (!meaningful) {
        var h = header.cloneNode(true);
        h.querySelectorAll('button, [role="button"], svg').forEach(function(n) { n.remove(); });
        var label = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^(?:表格|table)(?:\s*(?:复制|下载|全屏|放大|预览|copy|download))?$/i.test(label)) {
          header.remove();
          break;
        }
      }
    }
    cur = parent;
  }
});
```
> 注意：上方判断 `meaningful` 时不要把 `p` 或 `span`、`div` 直接排除在外，因为豆包有时会用 `<div class="title">表格</div>` 或 `<p>表格</p>` 写这个词，只要长度与正则 `/^(?:表格|table)...$/i` 精确匹配即可安全移除，绝不会误删正常正文段落！

---

### Task L-04：在 `chatgpt.js` 中结构化转换 `data-d-component` 交互卡片、分段按钮与多列网格

- **目标文件**：`chrome-extension/src/content/platforms/chatgpt.js`

#### 详细修改要求
在 `chatgpt.js` 的 `extractReply(el)` 中，在将 `clone` 交给 `core.extractMarkdown(clone)` 之前调用 `normalizeDilComponents(clone)`：
1. **移除无文本滑块轨道**：`clone.querySelectorAll('[data-d-component="slider"]').forEach(function(n) { n.remove(); });`，并移除纯色块裁剪进度条 `[data-d-clip="true"]`（内部仅含单字母色块标签而无实质说明文字的条形图块）。
2. **保留分段切换控件选项 `[data-d-component="segmented-control"]`**：
   - 在通用按钮清理发生前，将其内部的 `button, [role="radio"], [role="tab"]` 提取出来：选中项（`aria-checked="true"` 或 `data-state="on"`）格式化为 `<strong>[✓ 文本]</strong>`，未选中项格式化为 `[文本]`，用 `' · '` 连接放入单个 `<p>` 替换整个 `segmented-control`。
3. **将多列指标/图片网格 `[data-d-component="grid"]` 转换为紧凑 HTML `<table>`**：
   - 获取直接网格项 `items = Array.from(grid.children)`（要求 `items.length >= 2`）。
   - 从 `grid.getAttribute('style')` 解析 `repeat\((\d+),` 得到列数 `cols`（默认 `Math.min(items.length, 3)`）。
   - 对每个 `item`：移除空的点击遮罩按钮 `button[data-d-component="pressable"]`（注意若按钮包裹了图片/内容则将其子节点提升保留后再移除空按钮壳！）；将内部的 `h1, h2, h3, h4` 降级为 `<strong>`（避免表格单元格内出现块级标题），多个子块之间插入 `<br>`。
   - 按每行 `cols` 列组装 `<table><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table>`（当只有 1 行时直接作为单行表或首行 `<th>` 展示；为避免 `tableToMarkdown` 在首行全 `<td>` 时自动插入 `Column 1 | Column 2` 假表头，若只有 1 行指标卡/对比图，可将第 1 行的单元格用 `<th>` 输出，或将每个卡片的“标签”放进 `<thead>` 的 `<th>`、“数值/图片”放进 `<tbody>` 的 `<td>`！**这一点非常关键：例如 2 个网格项 `[Patch 总数量: 16, 每个 Patch 像素数: 256]` 或 3 张对比图 `[img1+原始结构, img2+模糊结构, img3+噪声干扰]`，把标签提做 `<th>`、数值/图片放做 `<td>`，生成的 Markdown 表格将无比优雅自然，绝不会出现 `Column 1` 字样！**）。
4. **合并叶子级横向键值行 `[data-d-component="row"]`**：
   - 对内部不含 `table, pre, ul, ol, img, [data-d-component="grid"], [data-d-component="card"]` 的叶子级 `[data-d-component="row"]`：提取其直接子元素的非空短文本（跳过空 `Spacer` 和纯圆点色块 `box`），用 `' · '` 合并进单个 `<p>` 替换该 `row`。

---

### Task L-05：在 `print.js` 中等待所有图片加载与解码完成后再唤起自动打印

- **目标文件**：`chrome-extension/src/export/print.js`

#### 详细修改要求
1. 新增 `waitForImagesReady(container, maxWaitMs, callback)`：
   - 查找 `var pending = Array.from(container.querySelectorAll('img')).filter(function(img) { return !img.complete; });`。
   - **既有测试兼容铁律**：若 `pending.length === 0`，**必须立即同步调用 `callback()`**（保证无未加载图片时原有的 `600ms` 自动打印定时器行为丝毫不变！）。
   - 若 `pending.length > 0`：
     - `status.textContent = '正在加载图片 (0/' + pending.length + ')…';`
     - 设 `maxWaitMs = 6000` 超时兜底定时器，防止损坏外链死锁。
     - 监听每张图片的 `load` / `error`（`{ once: true }`），加载成功后若存在 `img.decode` 则等待 `img.decode().catch(function(){})` 再计数；每完成一张更新 `(done/total)`；全部完成或超时后恢复 `已就绪，共 X 字符` 状态文案，若 `!userInteracted` 则调用 `scheduleAutoPrint()`。

---

### Task L-06：新增全套真行为回归测试

- **目标文件**（新建）：`chrome-extension/tests/pdf-chatgpt-layout.test.cjs`

#### 必须包含并真实通过的 6 组运行时测试
1. **单波浪号范围值不误变删除线**：输入 `'506M token 大约相当于 1~2 GB 的清洗后纯文本（动辄 1T~10T tokens，比它大 3~4 个数量级），保留真正的 ~~已废弃方案~~。'`，调用 `ChatSavorMarkdown.render()`：
   - 断言输出包含完整原样文本 `'1~2 GB'`、`'1T~10T'`、`'3~4'`；
   - 断言 `<del>` 标签数量严格等于 `1` 且其内容仅为 `'已废弃方案'`！
2. **打印页边距权重与防撑爆样式验证**：
   - 解析 `print.html`，验证 `.print-frame` 含 `table-layout: fixed`，`@media print` 内 `.print-frame > tbody > tr > td.page-body-cell` 含 `padding: 0 18mm !important`（权重高于外层 `td` 的 `padding: 0`），`#content img` 含 `max-width: 100%`，`#content th` 含 `text-align: left` 与背景色，`#content tr` 含 `break-inside: avoid` 且 `#content table` 保留 `border-collapse`。
3. **豆包多层嵌套表格装饰头 `表格` 彻底剥离验证**：
   - 在 JSDOM 中加载 `doubao.js`，构造 3 层嵌套 `<div class="mdbox-table-container"><div class="mdbox-table-header"><div class="title">表格</div><div class="icons"><svg></svg></div></div><div class="mdbox-table-body"><div class="scroll-area"><div class="inner"><table><thead><tr><th>维度</th><th>换算结果</th></tr></thead><tbody><tr><td>中文汉字</td><td>约 5 亿</td></tr></tbody></table></div></div></div></div>`：
   - 断言 `adapter.extractMarkdown(replyEl).markdown` 包含 `| 维度 | 换算结果 |`，且**不包含孤立的 `表格` 行**！
4. **`data:image/svg+xml` 流程图/实验热力图无损保留 + CSS 变量替换 + 恶意 SVG 拦截**：
   - 输入含括号 `translate(10,20)`、`var(--color-text-prose)` 及实验数值 `<text>32.0</text><text>39.5</text>` 的 `<img data-d-component="svg" src="data:image/svg+xml;charset=utf-8,...">`：
   - 经 `extract()` → `render()` 后，断言 `<img src="data:image/svg+xml;base64,...">` 完整保留，解码验证含 `32.0`、`39.5` 且 `var(--color-text-prose)` 已替换为 `#1f2937`；
   - 同时断言含 `<script>` 或 `onload=` 的恶意 `data:image/svg+xml` 被 `sanitizeHtml` 彻底剥离 `src`！
5. **ChatGPT `data-d-component` 分段按钮、多列网格（无 `Column 1` 假表头）与键值行转换验证**：
   - 断言 `segmented-control` 的 `[8 × 8]`、`**[✓ 16 × 16]**`、`[32 × 32]` 完整保留；
   - 断言 `grid` 转为 Markdown 表格且表头为真实标签而非 `Column 1`；
   - 断言 `row` 合并在同一行。
6. **`print.js` 外链图片未加载完时不提前触发打印，加载完成后自动打印**：
   - 注入 `complete === false` 的 `<img>`，验证 `700ms` 时 `prints.length === 0` 且状态栏显示 `正在加载图片`；触发 `load` 事件后自动完成打印。

---

## 3. 执行自检 Checklist

- [x] **Task L-01** 重构 `src/export/print.html`（修复 `.page-body-cell` 权重覆盖归零 Bug、锁死 `.print-frame` 宽度、补齐 `#content` 印刷级排版与图片/表格样式）
- [x] **Task L-02** 更新 `src/content/markdown.js`（修复单波浪号 `~` 删除线误判 + 安全保留并固化 `data:image/svg+xml` 矢量图 + `referrerpolicy`）
- [x] **Task L-03** 更新 `src/content/platforms/doubao.js`（支持向上最多 5 层单表容器剥离孤立的 `表格` 装饰头）
- [x] **Task L-04** 更新 `src/content/platforms/chatgpt.js`（`normalizeDilComponents` 结构化转换交互分段按钮、多列网格与横向行）
- [x] **Task L-05** 更新 `src/export/print.js`（`waitForImagesReady` 等待未完成图片解码后再自动打印）
- [x] **Task L-06** 新建 `tests/pdf-chatgpt-layout.test.cjs` 全部 6 组真行为测试通过
- [x] 运行 `npm --prefix chrome-extension test` 确认 171 + 新增测试全部 `0 fail, 0 skipped`
- [x] 运行 `npm --prefix chrome-extension run check:version` 通过，且 `git status` 无临时垃圾脚本
