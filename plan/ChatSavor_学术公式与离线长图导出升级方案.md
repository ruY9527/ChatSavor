# ChatSavor 学术公式导出（Word OMML + Overleaf LaTeX）、离线图文归档与高清长图卡片详细实现规范（Execution Spec）

> **用途说明**：本文档面向自动化编程代理（DeepSeek Harness）及开发者，提供“学术与高质感导出升级”三大核心能力（共拆分为 **6 个顺序原子任务 `Task U-01` ~ `Task U-06`**）的**可执行级实现说明书**。  
> **前置条件提醒**：在执行本文档前，请确保已先完成 `plan/ChatSavor_PDF排版与ChatGPT图表交互修复方案.md`（若已完成则基于最新全绿测试基线继续；无论当前基线测试数为多少，启动前 `npm --prefix chrome-extension test` 必须 **0 fail**）。

---

## 0. 全局工程红线与防踩坑铁律（写任何一行代码前必读！）

1. **零构建 MV3 运行时约束**：
   - `chrome-extension/src/` 下所有脚本必须使用原生 IIFE `(function () { 'use strict'; ... })();` 并挂载至 `window.ChatSavor*`（后台与共享脚本兼容 `globalThis.ChatSavor*`）。
   - **严禁**使用 ESM `import` / `export`、TypeScript 语法或任何外网 CDN 请求（所有公式转换、ZIP 打包、LaTeX 编译、长图渲染必须 100% 离线本地完成）。
2. **`manifest.json` 脚本加载顺序铁律**：
   - 在 `chrome-extension/manifest.json` 的 `content_scripts[0].js` 中，新增库必须严格按以下先后顺序挂载（位于 `"src/lib/katex.js"` 之后、`"src/content/metadata.js"` 与 `"src/content/core.js"` 之前）：
     ```json
     "src/lib/katex.js",
     "src/lib/zip.js",
     "src/lib/omml.js",
     "src/lib/docx-builder.js",
     "src/content/markdown.js",
     "src/lib/latex-builder.js",
     "src/lib/card-image.js",
     "src/content/metadata.js",
     "src/content/core.js"
     ```
3. **保护既有独立单元测试的向后兼容契约（极易踩坑！）**：
   - **`tests/bugfix10.test.cjs` 单独加载 `docx-builder.js` 契约**：该测试仅单独 `eval('src/lib/docx-builder.js')`，**并未加载 `zip.js`、`katex.js` 或 `omml.js`**，且直接调用了 `ChatSavorDocx.markdownToDocumentXml(...)` 和 `ChatSavorDocx.stylesXml()`！因此：
     1. `docx-builder.js` 必须保留 `build`、`crc32`、`zip`、`markdownToDocumentXml`、`stylesXml` 五个公开方法；
     2. 当 `window.ChatSavorZip` 存在时复用 `ChatSavorZip.pack(...)`，不存在时回退使用文件内保留的轻量 `zip` 实现；
     3. 当 `window.ChatSavorOmml` 存在且 `window.katex` 可用时将 `$...$` / `$$...$$` 转为原生 `<m:oMath>` / `<m:oMathPara>`；当 `window.ChatSavorOmml` 未加载（如在 `bugfix10.test.cjs` 中）时，平滑回退输出普通文本 `<w:r><w:t>$...$</w:t></w:r>`，确保既有测试 **100% 零报错通过**！
   - **`tests/options.test.cjs` 契约**：修改 `options.html` 与 `options.js` 时，严禁删除或改名任何既有控件 ID（`frontmatter`, `cotMode`, `vault`, `vaultDir`, `theme`, `historyEnabled`, `pdfFooterMode`, `pdfFooterText`, `pdfWatermarkMode`, `pdfWatermarkText`, `save`, `historySearch`, `clearHistory`, `historyList`, `customRules`, `saveRules`, `exportRules`, `importRules`, `importFile`）。
4. **MV3 权限最小化原则**：
   - 在 `manifest.json` 中保持现有 `permissions: ["activeTab", "scripting", "storage"]` 不变；新增 `"optional_host_permissions": ["https://*/*", "http://*/*"]` 用于用户在导出离线外链图片时按需授权抓取第三方图床（不增加默认安装权限警告！）。
5. **测试真实性铁律**：
   - 所有新增单测必须在 JSDOM 中真实加载并执行目标脚本，验证实际生成的 XML 树、ZIP 二进制条目、LaTeX 源码、IndexedDB/消息流转和 XHTML 合法性，**严禁只用正则匹配源码文件字符串来伪造测试通过**！

---

## Task U-01：通用二进制 ZIP 打包器与后台跨源图片抓取基础设施

- **目标文件**：
  - 新建：`chrome-extension/src/lib/zip.js`
  - 修改：`chrome-extension/src/background.js`
  - 修改：`chrome-extension/manifest.json`（注册 `src/lib/zip.js` 并添加 `"optional_host_permissions": ["https://*/*", "http://*/*"]`）

### 详细实现步骤

#### 1. 实现 `src/lib/zip.js`（`globalThis.ChatSavorZip`）
支持将**字符串文本**和**二进制 `Uint8Array` / `ArrayBuffer`** 混合打包为标准 Store（无压缩）ZIP 二进制或 `Blob`：
- 暴露 API：
  - `crc32(bytes)`：`Uint8Array -> uint32`。
  - `utf8(str)`：字符串转 `Uint8Array`。
  - `packBytes(entries)`：接收数组 `[{ name: string, data: string | Uint8Array | ArrayBuffer }]`：
    - 若 `entry.data` 是 `string`，用 `utf8(entry.data)` 转为 `Uint8Array`；若为 `ArrayBuffer` 则 `new Uint8Array(entry.data)`；若已是 `Uint8Array` 直接使用。
    - 对 `name` 统一将反斜杠 `\` 规范化为 `/`，去除前导 `/`。
    - 在 Local File Header 与 Central Directory Header 的通用位标志（offset 6 / offset 8）设置 **`0x0800`（UTF-8 文件名编码标志位 Bit 11！）**——这一点极其关键，没有 `0x0800` 标志位时，Windows 资源管理器和 macOS 解压中文文件名（如 `2026-11-24_ChatGPT_图像融合.md`）会变成乱码！
    - 返回合并后的完整 `Uint8Array`。
  - `pack(entries, mimeType)`：调用 `packBytes(entries)` 并包装返回 `new Blob([bytes], { type: mimeType || 'application/zip' })`。

#### 2. 在 `src/background.js` 新增图片抓取消息通道 `CHATSAVOR_FETCH_IMAGE`
Content Script 在第三方网页中直接 `fetch` 图床 URL 会遇到 CORS 报错，统一由 `background.js` 代理抓取：
- 监听 `message && message.type === 'CHATSAVOR_FETCH_IMAGE'`（参数 `message.url`，返回 `true` 保持异步消息通道）：
  1. 校验 `url`：仅允许 `https:` 或 `http:` 协议（拒绝 `file:`, `chrome:`, `javascript:` 等）。
  2. 设置 `AbortController` 超时 `8000ms`，执行 `fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit', signal: controller.signal })`。
  3. 若 `!response.ok` 或读取字节超过 `15 * 1024 * 1024`（15MB 单图保护上限），返回 `{ ok: false, error: 'HTTP ' + response.status }`。
  4. 读取 `arrayBuffer`，取 `contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()`（必须以 `image/` 开头或根据文件魔数 `PNG/JPEG/GIF/WEBP/SVG` 推断，防止把 HTML 登录重定向页当成图片保存！）。
  5. 将字节编码为 `base64` 字符串返回：`sendResponse({ ok: true, contentType: contentType, base64: base64 })`（Chrome `sendMessage` JSON 序列化不支持裸 `Uint8Array`，传 `base64` 最稳定可靠）。
  6. 异常捕获返回 `{ ok: false, error: String(err.message || err) }`，绝不抛未捕获异常。

---

## Task U-02：Word 原生可编辑公式引擎（`src/lib/omml.js`）并接入 `docx-builder.js`

- **目标文件**：
  - 新建：`chrome-extension/src/lib/omml.js`
  - 修改：`chrome-extension/src/lib/docx-builder.js`
  - 修改：`chrome-extension/manifest.json`（在 `docx-builder.js` 前挂载 `"src/lib/omml.js"`）

### 详细实现步骤

#### 1. 实现 `src/lib/omml.js`（`window.ChatSavorOmml`）
利用已加载的 `window.katex` 将 LaTeX 转为 MathML，再将 MathML DOM 树递归编译为 Microsoft Word 原生 OMML XML（命名空间前缀 `m:`）：
- **核心入口函数**：
  - `mathmlToOmml(mathmlString, displayMode)`：接收 MathML XML/HTML 字符串，输出 `<m:oMath>...</m:oMath>`（当 `displayMode === true` 时外包 `<m:oMathPara><m:oMath>...</m:oMath></m:oMathPara>`）；解析失败返回 `null`。
  - `latexToOmml(latex, displayMode)`：
    - 若 `!window.katex || typeof window.katex.renderToString !== 'function'` 返回 `null`。
    - `try` 调用 `var mathml = window.katex.renderToString(latex, { displayMode: !!displayMode, output: 'mathml', throwOnError: true, trust: false, strict: 'ignore' });`。
    - 调用 `mathmlToOmml(mathml, displayMode)` 返回 OMML 字符串；任何异常捕获后返回 `null`（由调用方平滑回退纯文本）。
- **MathML → OMML 递归转换精确规则**：
  1. 用 `new DOMParser().parseFromString(mathmlString, 'text/html')` 定位 `<math>` 节点；若内部有 `<semantics>`，**只遍历 `<semantics>` 的第一个子元素**（通常是 `<mrow>`，**跳过后面的 `<annotation encoding="application/x-tex">` 源码注释节点**，否则会把原始 TeX 字符串重复拼在公式末尾！）。
  2. **XML 转义函数 `escXml(s)`**：转义 `&`, `<`, `>`, `"`。
  3. **文本叶子节点（`mi`, `mn`, `mo`, `mtext`, `ms`）**：
     - 读取 `txt = node.textContent || ''`；若为空返回 `''`。
     - 判断是否正体（Plain style）：当标签为 `mn`、`mo`、`mtext`，或 `node.getAttribute('mathvariant') === 'normal'`，或 `mi` 文本长度 `> 1`（如 `log`、`sin`、`cos`、`arccos`、`exp`、`max`、`min`、`lim`、`Softmax`、`Encoder`）时，添加 `<m:rPr><m:sty m:val="p"/></m:rPr>`；单字符变量（如 `x`, `α`, `θ`）输出 `<m:r><m:t>` + `escXml(txt)` + `</m:t></m:r>`（Word 默认数学斜体）。
  4. **容器与空白**：
     - `mrow`, `mstyle`, `mpadded`, `mphantom`：按序转换子节点拼接（注意在 `mrow` 循环中处理下面的大型运算符 `∑/∏/∫` 吸附右侧被积项逻辑，以及伸缩括号配对逻辑！）。
     - `mspace`：输出 `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t> </m:t></m:r>`。
  5. **分式 `mfrac`**：
     - 取前两个子元素 `num`, `den` → `<m:f><m:num>` + `conv(num)` + `</m:num><m:den>` + `conv(den)` + `</m:den></m:f>`。
  6. **上下标 `msup` / `msub` / `msubsup` / `munder` / `mover` / `munderover`**：
     - **大型运算符识别（`NARY_CHARS = /^[∑∏∫∬∭∮⋃⋂⋀⋁]$/`）**：
       - 若 `msub` / `msup` / `msubsup` / `munder` / `mover` / `munderover`（或单独的 `<mo>∑</mo>`）的底数文本匹配 `NARY_CHARS`：
       - 生成 `<m:nary><m:naryPr><m:chr m:val="{chr}"/><m:limLoc m:val="{undOvr 或 subSup}"/>` + (无下标时加 `<m:subHide m:val="1"/>`，无上标时加 `<m:supHide m:val="1"/>`) + `</m:naryPr><m:sub>{sub}</m:sub><m:sup>{sup}</m:sup><m:e>{integrand}</m:e></m:nary>`！其中在父 `mrow` 遍历时，把紧随该大型运算符之后的同级兄弟项收作 `{integrand}`（若已在末尾则填 `<m:r><m:t></m:t></m:r>` 占位，Word 要求 `<m:e>` 非空结构合法）。
     - **顶部重音与横线识别（`mover`）**：
       - 若上标文本是重音符（`^`, `ˆ`, `\u02C6`, `\u0302`, `~`, `˜`, `→`, `⇀`, `˙`, `¨`）：映射规范组合字符（如 `^`/`ˆ` → `&#x0302;`，`~`/`˜` → `&#x0303;`，`→` → `&#x20D7;`），输出 `<m:acc><m:accPr><m:chr m:val="{accChr}"/></m:accPr><m:e>` + `conv(base)` + `</m:e></m:acc>`！
       - 若上标是横线（`¯`, `‾`, `_`, `\u00AF`, `\u203E`）或节点为 `menclose`（top）：输出 `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>` + `conv(base)` + `</m:e></m:bar>`。
       - 其他普通 `mover`：输出 `<m:limUpp><m:e>` + `conv(base)` + `</m:e><m:lim>` + `conv(over)` + `</m:lim></m:limUpp>`。
     - **底部极限（`munder`）**：
       - 若底线符为下划线则 `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>...`，否则输出 `<m:limLow><m:e>` + `conv(base)` + `</m:e><m:lim>` + `conv(under)` + `</m:lim></m:limLow>`。
     - **普通上下标**：
       - `msup` → `<m:sSup><m:e>` + `conv(base)` + `</m:e><m:sup>` + `conv(sup)` + `</m:sup></m:sSup>`
       - `msub` → `<m:sSub><m:e>` + `conv(base)` + `</m:e><m:sub>` + `conv(sub)` + `</m:sub></m:sSub>`
       - `msubsup` / `munderover`（非大型运算符时） → `<m:sSubSup><m:e>` + `conv(base)` + `</m:e><m:sub>` + `conv(sub)` + `</m:sub><m:sup>` + `conv(sup)` + `</m:sup></m:sSubSup>`
  7. **根式 `msqrt` / `mroot`**：
     - `msqrt` → `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>` + 子节点转换拼接 + `</m:e></m:rad>`
     - `mroot`（子元素 `[base, index]`） → `<m:rad><m:deg>` + `conv(index)` + `</m:deg><m:e>` + `conv(base)` + `</m:e></m:rad>`
  8. **矩阵与多行对齐 `mtable` / `mtr` / `mtd`**：
     - `mtable` → `<m:m>` + 遍历 `mtr` 生成 `<m:mr>` + 遍历 `mtd` 生成 `<m:e>` + `convChildren(mtd)` + `</m:e>` + `</m:mr>` + `</m:m>`。
  9. **伸缩定界符（`mfenced` 或 `mrow` 首尾配对括号 `( ... )`, `[ ... ]`, `{ ... }`, `‖ ... ‖`, `| ... |`）**：
     - 当 `mrow` 首子元素为 `<mo>` 开括号（`(`, `[`, `{`, `‖`, `\u2016`）且末子元素为对应闭括号（`)`, `]`, `}`, `‖`, `\u2016`）且中间嵌套没有提前闭合该括号时，映射为 `<m:d><m:dPr><m:begChr m:val="{open}"/><m:endChr m:val="{close}"/></m:dPr><m:e>{inner}</m:e></m:d>`，让高分式/矩阵括号在 Word 中自动伸缩高度！

#### 2. 升级 `src/lib/docx-builder.js` 接入 `ChatSavorOmml` 与 `ChatSavorZip`
1. 在 `<w:document>` 根节点添加 `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"` 命名空间声明。
2. **块级公式解析**：在 `markdownToDocumentXml(markdown)` 的行循环中（代码块判断之后）：
   - 检测独立 `$$`（单行 `$$ ... $$` 或跨多行 `$$\n...\n$$`）以及独立 `\[ ... \]` 块级公式：
   - 提取内部 `latex`，若 `window.ChatSavorOmml && window.ChatSavorOmml.latexToOmml` 返回非空 `ommlPara`，直接拼入 `body += '<w:p>' + ommlPara + '</w:p>';`；若未加载 `ChatSavorOmml` 或返回 `null`，回退为居中普通文本段落。
3. **行内公式解析**：在 `inline(text)` 中增加对行内公式 `$...$`（非转义 `\$`，且首尾无多余空白，参考 `markdown.js` 的 `readMath` 规则）和 `\(...\)` 的识别：
   - 命中行内公式时，调用 `window.ChatSavorOmml && window.ChatSavorOmml.latexToOmml(latex, false)`：若返回 `<m:oMath>...</m:oMath>`，直接将其作为 `<w:p>` 的直接子节点插入（与两侧 `<w:r>` 并列，**注意 `<m:oMath>` 不能套在 `<w:r>` 里面，它本身就是 `<w:p>` 的合法子元素！**）；若不可用则回退为普通 `<w:r><w:t>$...$</w:t></w:r>`。
4. ZIP 打包优先调用 `window.ChatSavorZip ? window.ChatSavorZip.pack(files, DOCX_MIME) : zip(files)`。

---

## Task U-03：Overleaf 学术级 LaTeX（`.tex`）源码导出器（`src/lib/latex-builder.js`）

- **目标文件**：
  - 新建：`chrome-extension/src/lib/latex-builder.js`
  - 修改：`chrome-extension/src/content/core.js`（预览弹窗底部新增 `.tex` 导出按钮）
  - 修改：`chrome-extension/manifest.json`（挂载 `"src/lib/latex-builder.js"`）

### 详细实现步骤
1. **暴露 `window.ChatSavorLatex = { build: build, escapeText: escapeText }`**。
2. **普通文本 LaTeX 安全转义函数 `escapeText(text)`（严禁用于公式和代码块内部！）**：
   - 单遍扫描替换以下 10 个 LaTeX 特殊字符（**绝不可链式 `.replace` 导致把 `\textbackslash{}` 里的 `{` `}` 再次转义！必须使用单次正则 `replace(/[\\{}&%$#_~^]/g, mapFn)`**）：
     - `\` → `\textbackslash{}`
     - `{` → `\{`
     - `}` → `\}`
     - `&` → `\&`
     - `%` → `\%`
     - `$` → `\$`
     - `#` → `\#`
     - `_` → `\_`
     - `~` → `\textasciitilde{}`
     - `^` → `\textasciicircum{}`
3. **基于 `ChatSavorMarkdown.getMarked().lexer(markdown)` AST Token 树编译正文**（无 `marked` 时提供轻量行级回退）：
   - `heading`：`depth === 1` → `\section{...}`，`2` → `\subsection{...}`，`3` → `\subsubsection{...}`，`4` → `\paragraph{...}`，`>=5` → `\subparagraph{...}`。
   - `paragraph`：递归编译 `tokens`（`strong` → `\textbf{...}`，`em` → `\textit{...}`，`del` → `\texttt{...}` 或引入 `ulem` `\sout{...}`，`codespan` → `\texttt{` + `escapeText(raw)` + `}`，`link` → `\href{url}{text}`，`image` → 若有 `options.assetMap[href]` 则输出 `\begin{figure}[htbp]\centering\includegraphics[width=0.82\linewidth]{` + 本地相对路径 + `}\end{figure}`，若为普通远程 URL 则输出注释 + `\url{...}` 提示，避免 Overleaf 因无法联网拉取远程 URL 而编译报错！`inlineMath` → `$` + `token.latex` + `$`）。
   - `blockMath`：若 `token.latex` 自身已以 `\begin{equation` / `\begin{align` / `\begin{gather` 开头，原样输出；否则包裹为 `\begin{equation*}\n` + `token.latex` + `\n\end{equation*}`（需 `amsmath` 宏包，已在导言区加载）。
   - `code`：使用 `lstlisting` 环境输出，注意若代码文本内含 `\end{lstlisting}` 则退回 `verbatim`；语言参数做安全白名单映射（`python -> Python`, `js/javascript/ts -> Java`, `c/cpp -> C++`, `bash/sh -> bash`，其余不传 `language=` 以免 `listings` 报未知语言错；且因为 `listings` 默认不支持中文注释，导言区配置 `\lstset{extendedchars=false, escapeinside=``, basicstyle=\ttfamily\small, breaklines=true, columns=flexible}` 或对含中文代码块改用 `verbatim` 环境保证 XeLaTeX 100% 零报错编译！**强烈推荐：若代码块含非 ASCII 中文字符，自动使用 `\begin{verbatim}...\end{verbatim}` 或 `fancyvrb`，确保 Overleaf XeLaTeX 一次编译 0 error！**）。
   - `list`：有序列表 `\begin{enumerate} ... \item ... \end{enumerate}`，无序列表 `\begin{itemize} ... \item ... \end{itemize}`（支持嵌套列表与任务复选框 `[$\boxtimes$]` / `[$\square$]`）。
   - `blockquote`：`\begin{quote}\n...\n\end{quote}`。
   - `table`（**跨页学术三线表**）：
     - 列数 `cols = token.header.length`，每列列宽设为 `p{\dimexpr \linewidth/` + cols + ` - 2\tabcolsep \relax}`，使用 `\begin{longtable}{...}`：
       ```latex
       \begin{longtable}{...}
       \toprule
       \textbf{表头1} & \textbf{表头2} \\
       \midrule
       \endhead
       单元格1 & 单元格2 \\
       \bottomrule
       \end{longtable}
       ```
     - 单元格内支持行内公式 `$...$` 与加粗/代码！
4. **完整 `.tex` 文档封装**：
   - 顶部注明 `% !TEX program = xelatex`（Overleaf 识别该魔法注释会自动切换 XeLaTeX 编译器！）。
   - 包含完整导言区（`ctexart`, `amsmath,amssymb,amsfonts,mathtools`, `booktabs,longtable,array`, `graphicx`, `listings,xcolor`, `hyperref`, `geometry`）及 `\title{...}`、`\date{...}`、`\begin{document}`、`\maketitle`、正文、`\end{document}`。
5. **在 `core.js` 预览弹窗底部添加 `.tex` 按钮**：
   - 使用 `exportPlain(markdown, 'tex')` 生成智能文件名 `<YYYY-MM-DD>_<Platform>_<Title>.tex`，调用 `ChatSavorLatex.build(markdown, pageMeta)` 下载 `application/x-tex` 文件并记录历史。

---

## Task U-04：离线图文归档包（`.zip`）与本地 Obsidian 库目录直写（突破 30,000 字限制）

- **目标文件**：
  - 新建：`chrome-extension/src/content/assets-packager.js`（注册在 `manifest.json` 的 `core.js` 之前）
  - 新建：`chrome-extension/src/export/writer.html` & `chrome-extension/src/export/writer.js`（本地目录授权与落盘桥接页）
  - 修改：`chrome-extension/src/background.js`（处理静默写盘与唤起 `writer.html`）
  - 修改：`chrome-extension/src/options/options.html` & `chrome-extension/src/options/options.js`（绑定本地目录状态展示与管理）
  - 修改：`chrome-extension/src/content/core.js`（预览弹窗新增 `.zip (含图)` 与 `保存到本地库` 按钮）

### 详细实现步骤

#### 1. 图片收集、拉取与路径重写模块 `src/content/assets-packager.js`（`window.ChatSavorAssets`）
- **`collectAndFetchAssets(markdown, options)`**：返回 `Promise<{ markdown, assets: [{ name, path, bytes: Uint8Array, mimeType, originalUrl }], stats: { total, fetched, failed } }>`：
  1. 扫描 `markdown` 中所有 Markdown 图片语法 `![alt](url)`（兼容括号内带空格或 `<url>` 的写法）以及 HTML `<img src="...">`：
  2. 对每个唯一图片 `url`（按出现顺序编号 `fig_01`, `fig_02`, ...）：
     - **情况 A（`data:image/...` 内联图片，含 `data:image/svg+xml;base64,...` 和位图）**：
       - 本地直接解析 MIME 与解码字节为 `Uint8Array`（零网络请求！），根据 MIME 确定扩展名（`image/svg+xml -> .svg`, `image/png -> .png`, `image/jpeg -> .jpg`, `image/webp -> .webp`, `image/gif -> .gif`）。
     - **情况 B（`https?://` 远程图片）**：
       - 调用 `chrome.runtime.sendMessage({ type: 'CHATSAVOR_FETCH_IMAGE', url: url })` 请求后台抓取。
       - 若成功，将返回的 `base64` 解码为 `Uint8Array`，按 `contentType` 决定扩展名。
       - 若失败（CORS/404/超时/测试环境无 runtime），`stats.failed++`，**保留原始远程 `url` 不替换**，绝不抛错中断！
     - 抓取成功时：记录 `{ name: 'fig_01.png', path: 'assets/fig_01.png', bytes: uint8, mimeType, originalUrl: url }`，并将 `markdown` 中该 `url` 替换为 `./assets/fig_01.png`！
- **`buildMarkdownZip(markdown, pageMeta, includeFrontmatter)`**：
  1. 调用 `collectAndFetchAssets(markdown)`。
  2. 若 `includeFrontmatter` 为真，调用 `ChatSavorMeta.withFrontmatter(rewrittenMd, pageMeta, true)`。
  3. 组装条目：`[{ name: baseFilename + '.md', data: finalMd }].concat(assets.map(a => ({ name: a.path, data: a.bytes })))`。
  4. 调用 `ChatSavorZip.pack(entries, 'application/zip')` 返回 `{ blob, filename: baseFilename + '.zip', stats }`。
- **`inlineAllImagesForHtml(html)`**（供 Task U-05 长图渲染器复用！）：
  - 查找 HTML 片段内所有 `<img src="https?://...">`，通过 `CHATSAVOR_FETCH_IMAGE` 抓取后将其 `src` 替换为 `data:{contentType};base64,{base64}`，解决 SVG `<foreignObject>` 屏蔽外链图片的问题！

#### 2. 跨全平台共享的本地目录句柄架构（IndexedDB + `background.js` + `writer.html`）
> **防踩坑说明**：Chrome MV3 的 Service Worker 没有窗口上下文，不能调用 `showDirectoryPicker()` 或 `requestPermission()`；但如果用户在 `chrome-extension://` 页面（`options.html` 或 `writer.html`）绑定过一次 `FileSystemDirectoryHandle` 并存入 `chrome-extension://` 源的 IndexedDB，同一浏览器会话下 `background.js` 读取该句柄时 `queryPermission({ mode: 'readwrite' }) === 'granted'`，**可以直接在后台静默写入硬盘**！仅在首次未绑定或重启浏览器后权限变为 `'prompt'` 时，才自动打开 `writer.html` 让用户点一次确认按钮完成授权并写盘。

1. **共享 IndexedDB 读写逻辑**（封装成小工具函数或放在 `src/lib/fs-vault.js` 并在 `options.html`、`writer.html`、`background.js` 引用）：
   - 数据库名 `'chatsavor_fs'`，对象仓库 `'handles'`，主键 `'vaultRoot'`。
   - `getDirectoryHandle()` / `saveDirectoryHandle(handle)` / `clearDirectoryHandle()`。
   - `writeBundleToDirectory(rootHandle, subDir, mdFilename, mdContent, assets)`：
     - 若 `subDir` 非空（如 `'Notes/AI'`），按 `'/'` 切分逐级 `await dir.getDirectoryHandle(seg, { create: true })`（过滤 `'..'` 防止路径穿越！）。
     - 若 `assets && assets.length > 0`，创建 `assetsDir = await targetDir.getDirectoryHandle('assets', { create: true })`；注意为避免不同笔记的 `fig_01.png` 在同一 `assets/` 文件夹内重名覆盖，落盘本地目录时将资源名加上笔记文件名前缀 `<noteSlug>_fig_01.png` 并同步替换 Markdown 内的 `./assets/<noteSlug>_fig_01.png`！
     - 使用 `fileHandle = await dir.getFileHandle(name, { create: true })` → `writable = await fileHandle.createWritable()` → `await writable.write(data)` → `await writable.close()` 写入全部图片与 `.md` 文件。
2. **`background.js` 处理 `CHATSAVOR_SAVE_TO_VAULT` 消息**：
   - 接收 `{ subDir, filename, markdown, assets }`（其中 `assets` 中的字节以 `base64` 传输）。
   - 先尝试从 IndexedDB 读取 `vaultRoot` 句柄：
     - 若句柄存在且 `await handle.queryPermission({ mode: 'readwrite' }) === 'granted'`：直接在后台调用 `writeBundleToDirectory(...)` 静默落盘，返回 `{ ok: true, mode: 'silent', filename }`！
     - 若句柄不存在，或权限为 `'prompt'` / `'denied'`：将 payload 存入 `chrome.storage.session`（key 为 `'vault_' + token`），打开 `chrome.tabs.create({ url: chrome.runtime.getURL('src/export/writer.html?id=' + token) })`，返回 `{ ok: true, mode: 'prompt', token }`。
3. **`src/export/writer.html` & `writer.js`**：
   - 读取 `?id=vault_...` 对应的 payload（读完后在成功写盘时 `chrome.storage.session.remove(id)`）。
   - 若 IndexedDB 中已有句柄（状态为 `'prompt'`），显示提示与主按钮 **`[🔓 授权并写入本地文件夹（{handle.name}）]`**（点击时调用 `handle.requestPermission({ mode: 'readwrite' })` 后立即写盘）；同时提供 **`[📁 更换文件夹]`**。
   - 若尚未绑定过任何文件夹，主按钮显示 **`[📁 选择本地 Obsidian 库 / 笔记文件夹并保存]`**（点击调用 `window.showDirectoryPicker({ mode: 'readwrite' })`，存入 IndexedDB 并立即写入本次 `.md` + `assets/`）。
   - 写入成功后显示绿色提示 `✅ 已保存：{subDir}/{filename}（含 N 张离线图片），后续导出将自动静默保存！`。
4. **`options.html` & `options.js` 集成**：
   - 在“全局导出偏好”的 Obsidian 区域增加一行：`本地库直写文件夹：<span id="boundFolderStatus">未绑定</span> <button type="button" id="bindFolder">选择本地文件夹</button> <button type="button" id="unbindFolder" class="secondary">解除绑定</button>`（不改变任何原有控件 ID）。
5. **`core.js` 预览弹窗集成**：
   - 新增 **`.zip (离线含图)`** 按钮：打包下载 `.md + assets/*` 压缩包，状态栏显示图片打包统计。
   - 新增 **`保存到本地库`** 按钮：收集离线图片 + 按勾选状态拼装 Frontmatter + 读取 `savedVaultDir()`，发送 `CHATSAVOR_SAVE_TO_VAULT`；若返回 `mode === 'silent'`，状态栏直接提示 `✅ 已静默保存到本地库（含 N 张图片）`！

---

## Task U-05：社交分享高清长图卡片引擎（`src/lib/card-image.js`）

- **目标文件**：
  - 新建：`chrome-extension/src/lib/card-image.js`
  - 修改：`chrome-extension/src/content/core.js`（预览弹窗新增“长图卡片”Tab 或底部按钮组：主题选择 + `复制长图` + `下载长图`）
  - 修改：`chrome-extension/manifest.json`（挂载 `"src/lib/card-image.js"`）

### 详细实现步骤

#### 1. 架构分层设计（兼顾真机高清渲染与 JSDOM 100% 可测试性）
在 `window.ChatSavorCardImage` 上暴露以下清晰分层的方法：

1. **内置 3 套高质感主题配置 `THEMES`**：
   - `light`（**极简白**）：画布外衬底 `#f1f5f9`，卡片背景 `#ffffff`，正文 `#1e293b`，次要文字 `#64748b`，代码块底 `#f8fafc`，边框 `#e2e8f0`，强调色 `#667eea`。
   - `dark`（**深邃夜**）：画布外衬底 `#020617`，卡片背景 `#0f172a`，正文 `#e2e8f0`，次要文字 `#94a3b8`，代码块底 `#1e293b`，边框 `#334155`，强调色 `#818cf8`。
   - `paper`（**学术暖纸**）：画布外衬底 `#efeae1`，卡片背景 `#fbf8f1`，正文 `#292524`，次要文字 `#78716c`，代码块底 `#f3eee3`，边框 `#e5dec9`，强调色 `#9a3412`（标题使用衬线字体 `"Georgia", "Source Han Serif SC", "Songti SC", serif`）。

2. **`computeSlices(blocks, maxSliceHeight)`（纯算法，智能防截断分页切片）**：
   - 输入：`blocks = [{ index, top, bottom, height }]`，`maxSliceHeight = 7200`（CSS px；2x Retina 下为 `14,400px`，安全低于 Chromium Canvas `16,384px` 硬上限！）。
   - 算法：
     - 若总高度 `<= maxSliceHeight`，返回单一切片 `[[0, ..., blocks.length - 1]]`（不拆分）。
     - 若超长，贪心累加相邻块高度直到下一个块会使当前切片高度超过 `maxSliceHeight`，在**块与块之间的间隙**断开开启下一张卡片（单个超大块本身超过 `maxSliceHeight` 时单独占一张切片并降采样 `scale = 1` 保护），**绝不把一行文字、一个公式或一张图片从中间拦腰切断**！

3. **`serializeStrictXhtml(element)`（防 `<foreignObject>` 空白图核心保障！）**：
   - HTML 中的 `<br>`、`<hr>`、`<img ...>`、`<input ...>` 在 XML 解析器下若未自闭合会导致整张 `<svg><foreignObject>` 渲染全白！
   - 实现方式：创建 XML 文档 `var xmlDoc = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'html', null);`，递归将 `element` 克隆转换进 `http://www.w3.org/1999/xhtml` 命名空间（过滤非法 XML 控制字符 `[\x00-\x08\x0B\x0C\x0E-\x1F]`，对 MathML `<math>` 子树保持 `'http://www.w3.org/1998/Math/MathML'` 命名空间，对 SVG 子树保持 `'http://www.w3.org/2000/svg'` 命名空间！），然后调用 **`new XMLSerializer().serializeToString(xhtmlNode)`**。
   - 这样生成的 XHTML 字符串 **100% 通过严格 XML 解析器（`DOMParser('application/xhtml+xml')` 零 `parsererror`）**！

4. **`buildCardSlicesDom(sanitizedBodyHtml, pageMeta, options)`**：
   - `options`: `{ theme: 'light' | 'dark' | 'paper', width: 760, maxSliceHeight: 7200, watermarkText: '' }`。
   - 先创建一个离屏测量容器（`position: fixed; left: -99999px; top: 0; width: 760px; visibility: hidden; pointer-events: none;`，挂载后测量完立即 `remove()`），填入 `sanitizedBodyHtml`，读取每个顶层子元素的 `offsetTop` 与 `offsetHeight`（在 JSDOM 中若 `offsetHeight === 0`，按文本行数 × 28px + 图片 240px 估算高度，保证单测也可精准测试分片逻辑！）。
   - 调用 `computeSlices` 得到分片列表。
   - 为每个分片构建独立的卡片 DOM（含顶部平台徽标 + 文档标题、当前分片正文克隆节点、底部导出时间 + `ChatSavor` 署名 + 多片时的 `1 / N` 页码角标，以及完整内联 CSS 样式表），调用 `serializeStrictXhtml` 生成每张卡片的 `{ width, height, xhtml, svgDataUrl }`。

5. **`renderToBlobs(markdown, pageMeta, options)`**：
   - 第 1 步：调用 `ChatSavorMarkdown.render(markdown)` 得到安全净化后的 HTML。
   - 第 2 步：若 `window.ChatSavorAssets && window.ChatSavorAssets.inlineAllImagesForHtml` 存在，将外链 `<img>` 转为内联 Base64 Data URI（确保 `<foreignObject>` 中图片 100% 渲染且不触发 Tainted Canvas `SecurityError`）。
   - 第 3 步：调用 `buildCardSlicesDom(...)` 生成切片列表。
   - 第 4 步：对每个切片通过 `new Image()` 加载 `svgDataUrl`，按 `scale = 2`（Retina 1520px 高清宽度）绘制到 `<canvas>`，调用 `canvas.toBlob(resolve, 'image/png')` 生成 PNG `Blob`。
   - 返回 `{ blobs: [Blob, ...], sliced: blobs.length > 1, count: blobs.length }`。

6. **预览弹窗 UI 集成（`core.js`）**：
   - 在预览弹窗中提供卡片主题选择下拉框 `<select class="card-theme-select">`（`极简白` / `深邃夜` / `学术暖纸`）及两个按钮：
     - **`复制长图`**：生成 PNG 后，调用 `navigator.clipboard.write([new ClipboardItem({ 'image/png': blobs[0] })])`（若为超长多图切片，复制第 1 张并在 `copyStatus` 友好提示 `已复制第 1/N 张高清卡片到剪贴板，完整全部卡片请点击“下载长图”`）。
     - **`下载长图`**：单张时直接下载 `<智能文件名>.png`；多张切片（`blobs.length > 1`）时调用 `ChatSavorZip.pack` 将 `card_01.png`, `card_02.png`... 打包为 `<智能文件名>_cards.zip` 下载！

---

## Task U-06：全链路真行为回归测试矩阵

- **目标文件**（新建）：
  - `chrome-extension/tests/zip-and-assets.test.cjs`
  - `chrome-extension/tests/omml-and-latex.test.cjs`
  - `chrome-extension/tests/vault-writer.test.cjs`
  - `chrome-extension/tests/card-image.test.cjs`

### 必测真行为断言清单

1. **`zip-and-assets.test.cjs`**：
   - `ChatSavorZip.packBytes` 混合打包中文文件名文本（`笔记_测试.md`）与二进制 `Uint8Array`（PNG 魔数 `\x89PNG`）：验证 PK 签名、UTF-8 标志位 `0x0800` 已置位、CRC32 准确、原始二进制字节分毫不差。
   - `ChatSavorAssets.buildMarkdownZip`：输入含 1 张 `data:image/svg+xml;base64,...`、1 张通过 mock `CHATSAVOR_FETCH_IMAGE` 返回的远程 PNG、以及 1 张抓取失败的 404 图片：断言前两张被重写为 `./assets/fig_01.svg` 和 `./assets/fig_02.png` 并打入 ZIP，失败的第 3 张保留原远程 URL 且不抛错（`stats.fetched === 2, stats.failed === 1`）。
2. **`omml-and-latex.test.cjs`**：
   - **Word OMML 真转换验证**：在加载了 `katex.js` + `omml.js` + `docx-builder.js` 的 JSDOM 中，输入包含行内公式 `$E = mc^2$`、分式与根式 `$$\text{Attention}(Q,K,V) = \text{Softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$`、求和 `$$\sum_{i=1}^{N} E_i^2$$`、帽子重音 `$\hat{X}_t$` 以及矩阵的 Markdown：
     - 断言 `markdownToDocumentXml` 输出包含 `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`、`<m:oMathPara>`、`<m:oMath>`、`<m:f>`（分式）、`<m:rad>`（根号）、`<m:sSup>` / `<m:sSub>`、`<m:nary>`（求和）、`<m:acc>`（`\hat{X}`），且**不包含** `<annotation` 残留文本；
     - 用 `DOMParser`（`'application/xml'`）解析整份生成的 `word/document.xml`，断言 **`querySelector('parsererror') === null`（100% 合法 XML，Word 打开绝不报文件损坏！）**！
   - **Overleaf `.tex` 导出验证**：输入包含中文多级标题、特殊字符 `% & $ # _ { } ~ ^ \`、行内/块级公式、4 列 Markdown 表格、含中文注释代码块的文档：
     - 断言生成 `% !TEX program = xelatex` 与 `\documentclass[11pt,a4paper]{ctexart}`；
     - 断言普通文本中的 `% & _ #` 已安全转义，而公式 `$D_{KL}(P\|Q) = \sum_i P_i \log \frac{P_i}{Q_i}$` 内部 `_` 与 `\` **未被二次破坏转义**；
     - 断言表格生成 `\begin{longtable}` + `\toprule` / `\midrule` / `\bottomrule`。
3. **`vault-writer.test.cjs`**：
   - 模拟内存 `FileSystemDirectoryHandle`（实现 `queryPermission`、`requestPermission`、`getDirectoryHandle`、`getFileHandle`、`createWritable`）：
     - 验证 `writeBundleToDirectory` 正确按 `vaultDir = 'Notes/AI'` 逐级创建目录、写入 `<filename>.md` 与 `assets/<slug>_fig_01.png`，且过滤 `..` 非法路径段；
     - 验证 `background.js` 在权限为 `'granted'` 时走静默写盘 `mode: 'silent'`，在未绑定或权限为 `'prompt'` 时存入 `storage.session` 并打开 `writer.html?id=...`。
4. **`card-image.test.cjs`**：
   - 验证 `light`、`dark`、`paper` 三套主题各自生成正确的背景/正文配色；
   - 输入包含 `<br>`、`<hr>`、`<img src="data:image/png;base64,AAAA">`、`<input type="checkbox" checked disabled>` 以及 KaTeX MathML 公式的复杂 HTML，调用 `buildCardSlicesDom`，对生成的每片 `xhtml` 用 **`new DOMParser().parseFromString(slice.xhtml, 'application/xhtml+xml')` 严格 XML 解析，断言 `parsererror === null`**（确保在真实浏览器 `<foreignObject>` 中绝不会因未闭合标签变空白图！）；
   - 输入总高度超过 `maxSliceHeight` 的多段落内容，断言 `computeSlices` 自动切分为多张卡片且不在单个块内部截断，点击“下载长图”自动打包为 `_cards.zip`。

---

## 执行进度追踪 Checklist

- [x] **Task U-01** `src/lib/zip.js`（二进制 + UTF-8 文件名标志位 `0x0800`）与 `background.js` 跨源图片抓取 `CHATSAVOR_FETCH_IMAGE`
- [x] **Task U-02** `src/lib/omml.js`（LaTeX → KaTeX MathML → Word 原生 `<m:oMath>`）并无损接入 `docx-builder.js`（保持独立 eval 向后兼容）
- [x] **Task U-03** `src/lib/latex-builder.js`（Overleaf XeLaTeX `ctexart` + `longtable` 三线表导出）并接入预览弹窗 `.tex` 按钮
- [x] **Task U-04** `src/content/assets-packager.js` + IndexedDB 目录句柄 + `writer.html/js`（`.zip` 离线含图包 + 本地 Obsidian 库一键直写）
- [x] **Task U-05** `src/lib/card-image.js`（3 套主题 + 严格 XHTML 序列化 + 智能防截断多图切片 + 剪贴板复制/下载）
- [x] **Task U-06** 4 个真行为回归测试文件全部编写并通过
- [x] 运行 `npm --prefix chrome-extension test` 全量 0 fail, 0 skipped，且 `npm --prefix chrome-extension run check:version` 通过、`git status` 无临时垃圾脚本
