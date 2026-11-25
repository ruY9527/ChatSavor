# ChatSavor

AI 对话内容提取与转换工具 Chrome 扩展插件（Manifest V3，零构建，100% 本地离线运行）。

把 ChatGPT、Claude、DeepSeek 等 13 个 AI 平台的回复，高保真导出为 Markdown / Word(.docx) / PDF / LaTeX(.tex) / 单文件 HTML / 离线含图 ZIP / 高清长图卡片，并支持 Obsidian 一键入库与本地库直写。

当前版本：**v2.0.6** · 测试基线：**207/207 通过**

---

## 项目结构

```
ChatSavor/
├── README.md                 # 项目说明（含完整使用指南）
├── USER_USE.md               # 详细使用指南（独立文件，内容同步嵌入 README）
├── .gitignore                # Git 忽略配置
├── plan/                     # 重构、BUG 修复与功能升级执行规范
│   ├── ChatSavor重构与功能扩展计划.md
│   ├── ChatSavor_BUG修复清单.md
│   ├── ChatSavor_豆包修复与PDF水印方案.md
│   ├── ChatSavor_PDF排版与ChatGPT图表交互修复方案.md
│   ├── ChatSavor_学术公式与离线长图导出升级方案.md
│   ├── ChatSavor_长图卡片清晰度与比例修复方案.md
│   ├── ChatSavor_全局UI视觉与交互体验升级方案.md
│   └── ChatSavor_Word导出图片公式与排版深度修复方案.md
├── chrome-extension/         # Chrome 扩展主目录
│   ├── manifest.json         # MV3 配置（13 平台匹配 + 可选外链图权限）
│   ├── package.json          # NPM 脚本与开发依赖
│   ├── scripts/              # 版本同步 / 公式库打包脚本
│   ├── assets/               # 扩展图标（16/48/128 PNG + SVG 源）
│   ├── tests/                # node:test + jsdom 回归测试（207 项）
│   └── src/
│       ├── background.js     # Service Worker（打印页、外链图抓取、本地库写盘、标签页恢复）
│       ├── connection.js     # 多 Frame 探测与连接逻辑
│       ├── content/          # 内容脚本（平台基类、桥接、Markdown 引擎、导出、通用扫描器）
│       │   └── platforms/    # 13 个平台专用适配器
│       ├── lib/              # 离线库（zip / omml / docx-builder / latex-builder / card-image / katex / marked / turndown / pdf / fs-vault）
│       ├── popup/            # 扩展弹窗（状态灯 + 快捷操作）
│       ├── options/          # 设置与历史中心
│       └── export/           # 打印页与本地库授权写入页
```

## 目录说明

| 目录/文件 | 说明 |
|-----------|------|
| `plan/` | 产品需求、重构与修复执行规范 |
| `chrome-extension/` | Chrome 扩展全部代码 |
| `chrome-extension/src/content/` | Content Script，注入 AI 聊天页执行 |
| `chrome-extension/src/lib/` | 零依赖离线库，无构建工具直接引用 |
| `chrome-extension/src/popup/` | 工具栏弹窗 UI |
| `chrome-extension/src/options/` | 设置与本地历史中心 |
| `chrome-extension/src/export/` | PDF 打印工作台与本地库授权页 |
| `chrome-extension/tests/` | JSDOM 真行为回归测试 |

## 核心特性

- **13 平台专用适配器** + 自定义站点规则（通用扫描器）
- **四种提取方式**：单条回复、最新回复、整场对话、页内多选 + 划词兜底
- **高保真公式**：LaTeX 源码还原 + Word 原生可编辑公式（OMML）+ 单条复制
- **多格式导出**：`.md` / `.pdf`（矢量水印 + 三模式页脚）/ `.docx`（图片嵌入）/ `.tex`（Overleaf）/ `.html` / `.zip`（离线含图）/ 3 主题高清长图
- **知识库工作流**：Obsidian URI 一键入库、Notion 兼容、本地库文件夹直写
- **现代 UI**：页内双联胶囊、两层导出工作台、浅/深色自适应、宽屏模式、快捷键
- **隐私安全**：全链路净化 XSS、诊断脱敏、零外部请求

## 安装

1. 打开 `chrome://extensions/`，开启右上角 **开发者模式**；
2. 点击 **加载已解压的扩展程序**，选择 `chrome-extension` 文件夹；
3. 工具栏出现 ChatSavor 图标即可使用。

更新源码后，在 `chrome://extensions/` 点击扩展卡片的 **重新加载**。

## 开发

```bash
cd chrome-extension
npm ci
npm test                  # 207 项全量回归
npm run check:version     # 版本一致性校验
npm run sync:version      # 同步版本号
npm run vendor:math       # 同步公式库
```

浏览器加载扩展不需要开发依赖。

---

# 完整使用指南

> 以下内容与仓库根目录的 `USER_USE.md` 完全一致（同步嵌入）。

<!-- USER_USE_EMBED_START -->
# ChatSavor 使用指南（USER_USE.md）

> 适用版本：v2.0.6 · 零构建 Manifest V3 扩展 · 100% 本地离线运行，不依赖任何外部 CDN 或联网 API。

本指南覆盖从安装、日常使用到全部导出格式、设置中心、本地库直写与故障排查的完整操作流程。

---

## 目录

1. [它是什么](#1-它是什么)
2. [安装与更新](#2-安装与更新)
3. [快速开始：3 步导出一条回复](#3-快速开始3-步导出一条回复)
4. [支持的平台](#4-支持的平台)
5. [四种内容提取方式](#5-四种内容提取方式)
6. [页内胶囊按钮](#6-页内胶囊按钮)
7. [预览与导出工作台](#7-预览与导出工作台)
8. [全部导出格式详解](#8-全部导出格式详解)
9. [复制与知识库工作流](#9-复制与知识库工作流)
10. [设置中心（Options）](#10-设置中心options)
11. [本地库直写](#11-本地库直写)
12. [长图卡片](#12-长图卡片)
13. [离线含图 ZIP 与 LaTeX 源码](#13-离线含图-zip-与-latex-源码)
14. [快捷键与交互](#14-快捷键与交互)
15. [隐私与安全](#15-隐私与安全)
16. [故障排查](#16-故障排查)
17. [开发者命令](#17-开发者命令)

---

## 1. 它是什么

ChatSavor 是一款把 AI 对话内容高质量导出为 Markdown、Word、PDF、LaTeX、离线网页与高清长图的 Chrome 扩展。它解决三类痛点：

- **保真**：数学公式还原为可编辑的 LaTeX / Word 原生公式（OMML），表格、代码块、矢量图表、交互卡片都能结构化保留；
- **多格式**：一次点击可选 6 种文档格式 + 单文件离线 HTML + 离线含图 ZIP + 3 主题高清长图；
- **离线**：所有转换、渲染、打包、公式转换均在本地完成，无外部网络请求。

---

## 2. 安装与更新

1. 打开 Chrome，访问 `chrome://extensions/`；
2. 开启右上角 **开发者模式**；
3. 点击 **加载已解压的扩展程序**，选择仓库中的 `chrome-extension` 文件夹；
4. 工具栏出现 ChatSavor 图标即安装成功。

**更新**：源码变动后，在 `chrome://extensions/` 点击 ChatSavor 卡片的 **重新加载**。自 2.0.4 起，扩展升级会自动重新连接已打开的受支持标签页，通常无需手动刷新网页。仅修改磁盘文件不会更新已在运行的页面脚本。

> 仓库中的 `.crx` 是独立安装包，不会随源码自动更新；测试最新修复请始终加载 `chrome-extension` 文件夹。

---

## 3. 快速开始：3 步导出一条回复

1. 打开任意受支持平台的对话页面（见下表），等待 AI 回复生成完毕；
2. 约 2–4 秒后，回复末尾出现**双联胶囊按钮**（`导出 / 预览` + `复制 MD`）：
   - 点 `复制 MD` → 一键把该条回复以 Markdown 复制到剪贴板（含 Frontmatter 时自动附带）；
   - 点 `导出 / 预览` → 打开工作台，选择格式与主题；
3. 在工作台底部选择导出格式，或复制 Markdown / 富文本。

---

## 4. 支持的平台

内置 **13 个专用适配器** + 通用扫描器：

| 类别 | 平台 |
|---|---|
| 海外 | ChatGPT（`chatgpt.com` / `chat.openai.com`，含新版列表布局）、Claude、Gemini、Google AI Studio、Perplexity、Grok（`grok.com` 及 `x.com/i/grok` 的 SPA 路由）、Poe |
| 国内 | DeepSeek、豆包、Kimi、腾讯元宝、智谱清言（ChatGLM）、通义千问（Tongyi）、Qwen |

其他站点可通过设置中心的**自定义站点规则**（JSON）指定域名与 CSS 选择器，由通用扫描器识别。

---

## 5. 四种内容提取方式

| 方式 | 入口 | 适用场景 |
|---|---|---|
| 单条回复 | 回复末尾胶囊按钮 | 只需某一条回答 |
| 最新回复 | 工具栏弹窗 `转换最新回复` | 快速抓取最后一条 |
| 整场对话 | 弹窗 `导出整场对话` | 多轮问答一次性导出，自动标注 `👤 User` / `🤖 Assistant`，并把回答中的参考链接汇总为文末脚注 `[^n]` |
| 多选回复 | 弹窗 `多选回复导出` | 勾选若干条后按文档顺序合并；支持 `全选` / `仅选 AI 回复`，`Esc` 退出 |
| 划词转换 | 弹窗 `转换网页中选中的内容` | 页面未识别时的兜底方案 |

---

## 6. 页内胶囊按钮

- 浅色 / 深色双主题自动适配站点；
- `导出 / 预览`：打开工作台；
- `复制 MD`：一键复制 Markdown（成功后显示 `✓ 已复制`）；
- 流式生成时按钮会等文本稳定后出现，避免转换到半截内容；
- 页面重渲染把按钮移除后，下次扫描会自动补回，不会产生重复按钮。

---

## 7. 预览与导出工作台

点 `导出 / 预览` 打开弹窗：

- **顶栏**：标题（普通 / 整场对话 / 多选模式）、字符与轮次统计、宽屏切换、浅/深色主题切换、关闭；
- **标签页**：`预览` / `Markdown` / `公式 (N)`；
  - `Markdown` 页可直接编辑源码（防抖实时刷新预览与公式列表）；
  - `公式` 页每条公式可单独复制纯 LaTeX（便于粘贴到 Notion 公式块）；
- **思考过程**：若平台含 CoT 深度思考，可切换 `隐藏思考` / `折叠思考` / `Obsidian Callout` 三模式；
- **Frontmatter 拨杆**：控制 `.md` / ZIP / 本地库 / Obsidian 导出是否附带 YAML 元数据头；
- **两层底栏**：
  - 上层：复制 Markdown / 复制富文本 / 发送到 Obsidian / 保存到本地库 + 长图主题胶囊（复制长图 / 下载长图）；
  - 下层：`导出文档` 分组的 6 个格式按钮：`.md` / `.pdf` / `.docx` / `.tex` / `.html` / `.zip (离线含图)`。

---

## 8. 全部导出格式详解

| 格式 | 说明 |
|---|---|
| `.md` | 纯净 Markdown，可选 YAML Frontmatter（标题、平台、来源、导出时间、标签）；文件名格式 `YYYY-MM-DD_平台_标题.md` |
| `.pdf` | 扩展独立打印页：`@page { size: A4; margin: 0 }` + 多页重复 `thead/tfoot` 18mm 安全留白，彻底隐藏浏览器自带 `chrome-extension://…` 页脚；可选无页脚 / 来源与时间 / 自定义页脚；支持内联 SVG 矢量水印（无 / 全页斜向平铺 / 右下角标，可调文案与浓度）；自动等待外链图片加载解码后再唤起打印 |
| `.docx` | 零依赖原生 OOXML；多格式原生可编辑公式（`<m:oMath>` / `<m:oMathPara>`）；复杂公式（分式、上下标、根式、∑/∏ 大型运算符、矩阵）结构化；图片光栅化为高清 PNG 嵌入 `word/media/`，表格自适应 9026 dxa、`TableHeader` 表头、代码块底纹、有序/无序列表；含 SVG/WebP/外链图时自动走异步高清嵌入管线 |
| `.tex` | Overleaf 可用：`% !TEX program = xelatex` + `\documentclass[11pt,a4paper]{ctexart}`，自动转义特殊字符并**保留公式源码零破坏**；表格为 `booktabs` + `longtable` 跨页三线表；含非 ASCII 中文的代码块自动用 `verbatim` 环境 |
| `.html` | 单文件离线网页，完整内联排版样式，自动跟随系统浅/深色 |
| `.zip (离线含图)` | Markdown + `assets/` 目录下所有图片的离线归档包；Data URI 本地解码，外链图经后台抓取（失败保留原 URL 不中断），采用 UTF-8 文件名标志位打包，Windows / macOS 中文文件名不乱码 |

---

## 9. 复制与知识库工作流

- **复制 Markdown** / **复制富文本**（HTML + 纯文本双通道）；当前浏览器不支持图片剪贴板时会提示改用“下载长图”；
- **Obsidian**：`发送到 Obsidian` 通过 `obsidian://` URI 一键入库，可配置 Vault 名与保存子目录；超长内容自动提示改用 `.md`；
- **Notion**：优先试“复制富文本”，或导入 `.md`；未识别公式时在“公式”页复制纯 LaTeX，粘贴到 Notion 行内公式（`Ctrl/Cmd+Shift+E`）或 `/math`；
- 公式优先从 KaTeX / MathJax 提取原始 TeX，保留上下标、反斜杠、多行与矩阵；不支持的命令显示源码与提示，不静默丢弃。

---

## 10. 设置中心（Options）

从弹窗齿轮按钮进入，或访问扩展详情的“扩展选项”：

| 分组 | 配置项 |
|---|---|
| Markdown / 知识库 | 默认 Frontmatter 开关、默认 CoT 策略（隐藏 / 折叠 / Callout）、Obsidian Vault 名与保存目录、本地库文件夹绑定/解绑 |
| 界面与 PDF | 默认弹窗主题（跟随系统 / 浅色 / 深色）、本地历史记录开关、PDF 页脚样式与自定义文字、PDF 水印样式与文字 |
| 数据管理 | 自定义站点规则 JSON 编辑器（保存 / 导出 / 导入） |
| 历史记录 | 最近 50 条导出记录，关键词全文检索、复制、下载 `.md`、二次预览、单条删除 / 清空全部 |

基于 `chrome.storage.local` + `storage.onChanged`，设置修改后所有已打开的聊天标签页**免刷新即时生效**。

---

## 11. 本地库直写

1. 在设置中心点 `选择本地文件夹`，用浏览器的目录选择器授权一个笔记库目录；
2. 回到任意回复工作台点 `保存到本地库`：
   - 权限已授予 → 后台**静默**写入 `<目录>/<filename>.md` 与带笔记前缀的 `assets/` 图片；
   - 首次或重启后权限待确认 → 打开 `writer.html`，点一次授权按钮完成写盘；
3. 严格过滤 `..` 路径穿越；写入完成后自动清理临时会话缓存。

---

## 12. 长图卡片

在底栏的长图胶囊中选择主题：`极简白` / `深邃夜` / `学术暖纸`：

- `复制长图`：生成 `ClipboardItem({ 'image/png': blob })` 写入剪贴板；
- `下载长图`：单张 `.png`；内容超过 3600 CSS px 时按块级间隙智能切为多片并自动打包 `_cards.zip`；
- 严格 1:1 视口不变量（SVG `width/height/viewBox` 与 `canvas` 尺寸一致），2× Retina 高清，绝不纵向拉伸；无排版引擎时回退精确估算；外链图自动内联为 Base64，防止 `<foreignObject>` 丢图与画布污染。

---

## 13. 离线含图 ZIP 与 LaTeX 源码

- **ZIP**：`.zip (离线含图)` 把 Markdown 与图片一并打包，图片统一放 `assets/`，外链抓取失败保留原 URL 并在状态栏提示数量；
- **LaTeX**：`.tex` 输出完整可编译文档，所在科研工作流：下载 `.tex` → 上传到 Overleaf → 用 XeLaTeX 编译；单遍转义特殊字符保证正文不被二次转义，公式源码原样保留。

---

## 14. 快捷键与交互

| 操作 | 效果 |
|---|---|
| `Esc`（工作台内） | 关闭预览弹窗 |
| `Ctrl/Cmd + Shift + C` | 工作台内一键复制 Markdown |
| `Esc`（多选模式） | 退出多选并还原页面元素样式 |
| 胶囊 `复制 MD` | 单条回复一键复制 |

---

## 15. 隐私与安全

- 所有渲染进 DOM 或导出为 HTML/Word 的内容都经 `sanitizeHtml()` 净化；恶意 `<svg>`（含脚本 / 事件 / `javascript:` / 残缺 XML）会被剥离；
- 诊断信息严格脱敏：聊天正文与完整对话 URL 不会出现在检测结果、错误日志或后台报告中；
- 零外部 CDN / 字体 / API 请求，全部转换在本地完成；
- 可选外链图抓取仅在用户主动导出离线含图包时按需授权 `http(s)` 权限，默认安装不请求该权限。

---

## 16. 故障排查

| 现象 | 处理 |
|---|---|
| 回复末尾没有按钮 | 等待 2–4 秒；确认当前域名在支持列表；点击弹窗 `重新连接页面并显示按钮`；检查站点访问权限 |
| 更新后按钮仍是旧版 | 在 `chrome://extensions/` 重新加载扩展；仍不行点弹窗“重新连接页面” |
| 公式显示为源码 | 该公式语法可能不受当前 KaTeX 支持，源码已保留；到“公式”页复制 LaTeX 手动粘贴 |
| Notion 公式未自动转换 | 使用“公式”页复制纯 LaTeX，粘贴到行内公式或 `/math` |
| PDF 底部出现扩展 URL 页脚 | 确认使用的是本扩展打印页（默认 `@page margin:0` 会隐藏浏览器页脚） |
| Word 图片显示为乱码 | 已修复：图片走异步 PNG 嵌入管线；确保更新到含该修复的版本 |
| 扩展弹窗显示“转换脚本加载不完整” | 点击“重新连接页面并显示按钮”，或重新加载扩展 |
| 仍无法定位 | 弹窗点 `复制检测结果` 反馈（不含聊天正文与网址） |

---

## 17. 开发者命令

在 `chrome-extension` 目录：

```bash
npm ci                       # 安装开发依赖
npm test                     # 全量单元测试（node --test + jsdom）
npm run check:version        # 校验 package/manifest/bridge 版本一致
npm run sync:version         # 以 package.json 为准同步版本号
npm run vendor:math          # 同步打包 KaTeX 及许可证
```

浏览器加载扩展**不需要**这些开发依赖。当前测试基线为 **207/207 通过**。

---

> 本使用指南同时嵌入在项目根目录 `README.md` 中，二者内容保持一致。
<!-- USER_USE_EMBED_END -->

---

## 图标说明

`chrome-extension/assets/` 目录提供 `icon16.png`、`icon48.png`、`icon128.png` 及矢量源 `icon.svg`。
