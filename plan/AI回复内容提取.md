## 目的
**在每次 AI 回复内容的旁边动态注入一个按钮，点击后自动提取该条回复，转换成 Markdown 实时预览，并支持下载**

##  整体流程
```
AI 回复出现 → Content Script 检测到 → 在旁边插入“保存”按钮
                                          ↓
                          用户点击按钮 → 提取该回复的 HTML
                                          ↓
                          将 HTML 转换为 Markdown
                                          ↓
               在 Popup/侧边栏渲染 Markdown 预览，并提供下载按钮（.md / .pdf / .docx）
```

##  核心技术实现要点
#### 1. 注入“提取”按钮到每条 AI 回复

使用 **Content Script** 注入到 AI 聊天页面（需在 `manifest.json` 声明主机权限，如 `*://chat.openai.com/*` 等）。

监听 DOM 变化，找到每条属于 AI 助手的回复容器。不同平台的选择器需要适配，例如：

- **ChatGPT**：`[data-message-author-role="assistant"]`
- **Claude**：`div[class*="assistant"]` 或类似结构
- 更通用的方法是挂载 `MutationObserver` 监听从服务器过来的新节点，然后对每个新回复容器追加按钮。

插入按钮时要注意样式隔离，可以使用 `all: initial` 或者 Shadow DOM 包裹，避免受原站 CSS 影响。按钮可设计成浮动小图标，定位在回复条目的右上角。

#### 2. 点击按钮时提取内容

找到按钮所在的回复容器，克隆其 DOM 或直接读取 `innerHTML`。保留完整的原始 HTML 结构（包括代码块、表格、加粗等），这些是转 Markdown 的基础。

#### 3. HTML 转 Markdown

推荐使用 [**Turndown**](https://github.com/mixmark-io/turndown) 库（体积小，规则可定制），它能将 HTML 转成标准 Markdown。需要特别处理：

- **代码块**：保证 `<pre><code>` 转为带语言标记的围栏代码块
- **表格**：Turndown 默认支持，但复杂表格可能需要调整
- **数学公式**（LaTeX）：如果原页面用 `\( ... \)` 或者 `$$ ... $$` 嵌入，需保留这些标记，Turndown 会保持原样（它们通常不在HTML标签中，而是文本节点）
- **图片**：若无外链图床，只能保留原有链接或放弃，不能二进制内嵌到 Markdown 中

#### 4. 渲染 Markdown 与下载

从 Content Script 无法直接下载文件，需要通过消息传递给 **Popup / 侧边栏 / Service Worker** 处理。  
在 Popup 里，你可以用 `marked` 快速渲染 Markdown 为 HTML 展示，并提供下载按钮：

- **下载 .md 文件**：拼接 `data:text/markdown;charset=utf-8,` + encodeURIComponent(markdown)，模拟点击 `<a>` 下载。
- **下载 PDF**：在 Popup 中用渲染后的 HTML 调用 `window.print()` 或使用 `jsPDF` 库生成。
- **下载 Word**：构建微软兼容的 HTML 模板，保存为 .doc 文件。

由于 Popup 会因为失去焦点而关闭，你可以在 Popup 中显示预览并引导用户使用右键保存，或者创建一个通过 `chrome.windows.create` 打开的新窗口来展示，这样可以更稳定处理下载。

## 需要注意的坑
- **Shadow DOM**：部分 AI 页面内容在 Shadow Root 内部，需要 `element.shadowRoot` 才能访问，按钮也需要注入到 Shadow 内。

- **动态流式输出**：AI 回复是逐步生成的，DOM 会不断更新。你可以等回复完成（比如出现“停止生成”按钮消失，或 blob cursor 消失）再显示“保存”按钮，否则提取的是半截内容。

- **跨域限制**：如果 AI 回复中嵌入了 `iframe` 内联文档，提取会受到限制，但通常常规聊天内容不会。

- **平台更新**：平台 CSS 类名可能会变，你需要维护一个可配置的选择器列表，或者提供一个“手动选取”的备选方案（用户点击你插件图标后，鼠标选择区域）。