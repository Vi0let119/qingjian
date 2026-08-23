# 轻笺（QingJian）

轻量 Windows 便签应用：模块一（笔记本/笔记/日记富文本创作，主窗口标签页）+ 模块二（每日碎片多小窗记录，自动整合为按日期命名的 Markdown 文件）+ 可深度定制的主题系统（白色清新绿植默认主题）。

## 特性

- **轻量**：Tauri 2 + React，安装包约 10MB，内存占用约 50MB
- **数据透明**：所有内容存为 Markdown 文件 + 附件文件夹（`%APPDATA%\轻笺\`），可用任意编辑器打开、易备份
- **富文本**：加粗 / 斜体 / 下划线 / 字号（12–32px）/ 插入图片（剪贴板粘贴或选择文件，自动复制进附件目录）
- **每日碎片**：可多开的小窗口，输入即自动保存，当日所有碎片实时整合进 `daily\yyyy-MM-dd.md`；进程重启/崩溃不丢数据（标记块拼接 + 原子写）
- **主题系统**：默认 Botanical Garden（米白底 + 蕨绿点缀，参考 theme-factory skill）；每模块（导航栏/笔记列表/内容区/碎片窗口…）可独立设置背景图片、雾化模糊（0–30）、纯色覆盖；文字色自动对比度适配（WCAG）可手动覆盖；窗口级 Mica/亚克力效果；预设即插即用
- **自动保存**：防抖自动落盘，切换标签/关闭窗口强制 flush

## 开发

```bash
# 需要：Node ≥18、Rust stable（MSVC）、Windows 11（WebView2 自带）
npm install
npm run tauri dev      # 开发运行
npm run test           # 前端测试（vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 测试
npm run tauri build    # 打包 NSIS 安装包
```

## 目录结构

- `src/` — React 前端（三入口：主窗口 / 碎片窗口 / 设置窗口）
- `src-tauri/` — Rust 后端（存储 / 命令 / 碎片拼接引擎 / 主题引擎）
- `plan.md` — 完整实现计划；`PROGRESS.md` — 进度日志

## 数据目录

```
%APPDATA%\轻笺\
├── notes\<笔记本>\<标题>.md    笔记本 = 文件夹
├── daily\2026-08-15.md         每日碎片整合
├── attachments\2026-08\…       图片附件（按月）
└── settings\themes\            主题预设与当前生效主题（active.json）
```
