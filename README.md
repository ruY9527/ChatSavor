# ChatSavor

AI对话内容提取与转换工具Chrome扩展插件。

## 项目结构

```
ChatSavor/
├── README.md                 # 项目说明文档
├── .gitignore              # Git忽略配置
├── plan/                    # 产品规划与需求文档
│   └── AI回复内容提取.md    # AI回复提取功能需求文档
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
        ├── content/         # Content Scripts（内容脚本）
        │   ├── content.js  # 注入保存按钮逻辑
        │   └── content.css # 按钮样式
        ├── lib/            # 第三方库
        │   ├── turndown.js # HTML转Markdown库
        │   └── marked.js   # Markdown渲染库
        └── popup/          # 扩展弹窗
            ├── popup.html  # 弹窗界面
            └── popup.js   # 弹窗交互逻辑
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

- 在AI回复旁注入"保存"按钮
- 支持ChatGPT、Claude、Gemini等多个AI平台
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

1. 安装扩展后，打开AI聊天页面（如 chat.openai.com）
2. AI回复出现后，右侧会显示紫色"Save to Markdown"按钮
3. 点击按钮提取内容
4. 点击浏览器工具栏图标打开预览和下载选项