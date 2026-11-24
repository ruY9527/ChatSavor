# ChatSavor

AI对话内容提取与转换工具Chrome扩展插件。

## 项目结构

```
ChatSavor/
├── README.md                 # 项目说明文档
├── .gitignore              # Git忽略配置
├── plan/                    # 产品规划与需求文档
│   └── ChatSavor重构与功能扩展计划.md # 重构与功能扩展执行规范
└── chrome-extension/        # Chrome扩展主目录
    ├── manifest.json        # 扩展配置文件（MV3）
    ├── .gitignore           # 扩展级Git忽略配置
    ├── package.json         # NPM依赖配置
    ├── assets/             # 扩展图标资源
    │   ├── icon.svg        # 源图标（矢量）
    │   ├── icon16.png      # 工具栏图标(16x16)
    │   ├── icon48.png      # 工具栏图标(48x48)
    │   └── icon128.png     # 应用图标(128x128)
    └── src/                 # 源代码目录
        ├── background.js    # Service Worker（后台脚本）
        ├── connection.js    # 多 Frame 探测与连接逻辑
        ├── content/         # Content Scripts（内容脚本）
        │   ├── dom.js       # 跨 Shadow DOM / iframe 的 DOM 工具
        │   ├── bridge.js    # 页面内命令桥（STATUS/SCAN/LATEST…）
        │   ├── markdown.js  # Markdown 渲染、公式与净化引擎
        │   ├── core.js      # 按钮注入、预览弹窗与导出
        │   ├── platform-base.js # 统一平台适配器基类
        │   ├── content.js   # 通用扫描器（无专用适配器的站点）
        │   └── platforms/   # 各平台专用适配器（chatgpt/gemini/deepseek/…）
        │       └── *.js
        ├── lib/            # 第三方库
        │   ├── turndown.js # HTML转Markdown库
        │   ├── marked.js   # Markdown渲染库
        │   ├── katex.js    # 公式渲染库
        │   └── pdf.js      # PDF 导出兜底
        └── popup/          # 扩展弹窗
            └── popup.html  # 弹窗界面与交互逻辑（内联脚本）
```

## 目录说明

| 目录/文件 | 说明 |
|-----------|------|
| `plan/` | 存放产品需求、功能规划等文档 |
| `chrome-extension/` | Chrome扩展全部代码 |
| `chrome-extension/assets/` | 扩展图标，16/48/128三种尺寸PNG格式 |
| `chrome-extension/src/content/` | Content Script，注入到AI聊天页面执行 |
| `chrome-extension/src/lib/` | 第三方JS库，无构建工具时直接引用 |
| `chrome-extension/src/popup/` | 点击扩展图标弹出的UI界面 |

## 功能特性

- 在每条 AI 回复末尾注入“转换”按钮
- 支持 ChatGPT、DeepSeek、Gemini、豆包、Grok 等多个 AI 平台
- HTML转Markdown（保留代码块、表格等格式）
- 支持预览和下载为 .md / .html 文件

## 安装步骤

1. 打开Chrome，访问 `chrome://extensions/`
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `chrome-extension` 文件夹

## 图标说明

请在 `chrome-extension/assets/` 目录下提供以下尺寸的PNG图标：
- `icon16.png` (16x16) - 工具栏小图标
- `icon48.png` (48x48) - 工具栏图标
- `icon128.png` (128x128) - 应用图标

或使用在线工具将 `assets/icon.svg` 转换为PNG。

## 使用方法

1. 安装扩展后，打开支持的 AI 聊天页面
2. AI 回复生成结束约 2–4 秒后，回复末尾会显示紫色“转换”按钮
3. 点击按钮提取内容
4. 在预览中复制 Markdown、富文本或单条公式，也可下载文件

## 更新扩展与按钮排查

- 更新源码后，在 `chrome://extensions/` 中点击 ChatSavor 的“重新加载”。2.0.4 起会自动替换已打开 ChatGPT 标签页中的旧脚本；扩展弹窗也能手动“重新连接页面并显示按钮”。仅修改文件不会自动更新已运行的脚本。
- ChatGPT 支持 `https://chatgpt.com/` 和旧域名 `https://chat.openai.com/`。在有 AI 回复的对话中，回复生成结束后，等待约 2–4 秒即可看到“转换”按钮；新建空白对话没有按钮。
- 如果仍未显示，在扩展详情中检查是否允许访问当前网站。
- 仓库中的 `.crx` 是独立安装包，不会随源码修改自动更新。测试最新修复时，请加载本仓库的 `chrome-extension` 文件夹。

从 2.0.3 起，点击浏览器工具栏的 ChatSavor 图标可以直接检查当前网页是否连接、页面脚本版本、识别到的回复数和转换按钮数。如果旧标签页没有加载脚本，弹窗会尝试重新连接；也可手动点击“重新连接页面并显示按钮”。这使用已有 `activeTab` 授权和 `scripting` 权限，不增加网站访问范围。

每条 AI 回复末尾分别显示一个“转换”按钮，点击时只提取对应回复。页面没有全局悬浮转换按钮。如果新版网页暂时无法识别，可在浏览器工具栏的扩展弹窗中选择“转换网页中选中的内容”。

2.0.4 修复重新加载后的恢复逻辑：更新扩展时自动重新连接已打开的 ChatGPT 标签页，不刷新网页；旧的页面版本、通信监听器丢失或只加载了部分转换脚本时，会重新加载对应脚本。页面脚本版本记录实际执行的版本，不再读取更新后的扩展版本冒充页面版本。即使页面连接失败，“复制检测结果”也会保留失败原因，并隐藏错误信息中的网址路径。

2.0.5 修复只扫描顶层文档的盲区：扫描同源 iframe 及开放/封闭 Shadow DOM，转换时保留组件内部的实际内容；向已有访问权限的子页面加载脚本，并根据回复所在的 frame 定向发送转换命令，避免空白外层文档先响应。由匹配来源创建的 `about:`、`blob:` 等相关页面也会按浏览器规则匹配。跨域访问仍由 Chrome 的网站权限控制，不增加网站访问范围。检测结果会列出文档、Shadow DOM 和 iframe 的结构信息，便于区分不可访问的子页面和未识别的回复格式。

2.0.6 补上新版 ChatGPT 消息结构：`li[data-message-role="assistant"]`、`[data-assistant-markdown]`、以 `:assistant` 结尾的消息单元和 `[data-markdown-text-style="assistant-message"]`。旧版只识别作者角色和旧对话回合，即使页面有完整回复也可能识别为 0 条。同一个 `[data-turn-key]` 可能包含用户问题与 AI 回复，因此只对其中的 AI 消息单元添加按钮，按钮位于每条回复内部的末尾。转换时排除角色标题、复制/反馈操作栏，保留正文、原始公式与来源链接；工具栏“转换最新回复”使用同一提取逻辑。新版布局属性来自[维护者的现场记录与结构样例](https://github.com/rashidazarang/chatgpt-chat-exporter/blob/master/docs/RELEASE_AUDIT.md)，新增回归用例复现旧规则识别为 0 的情况。这些用例通过不代表已在每个用户账号的实时页面验证。

当识别结果为 0 时，检测报告会保留 `markup` 结构样本及新布局计数；脚本连接过程不会再覆盖结构样本。样本仅记录标签、结构属性、文本长度和已知操作名称，不读取聊天正文或页面启动脚本。

仍然没有入口时，在 ChatGPT 标签页打开扩展弹窗，点击“复制检测结果”并反馈。检测结果包含版本、域名、结构计数和脚本错误，不包含聊天正文或对话网址。不能仅凭本地模拟测试判断用户网页的实际根因。

开发回归测试：在 `chrome-extension` 目录执行 `npm ci`，再执行 `npm test`。浏览器加载扩展不需要安装这些开发依赖。

## Markdown、Obsidian 与 Notion

- 公式优先从 KaTeX、MathJax 的原始 TeX 注释或属性中提取，避免把公式的多个渲染副本拼成普通文字。行内公式使用 `$...$`，独立公式使用单独成行的 `$$`，保留上下标、反斜杠、多行公式和矩阵换行。
- 表格保留公式、粗体、链接和代码。公式中的竖线按 Markdown 表格语法处理；跨行、跨列单元格展开成普通矩形表格，合并区域只在左上格保留内容，其余格留空。
- **Obsidian**：使用“复制 Markdown”，或直接将下载的 `.md` 放入笔记库；若粘贴时被转换为富文本，可使用“粘贴为纯文本”。Obsidian 使用 MathJax，支持 `$...$` 和 `$$...$$`。[官方公式说明](https://help.obsidian.md/advanced-syntax)
- **Notion**：可尝试“复制富文本”，或通过“导入 → Text & Markdown”导入 `.md`。Notion 的纯文本粘贴、富文本粘贴和文件导入走不同路径，不能保证整篇公式自动变成原生公式块。对于未识别的公式，打开“公式”页，复制不含分隔符的 LaTeX，再粘贴到 Notion 的行内公式编辑器（`Ctrl/Cmd+Shift+E`）或 `/math` 独立公式中。[官方公式说明](https://www.notion.com/help/math-equations) · [官方导入说明](https://www.notion.com/help/import-data-into-notion)
- 预览使用本地打包的 KaTeX，通过浏览器原生 MathML 显示，无需联网加载脚本或字体。MathJax 与 Notion 的 KaTeX 支持范围不同；不支持的命令会显示源码和提示，不会静默丢弃。若网页没有提供 TeX 源码，则保留原始 MathML/内容并提示检查，不能自动恢复所有公式。
- 更新依赖后，可在 `chrome-extension` 中执行 `npm run vendor:math` 同步打包的公式库及许可证。

可用 [公式兼容性检查样例](examples/math-compatibility.md) 在目标应用中核对行内公式、独立公式、多行矩阵、表格、代码和引用。
