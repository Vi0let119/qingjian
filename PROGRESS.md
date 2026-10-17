# 轻笺 —— 进度日志

> 完整实现计划见 [plan.md](./plan.md)。本文件记录**已完成/进行中/下一步**，供后续会话续接。

## 当前状态（2026-10-02，界面字体缩放 + 编辑器视图缩放）

**✅ 通用设置第二项：界面字体大小 + 编辑器 Ctrl+滚轮视图缩放**：
- `AppSettings` 加 `uiFontScale`（CSS zoom 倍率）；`settings_set` 落盘后广播 `settings://changed`（Rust 端 Emitter，参照 theme://changed 模式）
- `ThemeProvider` 加载/监听该设置，应用到 `documentElement.style.zoom` —— 三个窗口共用 ThemeProvider，改一次全窗口即时同步
- 设置窗口"通用设置"加滑杆（85%–150%，步进 5%，"标准"复位）；本地即时显示 + 350ms 防抖落盘 + 卸载 flush（settings_set 每次写文件+广播，拖动不能逐格落盘）
- 编辑器视图缩放：`useEditorZoomStore`（窗口级 zustand，切标签共享，50%–200% 步进 10%）；TipTapEditor 滚轮监听加 ctrlKey 分支（preventDefault 拦 WebView2 整页缩放）+ Ctrl+0 复位 + 底部居中百分比徽标（900ms 淡出）
- **坑**：编辑器 zoom 必须放在 `.qj-editor-scroll`（滚动容器）本身，不能加中间包裹层——`.qj-editor-content` 的 `min-height:100%` 依赖直接父级，包一层空文档会丢稿纸纹理全高填充
- 测试：前端 40/40（+4 缩放用例）+ Rust 40/40 + tsc/vite 干净

## 当前状态（2026-10-01，启动界面可配置）

**✅ 启动默认"新增碎片"窗口 + 通用设置首项落地**：
- 启动行为：tauri.conf.json 主窗口改 `visible: false`；lib.rs setup 读 `settings.json` 的 `startupWindow`（缺省 `fragment`）——`fragment` 时 Rust 侧 `WebviewWindowBuilder` 建 label `fragment-boot` 碎片窗口（380×320，fragment.html），主窗口保持隐藏；`main` 时 `show()+set_focus()`，行为同旧版
- 碎片窗口 header 新增"房子"按钮 → 打开主界面：`getByLabel("main")` 存在则 `unminimize+show+setFocus`，被关过则按当前主题效果重建（复用 Sidebar.openSettingsWindow 模式，1100×720）；碎片窗口保持打开
- 设置窗口新增"通用设置"区（左列，非主题预览体系，改动即存）：启动时显示 新增碎片/主界面；走预留的 `settings_get/settings_set`（AppSettings 加 `startupWindow` 字段，合并逻辑抽 `merge_settings` + 单测）
- 僵尸进程守卫：lib.rs Destroyed 钩子末尾加"零可见窗口即 `exit(0)`"（隐藏主窗口不算存活），碎片模式下关掉碎片不会残留进程
- capabilities 新增 `core:window:allow-show` / `core:window:allow-unminimize`
- **后续调整（10-02）**：`fragment-boot` 点"打开主界面"后自动关闭自己（普通碎片窗口仍保持打开）。顺序关键：必须先 show 主窗口再 close——守卫会把"全隐状态"判为退出；运行时验证 `destroyed=fragment-boot, any_visible=true → 存活`。守卫处留了 `#[cfg(debug_assertions)]` 的 [qj-debug] 日志（dev 构建可见，release 无）
- **坑**：项目目录从 `Project/标签` 重命名后，`target/` 缓存内嵌旧绝对路径导致 build script 失败（`failed to read plugin permissions ... 标签\...`）——`cargo clean` 后恢复
- 测试：前端 36/36 + Rust 40/40（含新增 2 例）+ tsc/vite 构建干净；运行时冒烟验证两种启动模式与守卫退出均正常（tauri dev 首跑闪退为 vite 冷启动竞态，非逻辑问题）

## 当前状态（2026-08-23，第五轮功能完成）

**✅ 图片灵感主题 + 全窗口背景图功能验收完成**：
- 5 套新预设（朱樱/暮霞/沉蓝/暖橘内容区带图 + 墨黑纯黑金；图片压缩 ≤250KB 绕 IPC 响应限制）
- 全窗口背景图：壁纸 + 全模块毛玻璃（嵌套模块去重叠加）、用户选图走前端 canvas 缩放
- 布局修复系列：设置窗口列滚动（模块内容层转 flex）、列表滚动预防（min-height:0）、分隔条改悬浮边界（面板无缝、拖动保留）、嵌套毛玻璃防纯白
- 测试：前端 36/36 + Rust 38/38 + tsc 干净

### 本轮（审计轮）修复

1. **附件删除不彻底** → 删除笔记/笔记本/当日碎片时，自动清理**不再被任何笔记或碎片引用**的附件图片（全库扫描引用，共享引用保留；防路径逃逸）。测试覆盖共享/孤儿场景。
2. **崩溃残留临时文件** → 启动时递归清理数据目录中 `.tmp-*` 残留（原子写 create 与 rename 之间被杀时产生）。
3. **前端内存泄露** → `dataUriToRel` 注册表与 `absToDataUriCache` 加 300 条容量上限（data URI 是大字符串，逐出最旧条目）。
4. 其余审计结论：Rust DailyState 会话注销完整、前端所有监听器（wheel/事件/read）均有清理、编辑器实例随标签销毁——无其他泄露点。

### 审计结论摘要

- 内存：唯一实质风险是 data URI 注册表（已限容）；其余链路均有正确清理
- 文件：唯一不彻底点是附件与临时文件（已修复）；笔记/主题/碎片文件删除本身完整

### 打包（M6 完成 ✅ 2026-08-16 深夜）

- **安装包**：`src-tauri\target\release\bundle\nsis\轻笺_0.1.0_x64-setup.exe`（2.1MB）
- **单文件**：`src-tauri\target\release\qingjian.exe`（8MB，免安装直接运行）
- 备注：NSIS 工具下载需镜像 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://ghproxy.net/https://github.com`（国内直连 GitHub 超时；用户已同意使用该镜像）

### GitHub 发布 ✅（2026-08-16 深夜）

- 仓库：**https://github.com/Vi0let119/qingjian**（public，main 分支 = 干净单提交）
- gh CLI 已安装并登录（账号 Vi0let119）；git 全局代理已配（127.0.0.1:6789，Clash）
- 推送命令（之后更新代码）：`export HTTPS_PROXY=http://127.0.0.1:6789; git push`（仓库内直推即可，git 代理已全局配置）
- 可选后续：仓库页补 Description、Release 上传安装包（target/release/bundle/nsis/轻笺_0.1.0_x64-setup.exe）

### 全部里程碑完成 ✅（M0-M6）

安装包测试要点：安装 → 桌面快捷方式启动 → 新建笔记/粘贴图片/碎片/主题切换 → 数据在 %APPDATA%\轻笺\。

### 完整功能清单（验收完毕）

笔记 CRUD/自动保存/富文本(字号B/I/U)/图片粘贴插入/三种排序/内容全文检索(命中定位+高亮)/笔记本管理/每日碎片(多窗并发/当日整合/跨午夜/历史浏览/按天删除/图片)/主题引擎(5预设+自定义方案保存删除/模块级背景图虚化纯色文字色/WCAG对比度/窗口Mica亚克力/渐变底色)/分栏拖拽(可收起,记忆)/快捷键(Ctrl+N/F/S)/首次启动教程/自定义SVG图标集/关窗落盘/确认框单例

### 调试环境备忘

- 启动：`export PATH="$HOME/.cargo/bin:$PATH"; cd "D:\虚拟C盘\Project\标签"; npm run tauri dev > /tmp/qingjian-dev.log 2>&1 &`
- 杀进程：`taskkill //F //IM qingjian.exe` + 杀 1420 端口进程
- Playwright mock 调试法已建好（/tmp/inspect_*.py 模式：__TAURI_INTERNALS__ mock + 元素测量），后续 UI 问题可复用

### 本轮修复的根因（第四轮，git 历史可查）

1. **图片裂图** → asset:// 自定义协议在 dev 页面下不可靠 → 改为 **data URI 显示通道**：粘贴时前端 FileReader 转 data URI 即时显示 + Rust `import_attachment` 落盘并登记 dataURI→相对路径映射；加载时 `read_file_as_data_uri`（路径校验在数据目录内）转回；保存时映射回相对路径。主题背景图同通道。
2. **图片粘贴后保存静默失败**（真凶）→ TipTap Image 的 `alt` 默认 **null**（非 undefined），`const { alt = "" }` 解构默认值对 null 不生效 → `state.esc(null)` 抛 `Cannot read properties of null (reading 'replace')`，且当时 serializeMarkdown 在 try 块**外** → 异常吞掉、无任何提示。修复：`??` 替代解构默认值 + serialize 移入 try + 回归测试（无 alt 图片）。
3. 之前各轮：serde internally-tagged 枚举字段 rename、window 权限 allow-close/destroy、DailyBrowser 异步门控、ModuleSurface 绘制底色、preview 竞态等（见 git log）

### 已移除的临时设施

- 诊断探针全部移除（qj_log 命令、save_note/read_note eprintln、前端 qjLog 调用）
- **保留**：env_logger（Rust 内部错误日志可见）、update-firing.test.ts 与无 alt 回归测试

### 剩余验收（用户侧）

- [ ] 关闭并重新打开含图笔记 → 图片仍显示（data URI 加载链路）
- [ ] 主题：设置"内容区"背景图/雾化/纯色 → 预览 + 应用 + 重启保持
- [ ] `npm run tauri build` 打包 NSIS（M6 最后一项）

### 关键坑备忘（全部踩过，勿重蹈）

- TipTap Image alt/src 默认 **null**：一律 `??` 处理
- serialize 类操作必须在 try 内，否则静默死亡
- Tauri 2 Windows 的 convertFileSrc 产出 http://asset.localhost（dev 下不可靠）→ 图片显示走 data URI
- serde internally-tagged 枚举 rename_all 不作用于字段
- core:window:default 不含 allow-close/destroy/set-focus
- onCloseRequested 禁止 preventDefault+destroy 组合；JS 监听器存在时 Rust 先 prevent，靠 JS destroy（需权限）收尾
- IPC 参数 Uint8Array 会被 JSON stringify 成对象 → 用 Array.from

### 已修复的关键问题（git 历史可查）

1. cargo 依赖下载慢 → rsproxy 镜像（用户同意，~/.cargo/config.toml）
2. `assetProtocol` 需 tauri feature `protocol-asset`（Cargo.toml）
3. Tauri 2.11 **没有 `on_webview_window_ready`** → Builder 级 `.on_window_event(|window, event|)`；`app_handle().state()` 直接返回 `State`；窗口效果在 setup 对已有窗口 + JS 建窗传 windowEffects
4. **pathdiff 根因 bug**：attachments 与 notes/daily 是兄弟目录，原实现错误要求 from 是 target 祖先 → 已改为正确的手写相对路径算法（公共前缀 + `..`×剩余段）
5. **测试环境竞态**：QINGJIAN_DATA_DIR 跨模块竞态 → paths.rs 全局共享 `TEST_ENV_LOCK` + 所有测试用 `unwrap_or_else(|e| e.into_inner())` 防毒化
6. 其余小修：modified_millis Result 链、cfg.name move、NoteMeta Debug、并发测试 Arc<DailyState>

### 待办（E2E 验收，plan.md §八）

- [ ] 用户实测：新建笔记本/笔记、编辑富文本（B/I/U/字号）、自动保存
- [ ] 图片：粘贴/选择 → 打开 md 验证相对路径 → 重启 → 重命名笔记本后仍显示
- [ ] 多碎片并发：3 窗口连续输入 → daily/当日.md 3 个 section 无交错；关窗重开旧内容保留
- [ ] 主题：设置窗口改模块配置预览 → 应用后全窗口生效；Mica 可见性截图确认；对比度警告
- [ ] 中文路径全链路
- [ ] `npm run tauri build` 打包 NSIS
- [ ] （M6 遗留）窗口状态记忆（可选）

### 调试环境

- dev 进程若被误杀：`export PATH="$HOME/.cargo/bin:$PATH"; cd "D:\虚拟C盘\Project\标签"; npm run tauri dev`
- 数据目录删除即重置：`rm -rf "$APPDATA/轻笺"`（会丢全部数据！）

### 环境（已就绪）

- Node v24.16.0 / npm 11.13.0
- Rust：rustup 1.29.0 + **stable 1.97.1**（bash 中 `export PATH="$HOME/.cargo/bin:$PATH"`）
- MSVC：VS2022 Community 14.41（cargo 自动定位）
- WebView2 系统自带；git 仓库已初始化（本地提交）

### 里程碑状态

- **M0 ✅**：脚手架、图标（icon-source.svg → tauri icon 全套）、git init、Vite 三入口、capabilities、assetProtocol scope。**尚未实测 `npm run tauri dev` 弹窗**（依赖 Rust 编译完成）
- **M1 ✅（代码）**：`storage/{paths,sanitize,atomic}.rs` + `commands/notes.rs` 全量 CRUD + 测试已写；**cargo test 未跑**（编译阻塞）
- **M2 ✅（代码+测试）**：TipTap 2.11 装配、FontSize 扩展、**决策门通过**（tiptap-markdown 0.8.10 HTMLMark 兜底 + Image closeBlock 修复，6/6 fixtures 绿，无需手写 serializer）、主窗口三栏 UI（Sidebar/NoteList/NoteTabs）、zustand store、自动保存 debounce + 切标签 flush
- **M3 ✅（代码+测试）**：`commands/attachments.rs`（剪贴板字节 + dialog 路径两条导入、相对路径按引用方深度计算、防逃逸删除）、`lib/paths.ts` src↔rel 互转（8 测试绿）、NoteEditorPane 接线
- **M4 ✅（代码+测试）**：`storage/section_store.rs` marker-splice 引擎（注册/保存/注销/跨午夜/外部编辑保留，6 并发测试已写）、`commands/daily.rs`、fragment 入口 + FragmentWindow（精简编辑器 + 400ms 自动保存）、主窗口"新建碎片"/"每日碎片"入口 + DailyBrowser 只读浏览、lib.rs Destroyed 钩子
- **M5 ✅（代码+测试）**：`theme/{model,mod}.rs`（ThemeConfig serde + 校验 + 内置 botanical-garden 预设 include_str + ThemeState 加载/应用/广播 + set_effects）、`commands/theme.rs`（get/apply/list_presets/reset/import_background/settings）、前端 ThemeProvider（tokens→:root + theme://changed 订阅 + 效果激活时 body 透明）、ModuleSurface（背景图/雾化/纯色/文字色 + data-has-image 子面板透明 + frost 兜底）、contrast.ts（WCAG 9 测试绿，**实测：蕨绿#4a7c59 在米白底对比度 4.38，仅适合 UI 元素；正文 token #2b2b28 达标**）、设置窗口（预设卡/效果选择/模块定制/对比度徽标，预览→应用广播）
- **M6 部分 ✅**：CSP 已配（生产用）、图片 `loading="lazy"`、快捷键 Ctrl+N/Ctrl+Shift+N/Ctrl+S、主窗口 CloseRequested flush 后 destroy。**未做**：tauri build 打包、端到端实测、窗口状态记忆（可选，计划中列为可选项）

### 当前阻塞：cargo 首次编译

`cargo check` 已在后台运行 ~1 小时，**crates.io 稀疏索引下载极慢**（30MB 索引元数据、0 个 .crate 包）。国内网络直连 crates.io 就是这个速度。两个选择：
1. **rsproxy 镜像**（推荐，需用户授权）：`~/.cargo/config.toml` 写 `[source.crates-io] replace-with = "rsproxy-sparse"` + `registry = "sparse+https://rsproxy.cn/index/"`。曾尝试自动配置被权限分类器拦截（第三方镜像需用户明确同意）
2. 继续等（按当前速率可能还需数小时）

**续接会话第一步**：检查 cargo 是否完成 → 没完成就问用户是否配 rsproxy → 完成后按顺序执行：
```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd "D:\虚拟C盘\Project\标签"
cargo test --manifest-path src-tauri/Cargo.toml    # M1+M4 的 Rust 测试
npm run tauri dev                                   # M0 验收：中文路径下弹窗
```

### 端到端验收清单（弹窗后逐项过，见 plan.md §八）

1. 多碎片并发（3 窗口连续输入 → 当日 md 3 个 section 无交错；杀进程文件有效）
2. 跨午夜迁移（改系统时间测试）
3. 图片：粘贴/选择 → md 相对路径 → 重启显示 → 重命名笔记本后仍显示
4. 主题：预设切换全窗口生效、Mica 可见（截图）、effect=none 回退、模块组合矩阵、对比度警告
5. 中文路径全链路（笔记本名"日记"等）
6. `npm run tauri build` 出 NSIS 安装包

### 重要实现细节备忘（下次会话别再踩）

- **tiptap-markdown 0.8.10**：`new Markdown()` 不接受 extensions 选项；mark 序列化靠 HTMLMark 兜底（renderHTML 往返）；Image 必须自定义 serialize 调 `state.closeBlock(node)`（见 markdown.ts createImageExtension）
- **Tauri 2 窗口效果**：JS 建窗 options 用 `Effect.Mica/Effect.Acrylic` 枚举 + `EffectState.Active`（字符串字面量过不了 TS）；效果需要 transparent:true + body 透明；Rust 侧 `on_webview_window_ready` 里 set_effects 才可靠
- **WebView2 无 window.confirm/alert/prompt** → `lib/confirm.ts` 自定义确认框
- **serde**：返回结构体都加了 `#[serde(rename_all = "camelCase")]`；AttachmentBase 用 tag="kind" 枚举
- **rust 测试环境变量竞态**：各测试模块用 `static ENV_LOCK: Mutex<()>` 串行化 QINGJIAN_DATA_DIR 操作
- **文件布局**：frontend src/ 与 src-tauri/ 平行；`npx tauri icon icon-source.svg` 可重生成图标

### 提交记录（git log --oneline）

1. `M0: 脚手架（...）`
2. `文档：完善 plan.md 完整实现计划 + PROGRESS.md 进度日志`
3. `M2: 编辑器扩展 + 决策门测试通过 + 主窗口三栏 UI`
4. `M3+M4: 附件导入 + 每日碎片（marker-splice 引擎+碎片窗口+历史浏览）`
5. `M5: 主题引擎（...）`
6. （M6 打磨未提交时本条更新）
