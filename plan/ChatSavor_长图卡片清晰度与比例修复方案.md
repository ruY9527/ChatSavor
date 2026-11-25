# ChatSavor 长图卡片变形模糊与离线导出配套缺陷修复方案（DeepSeek Harness 专用执行规范）

> **文档定位**：本文件是面向自动化编码代理（DeepSeek Harness）的**像素级根因诊断与精确修复规范**。用于彻底解决当前“复制长图 / 下载长图”导出的 PNG 出现**严重纵向拉伸/横向挤压变形、内容在 600px 处被截断、文字与公式模糊、外框背景透明/右侧留白裁切**等核心缺陷，并一并修复审查发现的本地库路径 `././assets/` 拼接与空图片静默成功等配套隐患。
>
> **工程红线（执行全程严禁违反）**：
> 1. **零构建（Zero-Build）MV3 架构**：所有脚本保持原生 ES5/ES6 IIFE + `'use strict'`，禁止引入 Webpack/Vite/Rollup 或任何外部 CDN / npm 运行时依赖。
> 2. **零回归**：当前全部 **189 项现有单测**（含 `tests/bugfix*.test.cjs`、`tests/regressions.test.cjs` 中 KaTeX quirks-mode 补丁检查、`docx-builder.js` 独立加载契约等）必须 100% 继续通过；严禁重新运行未打补丁的 `vendor:math` 覆盖 `src/lib/katex.js`。
> 3. **严禁伪造测试**：新增单测必须在 JSDOM + 真实模块执行环境下校验真实 SVG 属性、宽高比数学不变量、DOM 序列化结果与 Canvas 绘制参数，严禁用源码字符串正则匹配充当测试。

---

## 一、 故障现象与数学级根因诊断（为什么生成的长图严重变形且看不清）

对用户实测导出的两张 ChatGPT 流程图/热力图长图 PNG 进行像素级逆向与 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js) 逐行审查后，确认这是由 **6 个叠加缺陷**共同导致的渲染事故：

### 根因 1（致命主因）：`<svg>` 高度被硬编码写死为 `height="600"`，随后被 `drawImage` 强行拉伸 7～13 倍！
查看 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L164-L169) 与 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L190-L196)：
```js
// 现存错误代码（第 165 行）：
'<svg xmlns="' + SVG_NS + '" width="' + (width + 64) + '" height="600"><foreignObject width="100%" height="100%">' + xhtml + '</foreignObject></svg>'

// 现存错误代码（第 192-195 行）：
canvas.width = slice.width * scale;                  // 760 * 2 = 1520
canvas.height = Math.min(slice.height, 16000) * scale; // 例如 4252 * 2 = 8504 或 7411 * 2 = 14822
ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
```
**发生了什么**：
1. `<svg>` 的像素尺寸被写死成了 **`824 × 600`**（`width + 64 = 824`，`height = 600`）！
2. `<foreignObject width="100%" height="100%">` 导致每张分片卡片**只有顶部前 `600px` 被渲染出来**，`y > 600px` 的正文、表格、公式**全部在 SVG 视口处被一刀截断丢失**（图 1 在“第三阶段”方框中部 `y=600px` 截断；图 2 在 3×3 热力图底部 `y=600px` 截断）。
3. 紧接着 `ctx.drawImage(img, 0, 0, 1520, 14822)` 把这张仅有 **`824 × 600`** 的位图强行拉扯铺满 **`1520 × 8504` / `1520 × 14822`** 的画布：
   - 横向从 `824` 挤压到 `760`（`0.92×`）；
   - 纵向从 `600` 暴拉到 `4252`～`7411`（**纵向拉伸 `7.1×`～`12.3×`**，纵横畸变比高达 **`7.7×`～`13.4×`**）！
   - 同时因为 `<svg>` 缺少 `viewBox`，Blink 先按 `824 × 600` 低清光栅化再被 Canvas 双线性插值放大十余倍，造成**极端纵向拉丝变形 + 严重失真模糊**。

### 根因 2：序列化后的 XHTML 根本不存在 `<body>` 标签，导致外边距、画布底色与正文字体全部失效
查看 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L103-L104) 与 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L159-L163)：
- `cardCss` 把外边距 `padding: 32px`、外框背景色 `background: theme.canvas` 以及全局正文字体 `font-family: theme.font` 全写在了 `body { ... }` 选择器上；
- 但 `holder` 是一个 `<div>`，经 `serializeStrictXhtml(holder)` 输出的结构是 `<html xmlns="http://www.w3.org/1999/xhtml"><div><style>...</style><div class="card">...</div></div></html>`——**整棵树里根本没有 `<body>` 元素**！
- 后果：
  1. 外圈 `32px` 留白失效，`.card` 直接贴死左上角 `(0, 0)`，右侧多出 `64px` 透明空白条；
  2. 外圈 `theme.canvas` 底色完全未绘制（变成 PNG 透明通道）；
  3. 除 `h1` 外的正文、列表、二级标题全部丢失 `theme.font` 字体声明，回退为系统默认宋体/衬线体。

### 根因 3：离屏测高严重失准（换行文本节点每个虚增 `40px` + 未隔离宿主样式 + 未等待图片解码）
查看 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L90-L98) 与 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L126-L136)：
1. `Array.from(measure.childNodes)` 遍历了 HTML 标签之间的所有 `"\n"` 空白文本节点（`nodeType === 3`）。文本节点的 `el.offsetHeight` 为 `undefined`，进入 `estimateHeight` 后 `lines = 1`，**每个 `"\n"` 空文本节点被凭空算作 `40px` 高度**！一篇含 60 个段落的回复会虚增 `2400px` 幽灵高度！
2. `measure` 直接挂在宿主网页 `document.body` 下，既没有 Shadow DOM 隔离宿主 CSS，也没有注入 `cardCss`，且宽度设成了 `760px` 而非 `.card` 扣除左右内边距后的真实内容宽度（`760 - 40*2 - 2 = 678px`）。
3. 没有对最终拼装好的单张分片容器直接读取真实渲染高度 `getBoundingClientRect().height`，而是用 `+ 220` 魔法常数拍脑袋估算。
4. ChatGPT 的 `DilRenderer` 图表导出为 `<img src="data:image/svg+xml;base64,...">`，其内部 `<svg>` 只有 `viewBox="0 0 W H"` 和 `width="100%"`，缺少数值型 `width`/`height` 属性；且测高在 `innerHTML` 赋值后同步执行，未等待 `img.decode()`，导致含图段落测高失真。

### 根因 4：单张分片上限 `7200px`（`2×` 下高达 `14400px`）过高，超出常规看图器舒适视口与 GPU 纹理分块阈值
- 当单张分片逻辑高度达到 `7200px`、`2×` 物理像素达到 `14400px`（长宽比接近 `1 : 9`）时：
  1. 微信、Windows 照片查看器、macOS 预览按“适应窗口”打开时会将整张图缩放到 `10%` 以下，`15px` 正文在屏幕上仅剩 `1.5px`，第一眼完全无法阅读；
  2. Chromium/Skia 在光栅化超大尺寸 `<svg>` 图像纹理（超过 `8192px`）时会触发内部纹理降采样。
- 将默认单张分片内容高度上限优化为 **`3600px` CSS 像素**（`2×` Retina 物理像素约 `1648 × 7600`，严格处于 `8192px` GPU 硬件纹理上限以内，长宽比约 `1 : 4.5`），中等长度回复仍为一整张高清长图，超长万字文自动按段落边界优雅切分为多张高清卡片。

### 根因 5：`cardCss` 缺少表格、公式、行内代码与深色模式透明 SVG 衬底样式，且外链失败图片可能污染 Canvas
- `cardCss` 完全未定义 `table / th / td`、`.chatsavor-math`、`hr`、`ul / ol`、行内 `code` 样式，导出含表格或数学公式的学术回复时表格无边框、公式不居中；
- 深色主题（`dark`）下，背景为 `#0f172a`，而 ChatGPT 透明底 SVG 流程图文字为 `#1f2937`（深灰字叠深蓝黑底，完全看不见）；
- 当外链图片 `http(s)://` 抓取失败时，残留的 `<img src="https://...">` 进入 `<foreignObject>` 会导致破损图标或污染 `<canvas>` 使 `toBlob` 产出 0 字节空文件。

### 根因 6（连带审查发现的 3 个配套小缺陷）
1. [fs-vault.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/fs-vault.js#L89)：`assets-packager.js` 已将 Markdown 图片路径重写为 `./assets/fig_01.png`，而 `fs-vault.js` 用 `asset.originalPath`（值为 `assets/fig_01.png`）执行 `.split('assets/fig_01.png').join('./assets/' + prefixed)`，拼出了错误的 **`././assets/slug_fig_01.png`** 双重前缀！
2. [writer.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/export/writer.js#L46-L58)：点击授权按钮后先经过异步 IndexedDB 读取再调用 `requestPermission` / `showDirectoryPicker`，在部分 Chromium 版本中会因异步跨越消耗瞬态用户手势（User Activation）而报错。
3. [core.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/core.js#L552-L593)：`复制长图` / `下载长图` 未检查生成的 `Blob.size > 0`，一旦光栅化失败仍会下载 0 字节损坏 PNG 并提示“已下载高清长图”；且 `.zip` / 本地库 / 长图导出未统一调用 `saveHistory`。

---

## 二、 分步精确修复指令（Task C-01 ～ Task C-04）

---

### Task C-01：重构 `src/lib/card-image.js` 渲染管线（严格 1:1 视口比例 + 2× 矢量直出 + 真实离屏测高）

**修改文件**：[card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js)

#### 1. 常量与几何尺寸契约
设定清晰且不可违背的几何关系：
- `DEFAULT_CARD_WIDTH = 760`（`.card` 宽度，单位 CSS px）
- `DEFAULT_OUTER_PADDING = 32`（卡片四周画布留白，给圆角与阴影留足呼吸空间，单位 CSS px）
- `outerWidth = cardWidth + outerPadding * 2`（默认 `760 + 64 = 824` CSS px）
- `DEFAULT_MAX_SLICE_HEIGHT = 3600`（`buildCardSlicesDom` / `renderToBlobs` 未显式传入 `options.maxSliceHeight` 时的默认单张分片最大内容高度；注意：`computeSlices(blocks, maxSliceHeight)` 函数本身若未传第二参数，保持回退 `3600` 或兼容显式传入的 `7200`）
- `MAX_CANVAS_SIDE = 16000`（浏览器 Canvas 单边安全像素上限）

**黄金比例不变量（严禁破坏）**：
对于任意分片 `slice`：
1. 设该分片完整外框舞台（`.cs-card-stage`，含上下各 `outerPadding` 与完整 `.card`）的逻辑高度为 `outerHeight`（正整数，`>= 200`）。
2. 请求缩放倍率 `requestedScale = options.scale || 2`。若 `outerHeight * requestedScale > MAX_CANVAS_SIDE`，按统一比例缩小 `scale = Math.max(1, MAX_CANVAS_SIDE / outerHeight)`，**X 轴与 Y 轴必须使用完全相同的 `scale`**！
3. 物理像素宽高：
   ```js
   var pixelWidth = Math.max(1, Math.round(outerWidth * scale));
   var pixelHeight = Math.max(1, Math.round(outerHeight * scale));
   ```
4. 生成 `<svg>` 时，**必须同时声明 `width`、`height` 与 `viewBox`，且严禁出现任何写死的固定高度（如 `600`）**：
   ```js
   var svgMarkup =
     '<svg xmlns="' + SVG_NS + '" width="' + pixelWidth + '" height="' + pixelHeight +
     '" viewBox="0 0 ' + outerWidth + ' ' + outerHeight + '">' +
     '<foreignObject x="0" y="0" width="' + outerWidth + '" height="' + outerHeight + '">' +
     xhtml +
     '</foreignObject></svg>';
   ```
5. 绘制 `<canvas>` 时：
   ```js
   canvas.width = slice.pixelWidth;
   canvas.height = slice.pixelHeight;
   var ctx = canvas.getContext('2d');
   ctx.fillStyle = slice.canvasColor || THEMES.light.canvas;
   ctx.fillRect(0, 0, canvas.width, canvas.height);
   ctx.imageSmoothingEnabled = true;
   ctx.imageSmoothingQuality = 'high';
   ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
   ```
   这样 `img` 的矢量光栅化尺寸（`pixelWidth × pixelHeight`）与 `canvas` 尺寸**严格 1:1 相等**，`viewBox`（`outerWidth × outerHeight`）与 `<foreignObject>` 逻辑尺寸**严格 1:1 相等**，从数学上彻底杜绝任何拉伸、挤压、裁切或二次插值模糊！

#### 2. 修复根容器结构与 `cardCss(theme, cardWidth, outerWidth, outerPadding, themeKey)`
- **严禁在 `cardCss` 中依赖不存在的 `body` 标签**！
- 每个分片的根元素必须是 `<div class="cs-card-stage">`，其内部结构固定为：
  ```html
  <div class="cs-card-stage">
    <style>/* cardCss */</style>
    <div class="card">
      <div class="brand">...</div>
      <!-- 第 1 张分片 (si === 0) 渲染完整 <h1> 标题；后续分片 (si > 0) 不重复大号 <h1>，改在 .brand 右侧或副标题显示紧凑续页标识 -->
      <h1>...</h1>
      <div class="card-body">...</div>
      <div class="meta">...</div>
    </div>
  </div>
  ```
- **注意 XML `<style>` 安全性**：`cardCss` 字符串中**不要出现 `>`、`&`、`<` 字符**（避免 `XMLSerializer` 转义差异），全部使用后代选择器或类名选择器。
- `cardCss` 必须完整覆盖以下排版规则：
  - `.cs-card-stage, .cs-card-stage * { box-sizing: border-box; }`
  - `.cs-card-stage { margin: 0; padding: {outerPadding}px; width: {outerWidth}px; background: {theme.canvas}; font-family: {theme.font}; color: {theme.text}; -webkit-font-smoothing: antialiased; }`
  - `.card { width: {cardWidth}px; margin: 0; background: {theme.bg}; border: 1px solid {theme.border}; border-radius: 18px; padding: 36px 40px; color: {theme.text}; font-family: {theme.font}; box-shadow: 0 12px 32px rgba(15,23,42,.10); overflow: hidden; overflow-wrap: anywhere; word-break: break-word; }`
  - `.brand { display: flex; justify-content: space-between; align-items: center; font-size: 12px; letter-spacing: 1.5px; color: {theme.accent}; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }`
  - `h1 { font-size: 24px; margin: 10px 0 20px; font-family: {theme.titleFont}; line-height: 1.38; color: {theme.text}; font-weight: 700; }`
  - `h2 { font-size: 19px; margin: 20px 0 10px; line-height: 1.4; color: {theme.text}; }`
  - `h3, h4, h5, h6 { font-size: 16px; margin: 16px 0 8px; line-height: 1.45; color: {theme.text}; }`
  - `p, li { font-size: 15px; line-height: 1.78; margin: 10px 0; color: {theme.text}; }`
  - `ul, ol { margin: 10px 0; padding-left: 24px; }`
  - `li { margin: 4px 0; }`
  - `hr { border: none; border-top: 1px solid {theme.border}; margin: 18px 0; }`
  - `a { color: {theme.accent}; text-decoration: none; }`
  - `pre { background: {theme.code}; border: 1px solid {theme.border}; padding: 14px 16px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; margin: 12px 0; line-height: 1.55; }`
  - `code { font-family: Consolas, "SFMono-Regular", Menlo, monospace; font-size: 13.5px; background: {theme.code}; padding: 2px 5px; border-radius: 4px; }`
  - `pre code { background: transparent; padding: 0; border-radius: 0; }`
  - `blockquote { border-left: 4px solid {theme.accent}; background: {theme.code}; padding: 8px 14px; border-radius: 0 8px 8px 0; color: {theme.muted}; margin: 12px 0; }`
  - `table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 14px 0; font-size: 13.5px; }`
  - `th, td { border: 1px solid {theme.border}; padding: 8px 10px; text-align: left; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }`
  - `th { background: {theme.code}; font-weight: 600; }`
  - `img { display: block; max-width: 100%; height: auto; margin: 12px auto; border-radius: 8px; }`
  - **深色主题透明底 SVG 图表可读性保护**：当 `themeKey === 'dark'` 时，追加：
    `.svg-diagram-img { background: #f8fafc; padding: 12px; border-radius: 10px; }`（在预处理 HTML 时为所有 `src` 以 `data:image/svg+xml` 开头的 `<img>` 添加 `class="svg-diagram-img"`）。
  - `.img-fallback { display: inline-block; font-size: 12px; color: {theme.muted}; background: {theme.code}; border: 1px dashed {theme.border}; padding: 6px 10px; border-radius: 6px; margin: 6px 0; }`
  - `.chatsavor-math { max-width: 100%; }`
  - `div.chatsavor-math { margin: 14px 0; text-align: center; overflow: hidden; }`
  - `.meta { margin-top: 24px; padding-top: 14px; border-top: 1px solid {theme.border}; font-size: 12px; color: {theme.muted}; display: flex; justify-content: space-between; align-items: center; }`

#### 3. 图片归一化与防污染预处理函数 `prepareHtmlForCard(rawHtml)`
在进入 DOM 测高之前，对 HTML 执行一次确定性归一化（导出为 `ChatSavorCardImage.prepareHtmlForCard` 便于单测）：
1. 用 `document.createElement('div')` 解析 `rawHtml`。
2. 遍历全部 `<img>`：
   - **情况 A（`data:image/svg+xml` 图表，如 ChatGPT `DilRenderer`）**：
     - 给 `<img>` 添加类名 `svg-diagram-img`。
     - 解码其 SVG 文本（支持 `;base64,` 与 URL 编码两种形式）。
     - 解析或正则提取 `<svg>` 根标签上的 `viewBox="minX minY vbW vbH"`（允许逗号或空白分隔，如 `viewBox="0 0 680 510"`）。
     - 若存在合法正数 `vbW > 0` 与 `vbH > 0`：
       - 检查 `<svg>` 根标签的 `width` / `height` 属性：若缺失或包含 `%`（例如 `width="100%"`），在 `<svg>` 根元素上设置明确的数值属性 `width="{Math.round(vbW)}"` 和 `height="{Math.round(vbH)}"`，重新编码回 `data:image/svg+xml;base64,...` 写回 `img.setAttribute('src', ...)`；
       - 同时若 `<img>` 自身未设置正整数 `width` / `height` 属性，也在 `<img>` 上设置 `width="{Math.round(vbW)}"` 与 `height="{Math.round(vbH)}"`（配合 CSS `max-width: 100%; height: auto;`，既让浏览器按 `vbW : vbH` 精确保持原始宽高比，又能在 JSDOM 或同步布局阶段直接计算出精确缩放高度！）。
   - **情况 B（其他合法内联 `data:image/(png|jpeg|jpg|gif|webp)`）**：保留原样。
   - **情况 C（任何非 `data:image/` 的残留外链 `src`，例如抓取失败的 `https://...` 或空 `src`）**：
     - **绝不允许非 `data:` 图片进入 `<foreignObject>`**（防止污染 `<canvas>` 导致 `toBlob` 报错返回空文件）！
     - 将该 `<img>` 替换为 `<span class="img-fallback">[外部图片未能离线内联' + (alt ? '：' + alt : '') + ']</span>`。

#### 4. 修复 `serializeStrictXhtml(element)` 的重复克隆与 `xmlns` 冲突
检查 [card-image.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/card-image.js#L25-L58)：
- 原代码第 49 行先转换一遍 `element.childNodes`，第 51-56 行又清空重转一遍，浪费双倍性能；
- 当 `element` 是普通元素节点（如 `<div class="cs-card-stage">`）时，直接以该元素对应的严格 XHTML 节点作为 `xmlDoc` 根节点（例如 `document.implementation.createDocument(XML_NS, localName, null)`，复制其属性并递归转换子节点），若传入的是 `DocumentFragment` 或 `<html>` 则包一层 `<div xmlns="http://www.w3.org/1999/xhtml">`。
- 复制属性时：跳过 `on*` 事件属性，且跳过 `an === 'xmlns'`（因为 `createElementNS(ns, local)` 已经绑定了正确的命名空间，重复 `setAttribute('xmlns', ...)` 在部分浏览器 XML DOM 中会抛 `NamespaceError`）。
- 确保返回的 XHTML 字符串使用 `new DOMParser().parseFromString(xhtml, 'application/xhtml+xml')` 解析时 `querySelector('parsererror') === null`，且完整保留 MathML（`http://www.w3.org/1998/Math/MathML`）与内联 SVG（`http://www.w3.org/2000/svg`）命名空间。

#### 5. 离屏 Shadow DOM 精确测高（过滤空白文本节点 + 真实读取每张分片 `outerHeight`）
在 `buildCardSlicesDom(sanitizedBodyHtml, pageMeta, options)` 中：
1. 先对输入 HTML 调用 `prepareHtmlForCard(sanitizedBodyHtml)`。
2. 创建离屏宿主容器 `measureHost`（`position:fixed;left:-99999px;top:0;width:' + outerWidth + 'px;visibility:hidden;pointer-events:none;z-index:-1;`），挂载到 `document.body || document.documentElement`，若支持 `attachShadow` 则使用 ShadowRoot 彻底隔绝宿主网页（ChatGPT/豆包/DeepSeek）的全局样式干扰！
3. **块级子节点清洗（彻底消灭空白换行节点虚增 `40px` Bug）**：
   - 将准备好的 HTML 放入临时容器后遍历 `childNodes`：
     - `nodeType === 1`（元素节点）：保留；
     - `nodeType === 3`（文本节点）：若 `node.nodeValue.trim()` 为空（如 `"\n"`），**直接丢弃**！若非空，包裹进 `<p>` 元素中保留；
     - 其他节点（注释等）：丢弃。
4. **第一阶段测量（测量每个块在真实 `.card-body` 宽度下的高度）**：
   - 在离屏 ShadowRoot 中放入 `<style>{cardCss}</style><div class="cs-card-stage"><div class="card"><div class="card-body">...全部块克隆...</div></div></div>`。
   - 对每个块读取 `rect = el.getBoundingClientRect()` 及 `getComputedStyle(el)` 的 `marginTop` / `marginBottom`：
     - 若 `rect.height > 0`（真实浏览器环境），块高 `h = Math.ceil(rect.height + marginTop + marginBottom)`；
     - 若 `rect.height === 0`（JSDOM 无排版引擎环境），使用改进版 `estimateBlockHeight(el, cardWidth - 82)`：若块自身是 `IMG` 或内部含 `img[width][height]`，按 `Math.round(imgH * Math.min(1, innerWidth / imgW)) + 24` 计算精确比例高度；否则按字数与行数估算。
5. 调用 `computeSlices(blocks, maxSliceHeight)` 切分块列表。
6. **第二阶段测量（逐张分片读取真实拼装后的完整舞台高度 `outerHeight`！）**：
   - 对每个分片 `si` 组装最终的 `<div class="cs-card-stage">`（含 `<style>`、`.brand`、`si === 0` 时的 `<h1>`、`.card-body`、`.meta`）。
   - **将该 `<div class="cs-card-stage">` 挂入离屏 ShadowRoot 中，直接读取 `var stageRect = stageEl.getBoundingClientRect()`**！
   - 若 `stageRect && stageRect.height > 0`（真实浏览器环境）：
     `outerHeight = Math.ceil(stageRect.height)` —— **精确到 1px，既不截断底部，也不留多余空白尾巴**！
   - 若 `stageRect.height === 0`（JSDOM 环境）：
     `outerHeight = Math.max(240, sliceBodyHeight + (si === 0 ? 190 : 130) + outerPadding * 2)`。
7. 测量完毕后在 `finally` 中 `measureHost.remove()` 清理 DOM，绝不残留任何节点。
8. 返回分片描述对象（同时兼容旧字段名并暴露精确像素字段）：
   ```js
   {
     width: outerWidth,          // 注意：此处统一为完整 SVG 外框宽度 outerWidth（而非内卡 width），消除内外宽度错位！
     cardWidth: cardWidth,
     outerWidth: outerWidth,
     height: outerHeight,
     outerHeight: outerHeight,
     pixelWidth: pixelWidth,
     pixelHeight: pixelHeight,
     scale: scale,
     canvasColor: theme.canvas,
     xhtml: xhtml,
     svgDataUrl: svgDataUrl,
     sliceIndex: si,
     sliceCount: slices.length
   }
   ```

#### 6. 在 `renderToBlobs` 中异步预解码图片并校验非空画布输出
在 `renderToBlobs(markdown, pageMeta, options)` 中：
1. Markdown → HTML（`ChatSavorMarkdown.render`）→ `ChatSavorAssets.inlineAllImagesForHtml(html)` → `prepareHtmlForCard(inlinedHtml)`。
2. **图片预解码（确保测高前 `data:` 位图/SVG 已完成解码）**：
   - 检测当前环境是否具备真实布局能力（挂载一个 `10×10` 探测节点检查 `getBoundingClientRect().height > 0`）。
   - 若在真实浏览器环境中，在调用 `buildCardSlicesDom` 前，对 HTML 中所有 `data:image/` 图片通过离屏 `Image` 实例调用 `img.decode()`（带 `1500ms` 超时保护，失败自动忽略继续），确保浏览器图片缓存已就绪，离屏 `getBoundingClientRect()` 能拿到 100% 真实图片高度。
3. 将每张分片的 `slice.svgDataUrl` 加载进 `new Image()` 后绘制到 `slice.pixelWidth × slice.pixelHeight` 的 `<canvas>`：
   - 先用 `slice.canvasColor` 铺满底色，再 `ctx.drawImage(img, 0, 0, canvas.width, canvas.height)`。
   - 在真实运行环境中，若 `img.onerror` 触发或 `canvas.toBlob` 产出了空对象，reject 明确错误信息（仅在无 Canvas 的 JSDOM 降级分支返回占位 Blob 以兼容纯逻辑测试，若测试注入了自定义 `Image` 与 `canvas.getContext` Mock 则完整走通绘制流程）。

---

### Task C-02：修复 `src/lib/fs-vault.js`、`src/export/writer.js` 与 `src/content/core.js` 配套缺陷

#### 1. 修复 [fs-vault.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/lib/fs-vault.js#L86-L91) 的 `././assets/` 双重前缀问题
查看现存第 89 行：
```js
if (asset.originalPath) rewritten = rewritten.split(asset.originalPath).join('./assets/' + prefixed);
```
当 `rewritten` 中为 `./assets/fig_01.png` 且 `asset.originalPath` 为 `assets/fig_01.png` 时，替换后会变成 `././assets/slug_fig_01.png`！
**必须修改为**：先替换 `'./' + cleanOriginalPath`，再替换裸 `cleanOriginalPath`（避免二次匹配，使用占位或正则一次性替换 `(?:\\.\\/)?assets/fig_01.png`）：
```js
if (asset.originalPath) {
  var cleanOrig = String(asset.originalPath).replace(/^\.\//, '');
  rewritten = rewritten.split('./' + cleanOrig).join('./assets/' + prefixed);
  // 若原文中存在不带 ./ 的裸相对路径（如单元测试直接传入 assets/fig_01.png），且尚未带前缀，再做精确替换：
  rewritten = rewritten.replace(new RegExp('(^|[(" \'\\n])' + cleanOrig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '$1./assets/' + prefixed);
}
```
确保无论输入是 `![a](./assets/fig_01.png)` 还是 `![a](assets/fig_01.png)`，输出一律是干净的 **`./assets/<slug>_fig_01.png`**，绝不出现 `././assets/`！

#### 2. 修复 [writer.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/export/writer.js) 的用户手势（User Activation）保持
- 在页面初始化 `readPayload()` 阶段就将 `vault.getDirectoryHandle()` 的结果缓存到局部变量 `cachedHandle`；
- 用户点击 `#primary` 时：
  - 若 `cachedHandle` 存在且具备 `requestPermission`，**同步在点击事件栈顶直接调用** `cachedHandle.requestPermission({ mode: 'readwrite' })`（不再先跑一遍异步 IndexedDB 打开流程）；若返回 `'granted'` 则直接写入，若未授予则提示用户点击按钮重新选择文件夹；
  - 若 `cachedHandle` 为空，**同步在点击事件栈顶直接调用** `window.showDirectoryPicker({ mode: 'readwrite' })`，保存句柄后立即写入。

#### 3. 修复 [core.js](file:///d:/coding/github_self/ChatSavor/chrome-extension/src/content/core.js#L497-L593) 导出健壮性与历史记录一致性
1. 在 `btnCopyCard` 与 `btnDownloadCard` 中：
   - 校验返回的 `result.blobs` 非空且每张 `blob.size > 0`；若 `blob.size === 0`，在 `copyStatus` 显示 `'长图生成失败：渲染结果为空，请重试。'` 并终止，**严禁下载 0 字节损坏 PNG 或将其写入剪贴板**。
   - 导出成功时调用 `saveHistory(markdown, pageMeta)`（同样在 `btnZip` 与 `btnVault` 成功回调中也补齐 `saveHistory(markdown, pageMeta)`，保持全导出通道历史记录一致）。
   - 生成过程中禁用对应按钮（`disabled = true`），结束后在 `.finally` / `.then` + `.catch` 中恢复按钮可点击状态，防止用户连续狂点重复触发重渲染。

---

### Task C-03：升级与扩充自动化单测（严禁只测表层 XML）

**修改 / 扩充测试文件**：
1. [card-image.test.cjs](file:///d:/coding/github_self/ChatSavor/chrome-extension/tests/card-image.test.cjs)
2. [vault-writer.test.cjs](file:///d:/coding/github_self/ChatSavor/chrome-extension/tests/vault-writer.test.cjs)

必须在 [card-image.test.cjs](file:///d:/coding/github_self/ChatSavor/chrome-extension/tests/card-image.test.cjs) 中新增并实跑通过以下 **6 项硬核几何与渲染契约测试**：

1. **`C1 SVG viewport has zero hardcoded 600px height and preserves 1:1 aspect ratio with pixelWidth/pixelHeight`**：
   - 输入一段包含标题、20 个段落、代码块、表格、公式的较长 HTML；
   - 调用 `buildCardSlicesDom`，解码每张分片的 `slice.svgDataUrl`（`decodeURIComponent(slice.svgDataUrl.split(',')[1])`），用 `DOMParser`（`image/svg+xml`）解析 `<svg>`：
     - 断言 `<svg>` 的 `height` 属性**不等于 `'600'`**，且等于 `String(slice.pixelHeight)`；
     - 断言 `<svg>` 的 `width` 属性等于 `String(slice.pixelWidth)`；
     - 断言 `<svg>` 拥有 `viewBox === '0 0 ' + slice.outerWidth + ' ' + slice.outerHeight`；
     - 断言 `<foreignObject>` 的 `width === String(slice.outerWidth)` 且 `height === String(slice.outerHeight)`；
     - 断言宽高比严格一致：`Math.abs((slice.pixelWidth / slice.pixelHeight) - (slice.outerWidth / slice.outerHeight)) < 0.002`。

2. **`C1 serialized XHTML contains .cs-card-stage root and never relies on missing <body>`**：
   - 解析 `slice.xhtml`（`application/xhtml+xml`），断言无 `parsererror`；
   - 断言存在 `.cs-card-stage` 元素与 `.card` 元素，且 `<style>` 文本包含 `.cs-card-stage`、`.card`、`table`、`th, td` 样式，不包含孤立失效的 `body{` 选择器。

3. **`C1 whitespace newline text nodes between HTML blocks do not inflate slice height`**：
   - 构造两份语义完全相同的 HTML：一份紧凑无换行 `'<p>段落A</p><p>段落B</p><p>段落C</p>'`，另一份在标签间插入 50 个换行符 `'<p>段落A</p>\n\n\n...\n<p>段落B</p>\n\n\n...\n<p>段落C</p>'`；
   - 分别调用 `buildCardSlicesDom`，断言两者的 `slices[0].outerHeight` **完全相等**（误差为 `0`），彻底证明空白文本节点不再虚增高度！

4. **`C1 prepareHtmlForCard normalizes viewBox-only SVG data URIs and neutralizes external http images`**：
   - 构造一个模拟 ChatGPT `DilRenderer` 的 `<img src="data:image/svg+xml;base64,...">`（内部 `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 680 510"><text>Stage 1</text></svg>`，无 `height` 属性）以及一个残留外链 `<img src="https://example.com/fail.png" alt="示意图">`；
   - 调用 `prepareHtmlForCard`：
     - 断言第一个 `<img>` 带有 `width="680"`、`height="510"` 和 `svg-diagram-img` 类名，且解码其 `src` 内部 `<svg>` 根标签也具备 `width="680"` 与 `height="510"`；
     - 断言输出的 HTML 中**不再包含任何 `src="https://"` 的 `<img>`**，且包含降级提示 `.img-fallback`（含 `示意图` 文本）。

5. **`C1 renderToBlobs draws onto exact pixelWidth x pixelHeight canvas without stretching`**：
   - 在 JSDOM 窗口中注入真实的 Mock `Image`（设置 `src` 后异步触发 `onload`）与 Mock `HTMLCanvasElement.prototype.getContext` / `toBlob`（记录 `canvas.width`、`canvas.height`、`fillRect` 与 `drawImage` 实参，并产出非空 PNG 头字节 `new Blob([new Uint8Array([137,80,78,71])], { type: 'image/png' })`）；
   - 调用 `renderToBlobs('# 测试标题\n\n正文第一段\n\n| A | B |\n|---|---|\n| 1 | 2 |', { title: '测试', platform: 'ChatGPT' }, { theme: 'dark' })`；
   - 断言：
     - `canvas.width === result.slices[0].pixelWidth` 且 `canvas.height === result.slices[0].pixelHeight`；
     - `drawImage` 的目标宽高 `(dw, dh)` 严格等于 `(canvas.width, canvas.height)`，且与 `<svg>` 声明的 `(width, height)` **100% 相等**！

6. **`C2 writeBundleToDirectory rewrites ./assets/fig_01.png cleanly without ././assets/ double prefix`**（加入 [vault-writer.test.cjs](file:///d:/coding/github_self/ChatSavor/chrome-extension/tests/vault-writer.test.cjs)）：
   - 传入已被 `assets-packager.js` 重写过的 Markdown `'正文 ![图](./assets/fig_01.png)'` 与 `originalPath: 'assets/fig_01.png'`；
   - 断言写入磁盘的 Markdown 内容包含 `'(./assets/note_fig_01.png)'` 且**绝对不包含 `'././assets/'`**！

---

### Task C-04：全量回归验证清单（交付前必跑）

DeepSeek Harness 完成修改后，必须依次执行以下两条命令并确认零报错：

1. 运行全量测试套件（原有 189 项 + 新增至少 6 项 = **195+ 项测试全部 PASS**）：
   ```bash
   npm --prefix chrome-extension test
   ```
2. 运行版本号一致性检查：
   ```bash
   npm --prefix chrome-extension run check:version
   ```
3. 自检确认：
   - `git diff chrome-extension/src/lib/katex.js` 为空（未破坏 KaTeX quirks-mode 补丁）；
   - `chrome-extension/src/lib/card-image.js` 中不再含有 `'height="600"'` 或 `'body{'`；
   - `tests/bugfix10.test.cjs` 单独加载 `docx-builder.js` 依然通过。

---

## 执行进度 Checklist

- [x] **Task C-01** 重构 `src/lib/card-image.js`（严格 1:1 视口比例 + 3600 上限 + 真实离屏 Shadow DOM 测高 + viewBox 图片归一化）
- [x] **Task C-02** 修复 `src/lib/fs-vault.js`（`././assets/` 双重前缀）、`src/export/writer.js`（User Activation 缓存句柄）、`src/content/core.js`（防连点 + 空 Blob 拦截 + saveHistory）
- [x] **Task C-03** 扩充 `tests/card-image.test.cjs` 与 `tests/vault-writer.test.cjs`（6 项硬核几何/渲染契约测试）
- [x] **Task C-04** 全量回归：`npm test` 195 项 0 fail + `check:version` 通过 + `git status` 无临时文件
