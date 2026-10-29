//! 主题引擎（M5）：Rust 侧主题状态 + 广播 + 窗口效果应用。
//!
//! 状态共享决策：Rust 全局状态 + `theme://changed` 事件广播（不用 tauri-plugin-store——
//! store 是 JS 写文件模型、无跨窗口推送；主题源头唯一在 Rust，读写/校验/窗口效果都在这里）。
//!
//! 流程：theme_apply → 校验 → 持久化 active.json → 更新内存 → 对所有窗口 set_effects
//! → emit("theme://changed")；各窗口 ThemeProvider 初始 theme_get 后订阅事件即时换肤。

pub mod model;

use model::ThemeConfig;
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub struct ThemeState {
    pub config: Mutex<ThemeConfig>,
}

/// 内置预设（编译进二进制；首次运行复制到 themes/ 目录）
pub const BUILTIN_PRESET_RAW: &str = include_str!("../../themes/zhubamboo.json");

/// 全部内置预设（文件名, 内容）。新增主题 = 新增 JSON + 在此注册，前端零改动。
/// v3：9 套单一明度方案（深色系本身即暗色），每套都带气泡视图扩展色板。
/// v4：新增 7 套，色值取自配色视频（B 站「世界经典顶级撞色」「世界著名配色」等），
///     经像素采样校验后由 skills/creative/color-palette-extraction 生成。
pub const BUILTIN_PRESETS: &[(&str, &str)] = &[
    // ---- v3 原有 ----
    ("zhubamboo", BUILTIN_PRESET_RAW),
    ("mizhi", include_str!("../../themes/mizhi.json")),
    ("wulan", include_str!("../../themes/wulan.json")),
    ("shating", include_str!("../../themes/shating.json")),
    ("kucha", include_str!("../../themes/kucha.json")),
    ("tanghong", include_str!("../../themes/tanghong.json")),
    ("taizi", include_str!("../../themes/taizi.json")),
    ("moye", include_str!("../../themes/moye.json")),
    ("xuanqing", include_str!("../../themes/xuanqing.json")),
    // ---- v4 视频取色 ----
    // 浅色：明月珰 × 石榴裙（传统色）、秋波蓝 × 若竹
    ("mingyue", include_str!("../../themes/mingyue.json")),
    ("qiubo", include_str!("../../themes/qiubo.json")),
    // 深色：普鲁士蓝 × 秋金、马尔斯绿 × 晴空、深酒红 × 暖沙、
    //       克莱因蓝、魅夜黑 × 电光蓝
    ("somnus", include_str!("../../themes/somnus.json")),
    ("malers", include_str!("../../themes/malers.json")),
    ("jiuhong", include_str!("../../themes/jiuhong.json")),
    ("klein", include_str!("../../themes/klein.json")),
    ("meiye", include_str!("../../themes/meiye.json")),
    // 中式传统色配对：雾灰 × 普鲁士蓝、栀子 × 绀蝶、十样锦 × 烟墨色
    ("pulu", include_str!("../../themes/pulu.json")),
    ("zhizi", include_str!("../../themes/zhizi.json")),
    ("shiyang", include_str!("../../themes/shiyang.json")),
    // 高饱和撞色：深蓝 × 爱马仕橙、琥珀黄 × 青雀头戴
    ("hermes", include_str!("../../themes/hermes.json")),
    ("hupe", include_str!("../../themes/hupe.json")),
];

/// 预设自带的内容区背景图（预设 id, 文件名, 字节）。
/// v3 起新预设不再附带图片（配色本身已足够完整），保留此表以兼容旧安装残留。
pub const PRESET_IMAGES: &[(&str, &str, &[u8])] = &[];

/// 预设 JSON 模板中的图片占位前缀
const PRESET_BG_PLACEHOLDER: &str = "PRESET_BG::";

/// v2 及更早版本的内置预设名。v3 换掉整套配色后，这些名字的文件会残留在用户目录，
/// 需要一次性清理（只删内置名，不动用户自存配色）。
const LEGACY_PRESETS: &[&str] = &[
    "bamboo-dew",
    "botanical-garden",
    "chenlan",
    "dusk-violet",
    "ink-black",
    "ink-night",
    "muxia",
    "nuanju",
    "warm-sun",
    "zhuying",
];

impl ThemeState {
    /// 启动时加载：active.json 优先；缺失时用内置预设（并落盘）
    pub fn load() -> Result<Self, String> {
        let themes_dir = crate::storage::paths::themes_dir().map_err(|e| e.to_string())?;
        let active_path = themes_dir.join("active.json");

        // ---------- v3 迁移：清理上一代预设文件 ----------
        // 旧版本会把自己的预设写到 themes/ 目录；v3 换了整套配色，
        // 这些残留会混在主题列表里（且缺少气泡色板，选中后画布配色会崩）。
        // 只删"内置预设名不在当前注册表里"的文件，用户自存配色（非内置名）不动。
        for legacy in LEGACY_PRESETS {
            let p = themes_dir.join(format!("{legacy}.json"));
            if p.exists() {
                let _ = fs::remove_file(&p);
            }
        }
        // 旧版本的预设背景图也一并清掉（新预设不再附带图片）
        let legacy_bg = themes_dir.join("preset-bg");
        if legacy_bg.exists() {
            let _ = fs::remove_dir_all(&legacy_bg);
        }

        // 补写全部内置预设副本（缺失时），并把模板中的 PRESET_BG:: 占位
        // 替换为复制后的图片绝对路径（绝对路径因用户而异，无法静态写入 JSON）
        let bg_dir = themes_dir.join("preset-bg");
        for (preset_name, raw) in BUILTIN_PRESETS {
            let preset_path = themes_dir.join(format!("{preset_name}.json"));
            if preset_path.exists() {
                continue;
            }
            let mut content = raw.to_string();
            if let Some((_, file_name, bytes)) =
                PRESET_IMAGES.iter().find(|(n, _, _)| n == preset_name)
            {
                fs::create_dir_all(&bg_dir)
                    .map_err(|e| format!("创建预设图片目录失败: {e}"))?;
                let img_path = bg_dir.join(file_name);
                if !img_path.exists() {
                    fs::write(&img_path, bytes)
                        .map_err(|e| format!("写入预设图片 {file_name} 失败: {e}"))?;
                }
                // 注入绝对路径（JSON 字符串内反斜杠需转义）
                let abs = img_path.to_string_lossy().replace('\\', "\\\\");
                content = content.replace(&format!("{PRESET_BG_PLACEHOLDER}{file_name}"), &abs);
            }
            fs::write(&preset_path, content)
                .map_err(|e| format!("写入内置预设 {preset_name} 失败: {e}"))?;
        }
        // 图片单独兜底复制（预设 JSON 已存在但图片缺失的场景）
        for (_, file_name, bytes) in PRESET_IMAGES {
            let img_path = bg_dir.join(file_name);
            if !img_path.exists() {
                fs::create_dir_all(&bg_dir).map_err(|e| format!("创建预设图片目录失败: {e}"))?;
                fs::write(&img_path, bytes)
                    .map_err(|e| format!("写入预设图片 {file_name} 失败: {e}"))?;
            }
        }

        let config: ThemeConfig = if active_path.exists() {
            let raw = fs::read_to_string(&active_path).map_err(|e| format!("读取主题失败: {e}"))?;
            match serde_json::from_str::<ThemeConfig>(&raw) {
                Ok(cfg) if !LEGACY_PRESETS.contains(&cfg.name.as_str()) => cfg,
                // v3 迁移：active 指向已被淘汰的旧预设（或解析失败）时退回新默认主题，
                // 否则用户升级后会停在一套缺少气泡色板、配色已不存在的主题上。
                _ => {
                    let cfg: ThemeConfig = serde_json::from_str(BUILTIN_PRESET_RAW)
                        .map_err(|e| format!("内置预设损坏: {e}"))?;
                    let raw = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
                    let _ = fs::write(&active_path, raw);
                    cfg
                }
            }
        } else {
            let cfg: ThemeConfig = serde_json::from_str(BUILTIN_PRESET_RAW)
                .map_err(|e| format!("内置预设损坏: {e}"))?;
            let raw = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
            fs::write(&active_path, raw).map_err(|e| format!("初始化主题失败: {e}"))?;
            cfg
        };
        config.validate()?;
        Ok(Self {
            config: Mutex::new(config),
        })
    }

    pub fn get(&self) -> ThemeConfig {
        self.config.lock().unwrap().clone()
    }

    /// 应用主题：校验 → 持久化 → 更新内存 → 全窗口 set_effects → 广播
    pub fn apply(&self, app: &AppHandle, config: ThemeConfig) -> Result<(), String> {
        config.validate()?;

        // 持久化 active.json
        let themes_dir = crate::storage::paths::themes_dir().map_err(|e| e.to_string())?;
        let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        crate::storage::atomic::atomic_write(&themes_dir.join("active.json"), &raw)
            .map_err(|e| format!("保存主题失败: {e}"))?;

        *self.config.lock().unwrap() = config.clone();

        // 对全部窗口应用窗口级效果（失败仅记录：Win10 无 Mica / 系统关闭透明效果等场景静默回退）
        for (label, window) in app.webview_windows() {
            if let Err(e) = apply_window_effect(&window, &config.window.effect) {
                eprintln!("[qj] 窗口 {label} 应用效果失败（已回退纯色）: {e}");
            }
        }

        // 广播给所有窗口（含设置窗口自身）
        app.emit("theme://changed", &config)
            .map_err(|e| format!("广播主题失败: {e}"))?;
        Ok(())
    }
}

/// 把主题的窗口效果配置应用到单个窗口
pub fn apply_window_effect(window: &WebviewWindow, effect: &str) -> tauri::Result<()> {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    let effects = match effect {
        "mica" => EffectsBuilder::new()
            .effect(Effect::Mica)
            .state(EffectState::Active)
            .build(),
        "acrylic" => EffectsBuilder::new()
            .effect(Effect::Acrylic)
            .state(EffectState::Active)
            .build(),
        _ => EffectsBuilder::new().build(), // none：清空效果，回退 tokens.bg 纯色
    };
    window.set_effects(effects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_preset_parses_and_validates() {
        let cfg: ThemeConfig = serde_json::from_str(BUILTIN_PRESET_RAW).unwrap();
        cfg.validate().unwrap();
        assert_eq!(cfg.name, "zhubamboo");
        // v3 新色板：竹青主色
        assert_eq!(cfg.tokens.color.primary, "#317d59");
        // 气泡视图扩展色板必须齐备（缺了会导致画布/气泡退化成默认色）
        assert!(cfg.tokens.color.desk.is_some());
        assert!(cfg.tokens.color.glow.is_some());
        assert!(cfg.tokens.color.bubble.is_some());
        assert!(cfg.tokens.color.bubble_edge.is_some());
        assert!(cfg.tokens.color.ripple.is_some());
        assert!(cfg.modules.contains_key("sidebar"));
        assert!(cfg.modules.contains_key("editor"));
        assert!(cfg.modules.contains_key("fragment"));
    }
}
