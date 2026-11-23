# 轻笺 —— 进度日志

> 完整实现计划见 [plan.md](./plan.md)。本文件记录**已完成/进行中/下一步**，供后续会话续接。

## ✅ 已修复（2026-11-20）：输入法候选窗跑到左上角 —— 根因是 wry 0.55.1 里的一行 MoveFocus

**结论修正**：11-09 那轮把这个问题判成「WebView2 上游无解、只能等微软」是**错的**。真正的根因在本项目依赖的 **wry 0.55.1** 里，上游已在 wry 0.57.2 修复，我们只是版本太旧没拿到。

**真正的根因**（`wry-0.55.1/src/webview2/mod.rs:1254`）：

```rust
WM_SETFOCUS | WM_ENTERSIZEMOVE => {
    let _ = (*controller).MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}
```

`WM_ENTERSIZEMOVE` **只在用户用鼠标拖动窗口边框缩放、或拖标题栏移动窗口时**由 Windows 的模态 size/move 循环发出。在这个时刻同步调 `MoveFocus(PROGRAMMATIC)` 会把 WebView2 的 TSF 状态打坏 —— 组字窗脱离光标、落到屏幕原点 (0,0)，页面收不到 `compositionstart`。**点最大化、Win+Up、F11 全屏都不走这条路**，所以那些操作下正常。

**症状对应关系（用户 2026-11-20 实测确认）**：

| 操作 | 是否走 `WM_ENTERSIZEMOVE` | 实际表现 |
|---|---|---|
| 默认窗口大小打字 | 否 | 正常 |
| 点最大化 / Win+Up 全屏 | 否 | 正常 |
| 拖边框缩放（横/纵/等比） | **是** | 错位到左上角 |
| 拖标题栏移动窗口 | **是** | 错位到左上角 |
| 已错位后再全屏 | 否（不重置状态） | 仍然错位 |
| 错位状态下点窗口内部 | — | **也恢复不了**（比 11-09 记录的更严重） |
| 错位状态下切走焦点再回来 | — | 能恢复 |

**为什么之前会误判**：#5675 的 stock repro 用的正是 tauri 2.11.5 / wry 0.55.1 这套坏版本，于是被当成了「纯 WebView2 缺陷」。实际上那行 `WM_ENTERSIZEMOVE` 才是主动施害者 —— 上游 wry PR [#1910](https://github.com/tauri-apps/wry/pull/1910)（2026-10-28 合并，进入 0.57.2）删掉它的提交说明写得很清楚：「移动窗口会让 webview 失焦再聚焦」（tauri issue [#10767](https://github.com/tauri-apps/tauri/issues/10767)），[wry#1924](https://github.com/tauri-apps/wry/pull/1924) 的实测数据也印证同步 `MoveFocus` 会打坏 TSF。

### 修复内容

把整个 Tauri 栈升到带修复的版本：

| 包 | 旧 | 新 |
|---|---|---|
| tauri | 2.11.5 | **2.12.7** |
| tauri-runtime-wry | 2.11.4 | **2.12.5** |
| **wry** | **0.55.1** | **0.57.3** ← 关键，`WM_ENTERSIZEMOVE` 已彻底移除 |
| webview2-com | 0.38.2 | 0.39.1 |
| tauri-plugin-dialog | 2.7.2 | 2.8.4 |
| @tauri-apps/api | 2.11.1 | 2.12.5 |
| @tauri-apps/cli | 2.11.4 | 2.12.6 |
| @tauri-apps/plugin-dialog | 2.7.2 | 2.8.4 |

`cargo check` 一次通过，**从 tauri 2.11 → 2.12 零 API 破坏**（`WebviewWindowBuilder` / `set_effects` / `WindowEvent::Destroyed` 全部兼容）。

**升级踩坑记录**：
- **cargo 走坏代理连不上 crates**：报错 `Could not connect to server (Failed to connect to rsproxy.cn port 443 via 127.0.0.1)`。原因不是 cargo 配置，而是注册表残留 `ProxyServer=127.0.0.1:6789`（代理软件已关、`ProxyEnable=0`，但 libcurl 仍读该值）。解法：命令前加 `CARGO_HTTP_PROXY=""`。
- **`cargo build --release` 编出的 exe 会加载 `http://localhost:1420`**（devUrl）而不是内置 dist —— 因为没带 `custom-protocol` feature。必须用 `npm run tauri build -- --no-bundle` 才得到自包含 exe（加载 `http://tauri.localhost/`）。
- **tauri CLI 有版本一致性校验**：Rust crate 与 npm 包必须同 minor，否则直接报错。升级 tauri 后必须同步 `@tauri-apps/api` / `cli` / `plugin-dialog`，且 `tauri-plugin-dialog` 的 Rust 侧版本也要和 JS 侧对齐（2.7.2 vs 2.8.4 会被拦下）。

### 验证结果（本轮已跑）

- `npm test`：**76 passed / 10 files**
- `npm run build`：通过（281 modules，dist 正常产出）
- `cargo test`：**42 passed / 0 failed**
- 隔离数据目录冒烟（`QINGJIAN_DATA_DIR` + `QJ_CDP_PORT`）：主窗口 / 碎片窗口 / 设置窗口三窗口全部创建成功；21 套主题正常列出；`--qj-primary=#317d59` 等主题变量正确写入；编辑器祖先链无 `zoom`/`filter`，`--qj-zoom=1`、`visualViewport.scale=1`、`dpr=1.5` 均正常。
- **源码层确认**：`wry-0.57.3/src/webview2/mod.rs` 里 `grep ENTERSIZEMOVE` **零命中**，只剩 `WM_SETFOCUS => { MoveFocus }`。

**待人工验证**：本机无法自动复现真实 IME 候选窗位置（CDP 的 `imeSetComposition` 走合成事件不经原生 TSF；`keybd_event` 会被抢焦点），必须由用户用真实微软拼音实测。验证包：`verify/轻笺_IME修复验证版.exe`（已 gitignore）。

### 历史记录（2026-11-09，结论已被本轮推翻，保留备查）

#### 〔已被推翻〕原 2026-11-09 排查记录：WebView2 上游 bug，不改代码

**症状**：窗口保持启动默认大小时，在内容区用中文输入法打字，候选窗跟随光标正常；**只要稍微拖动改变窗口大小，候选窗就跑到屏幕/窗口左上角 (0,0)**，之后一直错，直到拖一下窗口 / 在窗口内点一下 / 切走焦点再回来才恢复，下一次 resize 又复发。

**结论：不是本项目代码 bug，是 WebView2 宿主层的已知缺陷，官方未修。** 本轮不改动任何产品代码，仅存档。

**证据（版本栈与本项目完全吻合）**：
- [MicrosoftEdge/WebView2Feedback#5675](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675)「IME composition window jumps to the top-left of the screen after the host window is resized」—— 标题与症状逐字吻合。报告者填的环境是 **Tauri 2.11.5 / wry 0.55.1 / webview2-com 0.38.2**，与 `src-tauri/Cargo.lock` 完全一致。状态 **open、无官方修复**。明确写「Edge/Chrome 不复现，只有 WebView2」，且用 stock Tauri 空项目（普通 `<input>`、无自定义代码）即可复现。
- 本机实测环境：WebView2 Runtime 126.0.2592.113、微软拼音（zh-Hans-CN / 00000804）、系统 150% DPI（AppliedDPI=144）。用 CDP（`QJ_CDP_PORT=9333` + 隔离数据目录）确认 resize 后 `devicePixelRatio=1.5`、`visualViewport.scale=1`、页面 caret/布局尺寸均正常，编辑器祖先链无 `zoom`/`transform`/`filter` 改坐标系 —— 前端一切正常，问题在原生层。
- [MicrosoftEdge/WebView2Feedback#1611](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1611)：拖动窗口时候选窗不跟随（2021 起 open，微软内部 tracked）。
- [tauri-apps/wry#1908](https://github.com/tauri-apps/wry/issues/1908) + 修复 PR [wry#1924](https://github.com/tauri-apps/wry/pull/1924)：同应用**多窗口切换**触发同类 IME 错位，根因是 `WM_SETFOCUS` 里同步调 `MoveFocus` 破坏 TSF 状态；PR 用延迟/条件 MoveFocus 缓解。**触发条件是窗口切换，不是 resize，不能解决本问题。**

**上游报告者已排除的假设**（别重复排查）：子 HWND 几何滞后、主线程卡顿、页面 caret 位置错误、`MoveFocus(PROGRAMMATIC)`、`NotifyParentWindowPositionChanged()`（0–1100ms 内连调 10 次仍无效）。

**推测机制**（上游报告者的分析，未官方确认）：resize 后 caret 位置没有经 `InputMethodWinTSF::OnCaretBoundsChanged → TSFBridge::OnTextLayoutChanged → TSFTextStore::SendOnLayoutChange → ITextStoreACPSink::OnLayoutChange` 重新上报给 TSF，`GetTextExt` 一直返回过期/无布局矩形，输入法遂把组字窗落到屏幕原点。

**与历史修复的区别（重要，别混淆）**：2026-10-28 修过的「CSS `zoom` / `transform: scale` 改坐标系导致 IME 候选窗跑左上角」是另一根因（CSS 层），那次改成字号/行高/内边距相乘后已生效且至今仍在（`src/components/editor/editor.css`、`ThemeProvider.tsx`）。本次是 **resize 触发的原生层 TSF 通知缺失**，与前端 CSS 无关。

**规避方法（给用户）**：出现错位时，用鼠标拖一下窗口、点一下窗口内部、或切到别的窗口再回来即可恢复；Resize 之间尽量避免立刻开始中文组字。

**后续**：等 WebView2 / wry 官方修复（关注 #5675、wry#1924 是否合入并覆盖 resize 场景）或整体升级 Tauri/wry/WebView2 Runtime 后再验证。若将来要做应用层自动 workaround，应从「resize 结束后模拟一次被验证有效的窗口位置刷新」入手，且必须先用真实中文输入法实测候选窗屏幕坐标确认有效 —— 本轮未做、也未实施。

### 第二轮复查（2026-11-09 晚）：结论不变，确认「没有现成解法」

复查了上游 issue 状态、wry 补丁内容、WebView2 官方是否给出过 API 级规避，结论：**仍然没有可用的通用解法**。

- **#5675 仍 open、0 条评论**，8/18 提交后无任何维护者回应；无 assignee、无 milestone。同族的 [#1611](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1611)（2021 年，拖动窗口候选窗不跟随）打了微软内部 `tracked` 标签但 5 年未修；[#5570](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5570)（2026-04，RDP 场景）已指派 assignee 但同样无进展。说明这类 TSF 布局通知缺陷在微软侧长期处于「已记录、低优先级」。
- **[wry#1924](https://github.com/tauri-apps/wry/pull/1924) 补丁只改 `WM_SETFOCUS`**（把同步 `MoveFocus` 改成 `PostMessage` 延迟 + `GetFocus()` 条件判断），**完全不涉及 resize 路径**，即便合入也治不好本问题。PR 至今未 merge。
- **同族问题的最有效规避是「每个 webview 独立 user data folder」**（见 [#5799](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5799)：共用 user data folder 时 20 次切换失败 10 次，独立后 0 次）。但该结论是针对**窗口切换**场景；轻笺的主窗口/碎片/设置窗口共用一个浏览器进程正是为了共享主题状态与低内存占用，改成每窗口独立 user data folder 会显著增加内存与启动开销，且对本 bug 是否有效**未经证实**，不建议为此改动。
- `NotifyParentWindowPositionChanged()` 与 `MoveFocus()` 是官方仅有的「让 WebView2 重算坐标」的入口，**上游实测两者对 resize 场景均无效**（#5675 正文明确记录）。也就是说 WebView2 目前**没有暴露任何能强制刷新 TSF caret 布局的 API**。

**本轮实测过程（记录以备后来者）**：搭建了自动化验证链路 —— 用 `QJ_CDP_PORT=9333` 起隔离实例、CDP 真实点击进入编辑器、PowerShell 枚举 `Chrome_WidgetWin_*` / `MSCTFIME UI` / `CiceroUIWndFrame` 窗口坐标来判定候选窗是否落在 (0,0)。结论限制：**CDP 的 `Input.imeSetComposition` 走的是合成事件路径，不经过原生 TSF，因此无法用它判定候选窗真实位置**；而 `keybd_event` 模拟的输入会被本会话的前台窗口抢占（`GetFocus()` 恒为 0x0），也无法稳定复现。**这台机器上无法自动复现，只能由人工用真实输入法验证。** 若要自动化，需要一个不被其他窗口抢焦点、且能真实激活微软拼音的环境。

**给用户的结论**：目前只能靠「错位时拖一下窗口 / 点一下窗口内 / 切走焦点再回来」手动恢复。不是我们代码的问题，改 CSS 或改前端都无效。

## 当前状态（2026-11-23，v0.1.9 发布：气泡背景流动波纹）

**✅ 气泡视图背景：换成 WaveField 流动波纹**

参考 `wave-field/wave-field.js`（SnowLuma 控制台登录页动效）实现：一屏细竖线被 Perlin 噪声推动成缓缓流动的波纹，鼠标划过时邻近线条被推开、松开回弹。

- 移植为 TS：`src/lib/waveField.ts`（算法/默认值与参考实现一致，`Perlin` + `computeGrid` 为纯函数便于测试）
- 参数层：`src/lib/waveSettings.ts`（6 个可调参数 + 范围夹取 + 映射到 WaveField options）
- React 封装：`src/components/bubble/WaveLayer.tsx`；全局 store：`src/stores/useWaveSettings.ts`
- **颜色走 CSS**：`.qj-wave-layer { color: rgba(var(--qj-glow-rgb), 0.26) }`，21 套主题自适应，换主题即换色
- 设置界面新增「背景波纹（气泡视图）」区块：开关 + 5 滑杆 + 恢复默认，350ms 防抖落盘

**关键约束：波纹层必须在 `.qj-bubble-stage` 之外。** stage 上挂着拖拽平移/滚轮缩放的 `transform`，波纹若放进去会跟着气泡一起被拖动，"背景"属性就不成立了。层级安排：`.qj-wave-layer{z-index:0}` < `.qj-bubble-stage{z-index:1}`，且波纹 `pointer-events:none` 不抢画布事件。

**本轮踩的三个坑（都已修 + 加测试锁死）**：

1. **store 定义了 apply() 却没真正 listen 广播** —— 设置窗口改了参数、主窗口毫无反应。更阴险的是**看起来像在动**：噪声相位照常推进，draw 的 `d` 还在变，只有竖线数量纹丝不动（间距 10→24 仍 130 条）。教训：验证「参数生效」不能只看"画面变没变"，要数结构性指标（`M` 命令条数）。修法：`init()` 里先 `listen("settings://changed")` 再拉一次当前值，监听用模块级 promise 兜住幂等。
2. **参考实现的 `timeScaleX/Y` 从未参与计算** —— 从 options 解构出来却没用，`#step` 里把时间推进量写死成 `ts * 0.0125` / `ts * 0.005`，导致「流动速度」滑杆完全无效。改为走 `timeScale`（系数 5 和 6.6667，默认值下行为不变）。
3. **滑杆默认值不在步长序列上** —— `pointerRadius` 默认 175、步长 10，range 控件吸附显示成 180。真值没变，但用户一拖就永久改成吸附值。步长改 5，并加单测遍历所有参数校验「默认值落在 min + n*step 上」。

**验证**：
- `npm test` **93 passed / 11 files**（新增 17 项：网格几何、Perlin 确定性/可复现、参数夹取、倍率映射、滑杆范围一致性）
- `cargo test` **45 passed**（新增 3 项：`bubbleWave` 序列化、字段级合并、老配置无该字段兼容）
- `npm run build` 通过，`waveSettings` 独立分块 2.42 kB
- 端到端（CDP + 隔离数据目录，打包产物）：间距 10→24 时竖线 **130→56** 条；幅度变化改变几何；速度 0 时画面完全静止；开关关闭后 `d` 冻结、重开恢复动画；跨窗口同步实测（设置窗口拖到 20 → 主窗口变成 66 条）；「恢复默认」精确还原 175
- 打包产物本身验证：0.1.9 安装包启动后波纹正常渲染（130 条、`rgba(114,203,161,0.26)`），包内 `ProductVersion=0.1.9`

**发版踩坑：`github.com:443` 被阻断，`git push` 连不上**（`api.github.com` 正常，`gh` 全部可用）。直连 `Connection was reset`，走 `127.0.0.1:6789` 代理也会失败（代理软件没开）。最终用 GitHub Git Data API 手工重建 tree + commit + 快进 ref 完成推送：
```
POST /repos/{repo}/git/blobs      ← base64 内容
POST /repos/{repo}/git/trees      ← 递归重建目录树（需从父 commit 展平后逐层组装）
POST /repos/{repo}/git/commits
PATCH /repos/{repo}/git/refs/heads/main
```
注意两点：读本地 git 输出必须显式 `decode("utf-8")`（Windows 默认 GBK 会炸）；`git push` 的退出码要用 `${PIPESTATUS[0]}` 取，否则被管道里 `tail` 的 0 掩盖成假成功。

## 当前状态（2026-10-29，v0.1.5 发布：主题 21 套 + 滚动修复）

**✅ 主题扩到 21 套（v4：视频取色 12 套）**
- 做法沉淀成 skill `creative/color-palette-extraction`：
  **视觉模型读颜色名、像素采样定色值**。实测模型会把 `B4BB9F` 读成 `84BB9F`，
  面对纯色块视频还会凭空"读出"13 个根本不存在的 HEX
- 4 个 B 站视频 → 110 帧 → 像素采样 + OCR 交叉校验（48 色中 47 个吻合）
- 新增：明月珰 / 秋波蓝 / 普鲁士灰 / 栀子 / 十样锦（浅），
  普鲁士蓝 / 马尔斯绿 / 深酒红 / 克莱因蓝 / 魅夜 / 爱马仕橙 / 琥珀（深）
- 生成器守则：正文对比度 ≥ 7:1；品牌色优先于对比度数字——
  浅色品牌色不再为了凑阈值被压暗（栀子黄曾被压成暗金、十样锦被压成橘红），
  深色品牌色只调到"刚好可见"而不改色相（深酒红硬拉会变亮品红）
- 修 `PRESET_LABELS`：还停留在已删除的旧主题，v3 那 9 套一直显示英文 id

**✅ 修复：长笔记滚轮完全没反应**
- 根因不是滚轮监听器，是 `.qj-tabs-root` 缺 `min-height: 0`：
  flex 子项默认 `min-height: auto`，被内容撑到 3400px，
  `.qj-editor-scroll` 因此 `clientHeight === scrollHeight`（永不溢出），
  处理器的 `canDown/canUp` 双双 false → 事件原样放行
- 补 `.qj-tabs-root` 与 `.qj-module-content > *` 的 `min-height: 0`
- CDP 实测：容器 635 / 内容 3360，滚轮行模式 3 格 = 48px、连滚 600px 正常；
  Ctrl+滚轮缩放与三栏布局均未受影响

**✅ Cargo.toml 版本号归位**：之前一直停在 0.1.0（安装包名取 tauri.conf.json，未影响用户），
现 package.json / tauri.conf.json / Cargo.toml 三处统一 0.1.5

## 上一版（2026-10-28 傍晚，气泡视觉 v3 + 主题重做）

**✅ 主题体系重建（9 套）**
- 清掉旧 10 套预设，新做 9 套单一明度方案（深色系本身即暗色，不做亮暗开关）：竹青 / 米纸 / 雾蓝 / 沙汀 / 枯茶 / 棠红 / 苔紫 / 墨夜 / 玄青
- 全部通过对比度实测（bg/text 最低 5.93，最高 14.53）；枯茶、棠红、苔紫最初按浅底生成只有 2.21–3.43，已改为深底方案
- `ColorTokens` 新增 v3 扩展色板（全部 `Option`，兼容老自定义主题）：`desk` / `glow` / `bubble` / `bubbleEdge` / `ripple`
- `src/lib/themePalette.ts`：色板派生层，缺失字段按 primary/bg 推导，**颜色只有一个来源**

**✅ 修复：换主题后配色不统一**
- 根因：碎片窗口底色写死 `--qj-paper-*`（17 处），与主题 token 完全脱钩
- 现在 `--qj-paper-0/1/2`、`--qj-ink-100..900`、`--qj-desk`、`--qj-hairline` 全部由 ThemeProvider 按主题推导注入；
  `global.css` 只保留兜底值（主题加载前的一瞬）

**✅ 修复：升级后旧主题残留**
- `LEGACY_PRESETS` 一次性清理旧预设文件与 preset-bg 目录；`active.json` 指向已淘汰主题时自动回退到新默认（zhubamboo）
- 实测：把 active 指向 chenlan + 放回 10 个旧文件，启动后目录只剩 9 套新主题、active 变为 zhubamboo

**✅ 气泡视图 v3**
- 气泡只显示笔记本名（去掉数量副标题）
- 透明玻璃 3D：镜面高光 + 内上高光/内底反光 + 双层投影（接触影 + 悬浮影）+ `backdrop-filter` 透出画布柔光斑
- 画布是数码磨砂：主题桌面色 + 三道主题色柔光 + 噪点
- 滚轮缩放（0.6–2.0，以鼠标为锚点），左键拖拽平移，双击复位；缩到 70%/50% 以下分级关掉精致装饰
- 数码涟漪：Canvas 2D 同心波 + 环形刻度，波峰亮波谷暗模拟"背景被推起来"，只在波纹存活期跑 rAF
- 文字可读性：玻璃上的标题有主题纸色的柔光底，不再发虚

**✅ 布局：书写视图独占全窗**
- 点开笔记后无侧栏、无笔记列表；只留左下角约 88px 的玻璃悬浮条：返回气泡 / 新建 / 设置
- `openSettingsWindow` 抽到 `windows/main/openSettings.ts` 供侧栏与悬浮条共用

**✅ 修复：笔记本里只有 2 篇笔记时气泡缩成 25px、标题看不见**
- 根因：`centerFirst` 布局在 n=2 时启用，环上只剩 1 颗 → "自己和自己"求弦长，`sinHalf` 退化成下限 0.08，半径被推到 1057，`scale` 压到 0.274
- 修法：弦长约束要求环上至少 2 颗；`centerFirst` 下限提到 n>=3（2 颗时中心+1 只会是"一大一小两个孤点"）
- 补 2 条回归测试（尺寸不得 < 72px、2 颗不得退化成中心布局），反向验证过：回退修复后两条测试都失败

**✅ 气泡材质改为磨砂雾面**（用户指定：缩到最小时的简版更好看）
- 内部改均匀低透明填充 + `blur(18px) saturate(1.35)`，去掉大块白色高光和菲涅尔渐变——那套在满尺寸下像硬塑料球
- 只保留清晰单圈描边 + 顶/底极轻边缘光；悬停不再切回反光球，只加强轮廓
- 空气泡、缩小档统一成同一结构

**验证**：前端 49/49 + Rust 40/40 + tsc/vite 干净；CDP 实测滚轮缩放（scale 1→1.616）、下钻、书写视图（hasSidebar=false）、迁移清理、三个笔记本笔记气泡尺寸 120–127px。

> 截图注意：`PrintWindow` 抓带 `backdrop-filter` 的多合成层窗口会漏画（只显示部分气泡），
> 判断渲染是否正常要用 CDP `Page.captureScreenshot`。

## 上一轮（2026-10-28 下午，气泡视图初版）

**✅ 气泡视图（主视图，整窗画布）**
- 交互模型见 [docs/bubble-view.md](./docs/bubble-view.md)：气泡是**浏览与定位层**，点开笔记才展开成书写纸面。书写不用气泡——拖动/缩放会打乱光标与输入法选区。
- 三层：笔记本层（每笔记本一个气泡，大小随笔记数） → 笔记层（该笔记本的笔记气泡） → 书写层（气泡放大成纸面后进编辑器）。面包屑导航，Esc 逐层返回。
- 组件：`src/components/bubble/{BubbleCanvas,BubbleWorkspace}.tsx` + `bubble.css`/`workspace.css`；视图模式 `src/stores/useWsMode.ts`（默认气泡，可切列表，localStorage 记忆）。
- 动效：气泡逐个浮起（stagger 42ms）、hover 上浮 + 墨色渗入、点击涟漪扩散后切层、笔记展开时气泡放大成纸面（FLIP 式）、全部尊重 `prefers-reduced-motion`。
- **排布算法**：环形 + 中心锚点（2–5 个时第一个居中，避免环心空洞）；环半径由"相邻视觉直径和 + 间隙"的弦长约束反推，视口装不下时**整体缩小气泡而不是压小环**，最后再做一次迭代兜底。`BubbleCanvas.test.ts` 按**视觉尺寸**校验不重叠（渲染时放大 1.3 倍，只按逻辑尺寸校验会漏掉真实重叠）。
- 踩过的坑：① 气泡宽高被 `padding: 0 14%` + 全局 box-sizing 撑爆，实测 310px 而非 130px，气泡全部跑出画布 → 固定 box-sizing 与像素 padding。② `ModuleSurface` 无条件把 `tokens.color.surface` 写成内联背景，把三栏的纸页色阶盖平成一片白，叠层完全失效 → 无自定义背景时不写内联背景。
- 测试：前端 47/47（+4 排布用例）+ Rust 40/40 + tsc/vite 干净；运行时用 CDP 实测了下钻、展开动画、Esc 返回、画布拖动（位移 90/-60px）。

**✅ 窗口图标修复**：JS 创建的窗口（碎片/设置/重建主窗）不继承应用图标，任务栏是空白方块 → `src/lib/windowIcon.ts` 的 `applyWindowIcon()` 在创建后 `setIcon`，capabilities 加 `core:window:allow-set-icon`。

## 上一轮（2026-10-28 上午，输入法修复 + 界面精修）

**✅ 修复：中文输入法候选框跳到窗口左上角**
- 根因：用 CSS `zoom` 做缩放会改变元素坐标系，WebView2 计算 IME 候选窗位置时拿不到缩放映射 → 候选框落到 (0,0)。**`transform: scale` 同样有此问题，两者都不能用于可输入区域。**
- 编辑器视图缩放：改为 CSS 变量 `--qj-zoom` 乘字号/行高/内边距（`calc(1.18rem * var(--qj-zoom))`），坐标系不变。变量必须定义在 `.qj-editor` 根节点——定义在 `.qj-editor-scroll` 上时，兄弟节点工具栏的 `calc()` 会因变量未定义而整条声明失效。
- 界面字体缩放：`documentElement.style.zoom` → `style.fontSize = 14px * scale`，正文用 rem 跟随。
- **坑**：`ThemeProvider` 会把 `tokens.font.size` 写成 `body` 的**内联** `font-size`，内联样式压过 CSS 规则——必须用 `bodyFontSize()`（`src/lib/fontScale.ts`）手动与 scale 相乘，否则调大字号时只有编辑区变、正文不动。
- 验证方式：`QJ_CDP_PORT=9333` 启动后可连 CDP 在真实页面跑 JS（祖先链无 zoom/transform、字号精确倍数、IPC 广播全链路）。`QJ_FORCE_STARTUP=main|fragment` 可强制启动界面，便于自动化。

**✅ 界面精修（distinctive-ai-design 流程：真实截图 → 评审 → 减法）**
- 新增 `src/styles/refinement.css` 精修层：圆角/间距/边框/阴影刻度，三档文字层级（`--qj-ink-1/2/3`），结构边界改发丝线
- 碎片窗口：标题行只留一枚绿叶芽（原来窗口标题+行内叶芽重复），时间降一级；标题/工具栏/正文首字统一落在 16px 左轴；header 与工具栏之间的双分隔线合并为一条；占位文案对比度 0.55→0.85
- 主界面：logo 字距 0.28em→0.16em 解决拥挤；空状态标题/引导语层级重建；选中态左侧硬阴影改 2px 圆角短条
- 未采纳的评审建议（有理由）：移除稿纸点阵（属产品识别度）、加粗分隔线、给 `+` 按钮换语义（两个 `+` 分别属侧栏与笔记列表，非重复）
- 测试：前端 43/43（+3 字号用例）+ Rust 40/40 + tsc/vite 干净

## 上一轮（2026-10-02，界面字体缩放 + 编辑器视图缩放）

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
