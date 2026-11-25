# ChatSavor Word (.docx) 导出图片、公式、截断吞噬与排版深度修复方案（DeepSeek Harness 专用执行规范）

> **文档定位**：本规范面向自动化编码代理（DeepSeek Harness），针对用户实测导出的 ChatGPT 科研长文 `.docx` 文档进行**全链路法医级审查与彻底修复**。
>
> **核心发现总览**：通过逐行比对用户导出的 `.docx` 实际内容与 [docx-builder.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/docx-builder.js)、[omml.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/omml.js)、[markdown.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/markdown.js)、[chatgpt.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/platforms/chatgpt.js) 源码，除了图片未嵌入而直接吐出数万字 Base64 乱码外，还挖出了 **5 个隐藏极深的严重缺陷**（后半篇 60% 正文被 `\[` 误判为数学公式整段吞噬、所有独立公式缺少 `<m:oMath>` 被 Word 降级拍扁为纯文本、Recharts 图表因重复 `style=` 属性导致 XML 崩溃、表格列宽写死溢出及 `<br>` 失效、ChatGPT 网格卡片文字粘连与空行表）。本方案将一次性彻底根治全部 **6 大类缺陷**。

---

## 一、 实测导出文档的 6 大类缺陷与源码级根因诊断

### 缺陷 1（图片灾难）：全部 16 张图表未转存为 Word 媒体部件，直接将数千字符的 `![](data:image/svg+xml;base64,...)` 原样印成正文乱码
- **根因 A（[docx-builder.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/docx-builder.js#L92-L143) 完全缺失图片打包与 DrawingML 能力）**：
  当前 `docx-builder.js` 既没有把 `![alt](src)` 解析为图片节点，也没有生成 `word/media/imageN.png`、`word/_rels/document.xml.rels` 图片关系与 `<w:drawing><wp:inline>...` XML，导致所有 `data:image/svg+xml;base64,...` 和外链图片全部以数千字符的 Base64 原始文本裸印在 Word 页面里。
- **根因 B（Word 对原生 `.svg` 兼容性差，必须光栅化为高分 PNG 嵌入）**：
  Microsoft Word 2016/2019、WPS Office、macOS Pages 等对缺少 PNG 兜底的 `.svg` 部件支持残缺。必须将 `data:image/svg+xml`（及 `webp` / 外链图）在浏览器端离屏 `<canvas>` 按 **`3×` 高清倍率（白底 `#ffffff` + 深色墨水 `#1f2937`）** 光栅化为标准 PNG 二进制字节写入 `word/media/imageN.png`，并在 DrawingML `extent` 中按原始逻辑宽高（`1 px = 9525 EMU`）等比缩放展示，才能保证在所有版本 Office / WPS 中 100% 印刷级清晰显示！
- **根因 C（[docx-builder.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/docx-builder.js#L40) 内置 `zip(files)` 会破坏二进制图片字节）**：
  内置 `zip(files)` 对所有条目无条件执行 `utf8(file.data)`，一旦传入二进制 `Uint8Array` 图片就会被强转成字符串 `"[object Uint8Array]"` 损坏文件。
- **根因 D（图片与前后图注粘连在同一行）**：
  如实测文本中 `假设数值…并非真实实验结果![](data:...)` 与 `![](data:...)图中迁移思路…`：[markdown.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/markdown.js#L220-L223) 将块级 `<svg>` 替换为行内 `<img>` 时未包裹块容器，导致 Turndown 将图片与相邻说明文字拼在同一行。

---

### 缺陷 2（致命渲染崩溃）：Recharts 等带 `style` 属性的 SVG 被注入第二个重复 `style=` 属性，导致 XML 解析彻底失败！
查看实测文档第 7.2 节的柱状图 Base64 解码后的 `<svg>` 根标签：
```xml
<svg ... style="width: 100%; height: 100%; display: block;" style="color:#1f2937">
```
- **根因（[markdown.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/markdown.js#L336)）**：
  ```js
  if (!/color\s*:/i.test(svg)) svg = svg.replace(/<svg([^>]*)>/, '<svg$1 style="color:#1f2937">');
  ```
  当原始 `<svg>` 已经有 `style="width: 100%; ..."`（但不含 `color:`）时，这行正则强行塞入了**第二个 `style` 属性**！
  在严格 XML 规范（`image/svg+xml`）中，**同名属性重复声明属于致命语法错误（`Attribute style redefined`）**，这会导致该图表在 **预览弹窗、PDF、长图卡片、HTML 以及 Word 转换中全部加载失败报错**！

---

### 缺陷 3（灾难性正文吞噬）：从第 6.5 节起，后半篇 60% 的全文（第 6.5 ～ 17.3 节）全部沦为未解析的原始 Markdown 代码，且首尾多出一对 `$$`！
查看实测文档第 6.5 节与文末最后一行的惊人现场：
```text
$$8 × 8\] · \*\*\[✓ 16 × 16\]\*\* · \[32 × 32\]
...（中间整整 11 个大章节全部变成 ## **6.6**、| --- |、$$ \alpha=0.8 $$ 原始源码！）...
以上内容是基于你提供的图片……进一步验证。$$
```
- **两步连环触发根因**：
  1. **第一步（[chatgpt.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/platforms/chatgpt.js#L157-L160)）**：`normalizeDilComponents` 把交互分段按钮拼成 Markdown 字符串赋给了 `p.textContent = '[8 × 8] · **[✓ 16 × 16]** · [32 × 32]'`；随后 Turndown 将 DOM 文本中的 `[` 和 `*` 转义成了 **`\[8 × 8\] · \*\*\[✓ 16 × 16\]\*\* · \[32 × 32\]`**！
  2. **第二步（[docx-builder.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/docx-builder.js#L194-L211)）**：`markdownToDocumentXml` 第 194 行用 `/^\s*\\\[\s*/.test(line)` 检测 `\[ ... \]` 块级公式！它看到行首是 `\[`，**既没检查 `\]` 是否已在本行闭合，也没检查这是不是普通转义方括号**，直接执行 `i++` 进入 `while (i < lines.length && !/\\\]\s*$/.test(lines[i]))` 死循环向后寻找以 `\]` 结尾的行！由于后文再也没有任何一行以 `\]` 结尾，**第 6.5 节直到第 17.3 节全文末尾被整块吞进 `blockMath`**，KaTeX 转换失败后走第 210 行兜底，把整整 11 章正文包进 `'$$' + blockMath + '$$'` 当作一段居中纯文本输出到了 Word 里！

---

### 缺陷 4（所有独立公式全部失效拍扁）：Word 中所有 `$$...$$` 独立公式全部丢失分式线、上下标与尖帽符号（如 `PSNR=10log10MAX2MSE`、`SAM(x,x)=arccos...`）！
查看实测文档前 6 章的所有独立公式：
- `PSNR=10log⁡10MAX2MSE`（分式线消失、`10` 下标与 `2` 上标全部变成平排普通字符！）
- `SAM(x,x)=arccos⁡xTx∥x∥∥x∥`（$\hat{x}$ 的尖帽 `^` 消失、`T` 上标与分式线全部消失！）
- `YM=RX+NM`、`YH=XBS+NH`、`τ=(s0,a0,...)`、`Tband=[t1,t2,…,t31]`（所有下标全部被拍平！）
- **致命根因（[omml.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/omml.js#L164-L188) 的 `indexOf` 前缀误判漏洞！）**：
  看现存第 172 行与第 185 行代码：
  ```js
  // 第 172 行 (mathmlToOmml):
  return displayMode ? '<m:oMathPara>' + body + '</m:oMathPara>' : body;
  // 第 185 行 (latexToOmml):
  if (omml.indexOf('<m:oMath') === 0) return omml;
  return displayMode ? '<m:oMathPara><m:oMath>' + omml + '</m:oMath></m:oMathPara>' : '<m:oMath>' + omml + '</m:oMath>';
  ```
  当 `displayMode === true` 时，`mathmlToOmml` 返回 `'<m:oMathPara><m:r>...</m:r><m:f>...</m:f></m:oMathPara>'`（**里面根本没有包 `<m:oMath>`！**）。而第 185 行判断 `omml.indexOf('<m:oMath') === 0` 时，因为 **`'<m:oMathPara>'` 的前 8 个字符恰好也是 `'<m:oMath'`**，条件误判为 `true` 直接提前返回了！
  根据 OOXML 标准（ISO/IEC 29500-1），`<m:oMathPara>` 下**严禁直接放置 `<m:r>` / `<m:f>` / `<m:sSub>`，必须包裹在 `<m:oMath>` 内**（即 `<m:oMathPara><m:oMath>...</m:oMath></m:oMathPara>`）！Word 打开非法 `<m:oMathPara>` 时直接丢弃全部数学结构，只保留纯字母数字！
- **附带 OMML 缺陷**：[omml.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/omml.js#L97) 中大型运算符 `\sum` / `\int` 生成的 `<m:nary>` 把 `<m:e>` 写成了空 `<m:e></m:e>`，未吸收 `<mrow>` 中紧随其后的被求和项（如 `E_i^2`），导致 Word 在求和号右侧显示难看的虚线占位方框 `⬚`！

---

### 缺陷 5（表格与行内排版缺陷）：表格列宽写死导致溢出/过窄、单元格 `<br>` 失效、标题粗体嵌套与分隔线 `---` 裸露
1. **列宽写死 `2400 dxa`（[docx-builder.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/docx-builder.js#L233)）**：A4 版芯宽度为 `9026 dxa`。写死每列 `2400 dxa` 导致 2 列表格只有半页宽（`4800 dxa`），而 4～5 列表格（`9600～12000 dxa`）直接冲出 Word 页面右边界！
2. **单元格内 `<br>` 与转义符原样裸露**：Markdown 表格多行内容以 `<br>` 连接（如 `波段组 A 25%<br>波段组 B 25%`），`docx-builder.js` 未将 `<br>` 转为 `<w:r><w:br/></w:r>`，而是转义成字面量 `<br>`；同时正文中的 Markdown 转义符（如 `\*`、`\[`、`\]`、`\_`、`\$`）未还原，Word 中直接显示反斜杠。
3. **复合行内语法断层**：如 `## **6.6 Patch-Band Token**` 或 `**加粗内含 $x_i$ 公式或 `代码`**`：当前 `plainSegment` 正则遇到嵌套或跨数学公式的 `**...**` 会解析失败；水平分割线 `---` 未处理，直接输出三个减号文本；引用块 `Quote` 与代码块缺少边框与行距美感。

---

### 缺陷 6（ChatGPT 交互组件提取缺陷）：网格卡片文字粘连成一坨、含图网格丢图变空表
1. **卡片多行文字粘连**（实测第 5.1 节：`融合轨迹 A发现纹理缺失全局强细节注入产生光谱失真假设奖励0.3低奖励轨迹`）：[chatgpt.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/platforms/chatgpt.js#L190-L195) 的 `cellParts` 直接对包裹多层子 `<div>` 的父节点读取 `node.textContent`，导致所有子块文字毫无间隔地粘成一串！
2. **网格内纯图形 `<svg>` 被丢弃导致产出空表 `|  |  |  |`**（实测第 7.3 节与第 14.2 节 `原始结构 | 模糊结构 | 噪声干扰`）：`normalizeDilComponents` 在 `markdown.js` 之前运行，但 `cellParts` 只保留了 `STRONG|IMG`，导致网格内的 `<svg>` 示意图被丢弃，且当所有单元格没有第二行 `value` 时生成了一行全空的 `|  |  |  |` 空数据行！

---

## 二、 工程红线与零回归契约（执行前必读！）

1. **零构建 MV3 纯净架构**：保持原生 JS IIFE + `'use strict'`，零外部依赖、零 CDN。
2. **严守现有 201+ 项单测契约（特别是以下 4 条高频陷阱！）**：
   - **`tests/bugfix09.test.cjs` 同步点击契约**：该测试在无图片的纯文本 Markdown（`'# Visible heading\n\nBody text'`）上点击 `.docx` 后**不等待异步微任务，下一行立即断言 `captured.length === 2`**！因此：
     - 必须提供 `ChatSavorDocx.needsAsyncMedia(markdown)` 判断函数：当文档**不含** `data:image/svg+xml`、`data:image/webp` 及 `http(s)://` 外链图片时，`core.js` 的 `.docx` 按钮**必须同步调用 `ChatSavorDocx.build(prepared.text)` 并同步触发 `saveBlob`**！
     - 仅当 `needsAsyncMedia(markdown) === true`（存在需要浏览器异步光栅化的 SVG / WebP 或需要抓取的外链图片）时，`.docx` 按钮才走异步 `ChatSavorDocx.buildAsync(prepared.text)`！
   - **`tests/bugfix10.test.cjs` 独立加载与正则契约**：
     - `docx-builder.js` 被单独 `eval`（无 `katex`、`omml`、`zip`、`marked`）时必须 100% 正常工作；
     - `stylesXml()` 输出中**严禁包含 `outlineLvl` 字符串**（`assert.doesNotMatch(styles, /outlineLvl/)`）；
     - 表格行起始标签必须保持干净的 `<w:tr>` 且单行输出 `<w:tr>...</w:tr>`，确保 `xml.match(/<w:tr>(.*?)<\/w:tr>/)[1]` 精确命中首行！
   - **严禁触碰 `src/lib/katex.js`**（保护 quirks-mode 补丁）。

---

## 三、 分模块精确修复指令（Task D-01 ～ Task D-05）

---

### Task D-01：修复 `src/content/markdown.js` 重复 `style` 属性 Bug 与块级图表换行

**修改文件**：[markdown.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/markdown.js)

1. **修复 `normalizeSafeSvgDataUrl` 中重复注入 `style` 属性导致 XML 崩溃的缺陷（第 331-337 行）**：
   - **彻底删除** `if (!/color\s*:/i.test(svg)) svg = svg.replace(/<svg([^>]*)>/, '<svg$1 style="color:#1f2937">');` 这行危险的字符串正则拼接！
   - 改为在 `XMLSerializer` 序列化**之前**（操作已解析好的 `doc.documentElement`）：
     ```js
     var existingStyle = doc.documentElement.getAttribute('style') || '';
     if (!/(?:^|;)\s*color\s*:/i.test(existingStyle)) {
       doc.documentElement.setAttribute('style', (existingStyle ? existingStyle.replace(/;\s*$/, '') + '; ' : '') + 'color: #1f2937');
     }
     ```
   - 同时在字符串级 CSS 变量替换后，用 `new DOMParser().parseFromString(svg, 'image/svg+xml')` 做一次快速校验（或确保无重复属性），保证输出的每一条 `data:image/svg+xml;base64,...` 100% 是合法严密的 XML，绝不出现两个 `style=` 属性！
2. **修复块级 `<svg>` 替换 `<img>` 时与前后图注文字粘连（第 214-224 行）**：
   - 在 `extract(container)` 中将独立数据图表 `<svg>` 转为 `<img>` 时：检查 `svg.parentElement`：若 `svg` 不在 `p, td, th, li, a, span` 行内上下文内（例如直接位于 `div, section, figure, article` 下），将生成的 `<img>` 包裹在 `<p>` 元素中（`var wrap = document.createElement('p'); wrap.appendChild(img); svg.replaceWith(wrap);`），确保 Turndown 在图片前后自动生成独立的段落空行 `\n\n`，不再与前后的图注句子粘在同一行！

---

### Task D-02：修复 `src/content/platforms/chatgpt.js` 交互组件提取（消除 `\[` 假公式触发源、卡片文字粘连与丢图空表）

**修改文件**：[chatgpt.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/platforms/chatgpt.js)（`normalizeDilComponents`）

1. **分段控制器 `[data-d-component="segmented-control"]` 改用真实 DOM 节点而非裸 Markdown 文本（第 151-162 行）**：
   - 严禁往 `p.textContent` 里塞 `**[✓ ...]**` 或行首 `[...]`（会被 Turndown 转义成行首 `\[` 和 `\*\*`）！
   - 改为构造真实 DOM 结构：
     ```js
     var p = document.createElement('p');
     var idx = 0;
     control.querySelectorAll('button, [role="radio"], [role="tab"]').forEach(function(btn) {
       var label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
       if (!label) return;
       if (idx++ > 0) p.appendChild(document.createTextNode(' · '));
       var selected = btn.getAttribute('aria-checked') === 'true' || btn.getAttribute('data-state') === 'on' || btn.classList.contains('selected');
       if (selected) {
         var strong = document.createElement('strong');
         strong.textContent = '【✓ ' + label + '】';
         p.appendChild(strong);
       } else {
         p.appendChild(document.createTextNode('（' + label + '）'));
       }
     });
     if (idx > 0) control.replaceWith(p);
     else control.remove();
     ```
2. **修复网格 `[data-d-component="grid"]` 内部 `<svg>` 丢失、多行文字粘连与全空数据行（第 165-228 行）**：
   - **保留网格内可视化 `<svg>`**：在提取 `item` 内容前，先查找 `item` 内所有非按钮内的 `<svg>`（只要包含 `rect, path, circle, line, polygon, polyline, ellipse, text` 之一且宽/viewBox 有效），用 `XMLSerializer` 序列化为 `data:image/svg+xml;charset=utf-8,...` 替换为 `<img src="...">`（后续 `core.extractMarkdown` 会自动调用 `normalizeSafeSvgDataUrl` 净化转码），这样第 14.2 节的 3 张结构对比示意图就会完整保留在表格单元格里！
   - **递归提取块级文本行，杜绝文字粘连**：编写辅助函数 `extractCellLines(root)`：
     - 若节点是 `IMG`，推入 `node.outerHTML`；
     - 若节点是 `STRONG` / `B` / `H1`–`H4` 且内部无子块，推入 `'<strong>' + escapeText(text) + '</strong>'`；
     - 若节点是容器元素（`DIV, P, SECTION, UL, LI` 等）且内部含有多个子元素块，**递归收集其子节点行**（而不是一把调 `node.textContent` 糊成一团！），使得 `融合轨迹 A` / `发现纹理缺失` / `全局强细节注入` 各自独立成行并用 `<br>` 分隔！
   - **拦截全空数据行 `|  |  |  |`**：当 `items.length === cols` 且所有 `parsed[c].value` 均为空字符串时（例如只有单行指标标签而无交互动态数值的占位卡片），不要生成全空的 `<tbody><tr><td></td>...</tr></tbody>`，改为将非空标签合并为紧凑说明段落（`parsed.map(x => x.label).filter(Boolean).join(' ｜ ')`）替换 `grid`，彻底消灭无意义的空白表格！

---

### Task D-03：修复 `src/lib/omml.js` 独立公式 `<m:oMath>` 缺失与大型运算符 `<m:nary>` 空占位框

**修改文件**：[omml.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/omml.js)

1. **彻底修复 `mathmlToOmml` 与 `latexToOmml` 的 `<m:oMath>` 根节点包裹（第 164-188 行）**：
   - `mathmlToOmml(mathmlString, displayMode)` **必须始终生成合法的 `<m:oMath>` 内核**：
     ```js
     function mathmlToOmml(mathmlString, displayMode) {
       if (!mathmlString) return null;
       try {
         var doc = new DOMParser().parseFromString(String(mathmlString), 'text/html');
         var math = Array.from(doc.querySelectorAll('math'))[0] || null;
         if (!math) return null;
         var body = conv(math);
         if (!body) return null;
         var omath = '<m:oMath>' + body + '</m:oMath>';
         return displayMode
           ? '<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>' + omath + '</m:oMathPara>'
           : omath;
       } catch (ignored) { return null; }
     }
     ```
   - `latexToOmml(latex, displayMode)` 直接调用并返回 `mathmlToOmml(mathml, displayMode)`，**删掉原先错误的 `if (omml.indexOf('<m:oMath') === 0) return omml;` 判断**！确保每一个 `displayMode = true` 的独立公式都严格产出 `<m:oMathPara>...<m:oMath>...</m:oMath></m:oMathPara>`，让 Microsoft Word 与 WPS 100% 识别分式、上下标、根号、矩阵与尖帽重音！
2. **修复 `\sum` / `\prod` / `\int` 大型运算符 `<m:nary>` 吞并右侧被运算项 `<m:e>`**：
   - 在处理 `<mrow>`（以及 `<math>` 顶层子节点序列 `convSeq(kids)`）时：
     - 识别当前子节点 `kids[idx]` 是否能生成 `<m:nary>`（即 `kids[idx]` 本身是 `NARY_CHARS` 的 `<mo>`，或者是底数 `parts[0]` 为 `NARY_CHARS` 的 `msub/msup/msubsup/munder/mover/munderover`）。
     - 若是 `nary` 节点，向后收集紧随其后的兄弟节点作为 `<m:e>` 的被求和/被积分表达式（直到遇到顶层二元加减号 `+` / `-` / `−`、关系符 `=` / `≠` / `<` / `>` / `≤` / `≥` / `≈` / `\ne`、逗号分号或流结束；若后面紧跟无项则至少放入一个零宽占位 `<m:r><m:t>&#8203;</m:t></m:r>` 防止非法空 `<m:e/>`），拼入 `<m:nary>...<m:e>{operandXml}</m:e></m:nary>`！
     - 这样 `$$\sum_i E_i^2$$` 和 `$$\sum_i P_i \log \frac{P_i}{Q_i}$$` 在 Word 中将完美把 `E_i^2` 放进求和号右方主体槽，彻底消除虚线占位框 `⬚`！
3. **补全 KaTeX 重音符号映射 `ACC_MAP`**：
   - 支持 `^`、`\u02C6`（`ˆ`）、`\u0302`（组合尖帽）、`~`、`\u02DC`（`˜`）、`\u0303`、`→`、`\u20D7`、`⇀`、`˙`、`\u0307`、`¨`、`\u0308`、`¯`、`\u0304`、`‾`、`\u0305`、`ˇ`、`\u030C`、`˘`、`\u0306`；当 `<mover>` 的上标节点包含上述字符（即使外层套了一层 `<mrow>` 或 `<mtext>`）时均准确输出 `<m:acc><m:accPr><m:chr m:val="..."/></m:accPr><m:e>...</m:e></m:acc>`，确保 $\hat{X}_t$、$\hat{x}$、$\tilde{y}$、$\vec{v}$ 100% 在 Word 中带帽显示！

---

### Task D-04：全面升级 `src/lib/docx-builder.js`（原生高清图片嵌入 + 防吞噬公式解析 + 自适应表格与排版美学）

**修改文件**：
- [docx-builder.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/docx-builder.js)
- [core.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/core.js)（仅微调 `btnDocx` 点击逻辑以支持智能同步/异步切换）

#### 1. 修复内置二进制安全的 `zip(files)`
- 将 `docx-builder.js` 内的 `zip(files)` 升级为支持混合文本与二进制 `Uint8Array` / `ArrayBuffer`（与 `zip.js` 一致：若 `file.data` 是 TypedArray 或 ArrayBuffer 则直接使用原始字节，否则 `utf8(file.data)`；通用位标志设为 `0x0800` UTF-8 文件名），确保独立加载 `docx-builder.js` 时也能无损打包二进制图片！

#### 2. 实现高清图片解析、SVG 3× 光栅化与 OOXML DrawingML 嵌入管线
1. **同步位图尺寸嗅探与解码（无需 DOM 即可在同步 `build()` 中嵌入 PNG / JPEG / GIF！）**：
   - 编写纯字节头解析函数 `readImageDimensions(bytes, mime)`：
     - **PNG**：校验 `0x89 0x50 0x4E 0x47`，从第 `16..23` 字节读取大端 `uint32` 的 `width` 与 `height`；
     - **GIF**：从第 `6..9` 字节读取小端 `uint16` 的 `width` 与 `height`；
     - **JPEG**：扫描 `0xFF 0xC0` / `0xFF 0xC1` / `0xFF 0xC2`（SOF0/1/2）段读取高与宽；
     - 若未能解析则回退默认 `480 × 280`。
2. **异步媒体预处理与 SVG 3× 高清光栅化 `prepareMediaMap(markdown)`（供 `buildAsync(markdown, options)` 调用）**：
   - 扫描 Markdown 中全部图片语法 `![alt](src)` 与 `<img ... src="...">`：
   - **针对外链 `http(s)://` 图片**：若存在 `window.ChatSavorAssets` 或 `chrome.runtime.sendMessage({ type: 'CHATSAVOR_FETCH_IMAGE', url })`，先抓取转为 `data:image/...;base64,...`（抓取失败则记录为不可达，后续在 Word 中优雅渲染灰色提示文字 `[外部图片未能离线加载：alt]`，绝不吐乱码）。
   - **针对 `data:image/svg+xml`（如全部 16 张 ChatGPT 科研图表！）与 `data:image/webp`**：
     - 解码 SVG XML，提取：
       - `viewBox="minX minY vbW vbH"` 的 `vbW, vbH`；
       - 显式像素 `width` 属性（例如第 6.2 节小图标 `width="110px"` vs 全宽图 `width="100%"`）：
         - 若原始 `<svg>` 写的是百分比宽度（如 `width="100%"`）或未写 `width`，在 Word 中的**目标展示逻辑宽度 `displayWidthPx`** 设为 `Math.min(540, Math.max(vbW || 480, 420))`（例如 `viewBox="0 0 340 405"` 适度放大到 `440px` 宽使其在 A4 页面居中舒展清晰；`viewBox="0 0 718 432"` 等比缩放到 `540px` 宽适应页宽），`displayHeightPx = Math.round(displayWidthPx * (vbH / vbW))`；
         - 若原始 `<svg>` 写的是明确小像素值（如 `width="110px"` 或 `width="120px"` 且 `< 260`），保留其精巧尺寸 `displayWidthPx = rawWidthPx`，`displayHeightPx = Math.round(rawWidthPx * (vbH / vbW))`！
       - 确保 `<svg>` 根标签具备明确数值 `width="{vbW}" height="{vbH}"` 且无重复属性。
     - **离屏 `3×` Canvas 高清白底光栅化**：
       - 创建 `<canvas>`，尺寸设为 `canvas.width = Math.round(displayWidthPx * 3)`、`canvas.height = Math.round(displayHeightPx * 3)`（单边上限 `4096`）；
       - 先用纯白 `#ffffff` 铺满画布 `ctx.fillRect(0, 0, canvas.width, canvas.height)`（防止透明底 SVG 在部分 Office 阅读器深色视图或打印驱动下变黑块），再 `ctx.drawImage(img, 0, 0, canvas.width, canvas.height)`；
       - 导出 `canvas.toDataURL('image/png')` 解码为 `Uint8Array` PNG 字节，并记录 `{ bytes, ext: 'png', contentType: 'image/png', displayWidthPx, displayHeightPx }`！
3. **生成合法的 OOXML DrawingML `<w:drawing>`**：
   - 在 `word/document.xml` 根元素补充命名空间声明：
     - `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
     - `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`
     - `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
     - `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`
   - 计算 EMU 尺寸（`1 px = 9525 EMU`）：
     - 版芯最大像素宽度 `MAX_DOC_IMG_PX = 560`（约 `14.8 cm`，留足左右页边距）。若 `displayWidthPx > MAX_DOC_IMG_PX`，按 `scale = MAX_DOC_IMG_PX / displayWidthPx` 等比缩放宽高！
     - `cx = Math.max(9525, Math.round(wPx * 9525))`，`cy = Math.max(9525, Math.round(hPx * 9525))`。
   - 为每张嵌入图片分配递增 `docPrId`（`1, 2, ...`）、媒体路径 `word/media/image{N}.{ext}` 与关系 ID `rIdImg{N}`：
     - 在 `word/_rels/document.xml.rels` 中注册 `<Relationship Id="rIdImg{N}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{N}.{ext}"/>`；
     - 在 `[Content_Types].xml` 中按需补充 `<Default Extension="png" ContentType="image/png"/>`（及 `jpg`/`jpeg`/`gif`）；
     - 生成标准 `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{id}" name="Picture {id}" descr="{esc(alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{id}" name="image{id}.{ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg{id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`。
   - **独立图片段落自动居中**：当某一行仅包含一张图片 `^\s*!\[[^\]]*\]\([^)]+\)\s*$` 时，生成的 `<w:p>` 自动加上居中对齐 `<w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr>`！
   - **无 Canvas 环境（如纯 JSDOM 同步调用 `build()` 遇到 `data:image/svg+xml`）优雅降级**：若同步调用时未提供预光栅化 PNG 且当前环境无法同步光栅化 SVG，**绝不允许把 `data:image/svg+xml;base64,...` 原始长串吐进 `<w:t>`**！改为输出简洁占位说明 `[矢量图表：请在浏览器中点击 .docx 导出以嵌入高清图片]`（而在浏览器真实点击 `.docx` 时因为走 `buildAsync` 已全部转为高清 PNG，将 100% 嵌入真图！）。

#### 3. 彻底修复块级公式边界检测（根除吞噬后半篇文档的恶性 Bug！）
在 `markdownToDocumentXml` 中重写块级公式识别逻辑：
1. **单行 `$$ ... $$`**：`/^\s*\$\$(.+?)\$\$\s*$/`（内部不再含 `$$`）→ 单行提取，绝不向后多吞行。
2. **多行 `$$` 块**：仅当某行是纯起始标记 `/^\s*\$\$\s*$/` 时，先向前探查（Lookahead）后续是否存在匹配的闭合行 `/^\s*\$\$\s*$/`（且跨度不超过 120 行、中间不跨越 `# ` 章节大标题）：
   - **只有找到闭合行时**才收集为 `blockMath` 并推进游标 `i`；
   - **若直到文件末尾都找不到闭合 `$$`**，绝不吞噬后续正文！仅将该孤立 `$$` 行忽略或按普通行处理，游标只加 1！
3. **单行 `\[ ... \]`**：仅当整行严格匹配 `/^\s*\\\[((?:(?!\\\]).)+)\\\]\s*$/`（即行首 `\[`、行尾 `\]`、**且中间不包含任何提前闭合的 `\]`**！这样像 `\[8 × 8\] · \[16 × 16\]` 这种含多个转义方括号的普通文本行会直接返回 `false`，绝不会被误认为公式！）。
4. **多行 `\[` 块**：仅当某行严格匹配纯起始 `/^\s*\\\[\s*$/`（`\[` 后无其他正文），且向前探查确认存在匹配的独立闭合行 `/^\s*\\\]\s*$/` 时才收集；找不到闭合行则**绝不吞噬文档**！

#### 4. 升级行内语法解析、`<br>` 换行、转义符还原、自适应表格与现代样式表
1. **支持 `<br>` 真换行与 Markdown 反斜杠反转义**：
   - 在行内解析中识别 `<br\s*\/?>`（不区分大小写），输出标准 Word 软回车 `<w:r><w:br/></w:r>`；
   - 对普通文本叶子节点执行反转义函数 `unescapeMd(str)`：`str.replace(/\\([\\`*_{}\[\]()#+\-.!|$~])/g, '$1')`，彻底消除正文中的 `\*\*`、`\[`、`\]`、`\$` 残留！
2. **支持复合/嵌套行内格式（粗体包裹公式或代码，如 `## **6.6 标题**`、`**$Y_H$ 输入**`）**：
   - 将 `inline(text, inheritedStyles)` 改造为支持递归 `inheritedStyles`（例如匹配到外层 `**...**` 时，递归调用 `inline(innerContent, styles.concat(['b']))`）！这样：
     - `## **6.6 Patch-Band Token**` 不会露出星号；
     - `**重点变量 $X_{GT}$ 与 `code`**` 中普通文字自动加粗，内嵌 `$X_{GT}$` 自动转为 `<m:oMath>`，内嵌 `` `code` `` 自动应用等宽字体底色！
   - 行内图片 `![alt](src)` 无论独立成行还是夹在句子中间（如 `文字![](data:...)文字`），都能在 `inline()` 中精准切分并替换为 `<w:r><w:drawing>...</w:drawing></w:r>`！
3. **支持水平分割线 `---` / `***`**：
   - 当行匹配 `/^\s*(?:---+|\*\*\*+|___+)\s*$/` 时，输出一条优雅的浅灰水平分割线段落（`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>`），不再印出 `"---"` 三个减号！
4. **自适应满宽表格（解决 `2400 dxa` 过窄与溢出页面问题）**：
   - A4 版芯总宽 `PAGE_CONTENT_DXA = 9026`（`11906 - 1440 * 2`）。
   - 根据表格最大列数 `colCount = Math.max(1, rows.reduce((m, r) => Math.max(m, r.length), 0))`，计算每列宽度（可按各列纯文本平均长度做温和权重分配，设置最小列宽 `Math.min(1400, Math.floor(9026 / colCount))` 并归一化使总和严格等于 `9026`）。
   - `<w:tblPr>` 配置：`<w:tblW w:w="9026" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>...(六边统一细灰线 CBD5E1)...</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>`。
   - **注意兼容 `bugfix10.test.cjs` 第 22 行**：每行标签保持无属性单行 `<w:tr>...</w:tr>`（内部首行可加 `<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>`，数据行加 `<w:trPr><w:cantSplit/></w:trPr>`，表头单元格用 `TableHeader` 样式 + `#F8FAFC` 浅底色）。
5. **美化 `stylesXml()` 排版（严禁出现 `outlineLvl` 字样！）**：
   - 默认正文字体设为英文 `Calibri` + 中文 `Microsoft YaHei`（微软雅黑），字号 `21`（`10.5pt` 五号标准学术公文字号），默认段后间距 `w:after="120"`、行距 `w:line="312" w:lineRule="auto"`（约 `1.3` 倍舒适行距）；
   - `Heading1`～`Heading6` 增加段前段后呼吸间距与深岩灰标题色 `#0F172A`（**再次强调：绝不写 `<w:outlineLvl>`，确保 `bugfix10.test.cjs` 第 49 行 100% 通过！**）；
   - `Quote` 样式增加左侧靛蓝竖线 `<w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="4F46E5"/></w:pBdr>` 与 `#F8FAFC` 浅灰底纹；
   - 代码块段落增加 `#F8FAFC` 底纹与细边框、小字号 `19`（`9.5pt` `Consolas`）。

#### 5. 在 `src/content/core.js` 中接入智能同步/异步 `.docx` 导出
修改 [core.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/core.js#L624-L635) 的 `btnDocx`：
- 若 `window.ChatSavorDocx` 存在：
  - 检查 `typeof window.ChatSavorDocx.needsAsyncMedia === 'function' && window.ChatSavorDocx.needsAsyncMedia(prepared.text) && typeof window.ChatSavorDocx.buildAsync === 'function'`：
    - 若为 **`false`**（无 SVG / WebP / 外链图片）：**保持 100% 同步调用** `var blob = window.ChatSavorDocx.build(prepared.text); saveBlob(blob, filename);`（完美通过 `bugfix09.test.cjs` 同步断言！）；
    - 若为 **`true`**（含 SVG 图表或外链图片）：禁用按钮并将 `.btn-label` 设为 `'正在生成 Word…'`，`copyStatus.textContent = '正在转换图表与公式并生成 Word 文档…'`，调用 `window.ChatSavorDocx.buildAsync(prepared.text)`，完成后调用 `saveBlob`、恢复按钮文案并在 `copyStatus` 显示 `'✅ 已导出 Word 文档（含高清图表与原生公式）'`！

---

### Task D-05：新增硬核端到端单元测试（严禁伪造正则测试）

**新建测试文件**：`chrome-extension/tests/docx-images-and-fixes.test.cjs`

必须在 JSDOM 真实运行环境中编写并通过以下 **6 项端到端回归测试**：

1. **`D1 normalizeSafeSvgDataUrl never emits duplicate style attributes on Recharts SVGs`**：
   - 构造带 `style="width: 100%; height: 100%; display: block;"` 的 Recharts `<svg>` 喂入 `ChatSavorMarkdown.extract`；
   - 解码产出的 `data:image/svg+xml;base64,...`，用 `new DOMParser().parseFromString(svg, 'image/svg+xml')` 严格解析，断言 `querySelector('parsererror') === null`（零 XML 属性重定义错误），且 `style` 属性只出现 1 次并同时包含 `display: block` 与 `color: #1f2937`！
2. **`D2 escaped brackets \\[8 × 8\\] and unclosed \\[ never swallow subsequent chapters into blockMath`**：
   - 构造复现本次事故的真实输入：包含第 6.5 节 `\[8 × 8\] · \*\*\[✓ 16 × 16\]\*\* · \[32 × 32\]`，后跟 `## **6.6 Patch-Band Token**`、表格 `| A | B |\n|---|---|\n| 1 | 2 |`、独立公式 `$$\alpha = 0.8$$` 以及末尾段落；
   - 调用 `ChatSavorDocx.markdownToDocumentXml(md)`：
     - 断言 XML 中包含 `<w:pStyle w:val="Heading2"/>`（`6.6` 标题未被吞噬！）、包含 `<w:tbl>`（后续表格未被吞噬！）、包含 `<m:oMathPara>`（后续公式正常编译！）；
     - 断言末尾段落后**绝不出现残留的 `$$`**，且正文中不残留 `\*\*` 或 `\[8` 反斜杠！
3. **`D3 every display equation <m:oMathPara> strictly wraps <m:oMath> and nary sum absorbs operand into <m:e>`**：
   - 输入含 `$$PSNR = 10\log_{10}\frac{MAX^2}{MSE}$$`、`$$SAM(x,\hat{x}) = \arccos\frac{x^T\hat{x}}{\|x\|\|\hat{x}\|}$$`、`$$\sum_i E_i^2$$` 的 Markdown（无行内公式干扰！）；
   - 解析生成的 `document.xml` 为 XML DOM：
     - 断言每一个 `<m:oMathPara>` 元素内部都**直接包含 `<m:oMath>` 子元素**（`para.getElementsByTagName('m:oMath').length >= 1`）；
     - 断言 `\hat{x}` 产出了 `<m:acc>`，且 `<m:nary>` 内部的 `<m:e>` 非空并包含 `E` 的上标下结构！
4. **`D4 build() and buildAsync() embed PNG and rasterized SVG images into word/media/ with valid rels and DrawingML`**：
   - 构造一张真实的 1×1 PNG `data:image/png;base64,...` 与一张 `viewBox="0 0 340 200"` 的 `data:image/svg+xml;base64,...`（在 JSDOM 中注入 Mock `Image` 与 `HTMLCanvasElement` 返回有效 PNG DataURL）；
   - 调用 `await ChatSavorDocx.buildAsync(md)`，解压或扫描返回的 `.docx` ZIP 字节：
     - 断言 ZIP 包内真实存在 `word/media/image1.png` 与 `word/media/image2.png` 且字节头为 PNG 签名 `0x89 0x50 0x4E 0x47`；
     - 断言 `word/_rels/document.xml.rels` 包含 `rIdImg1` 与 `rIdImg2`；
     - 断言 `word/document.xml` 包含 `<wp:inline` 与 `<a:blip r:embed="rIdImg1"/>`、`<a:blip r:embed="rIdImg2"/>`，且**全文绝不包含 `data:image/` 或 `PHN2Zy` 字符串**！
5. **`D5 table columns distribute across 9026 dxa, <br> emits <w:br/>, and --- emits horizontal border rule`**：
   - 测试 4 列表格总宽等于 `9026`（不再是 `4 × 2400 = 9600` 溢出），单元格内 `第一行<br>第二行` 转为 `<w:br/>` 且不含 `&lt;br&gt;`，`---` 转为 `<w:pBdr>` 且不含文本 `---`。
6. **`D6 ChatGPT normalizeDilComponents preserves grid SVGs, separates multi-line card divs with <br>, and skips all-empty table rows`**：
   - 构造含多层 `<div>` 文字卡片的 `[data-d-component="grid"]`、含纯图形 `<svg>` 的网格、以及仅有单行标签无数值的网格，运行 ChatGPT 适配器 `extractMarkdown`，验证文字不粘连、`<svg>` 转为 `![](data:image/svg+xml;base64,...)`、无全空 `|  |  |  |` 行。

---

## 四、 交付前全量验收命令清单

执行完成后，必须依次运行以下检查并确认 **0 失败**：

```bash
npm --prefix chrome-extension test
npm --prefix chrome-extension run check:version
```

自检核对项：
- [x] 全量测试（原有 201+ 项 + 新增 6 项 = **207+ 项单测**）100% PASS；
- [x] `bugfix09.test.cjs`（同步 `.docx` 点击）与 `bugfix10.test.cjs`（独立加载 `docx-builder.js` + `styles.xml` 无 `outlineLvl`）100% PASS；
- [x] `git diff chrome-extension/src/lib/katex.js` 为空。
