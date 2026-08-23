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
pub const BUILTIN_PRESET_RAW: &str = include_str!("../../themes/botanical-garden.json");
const BUILTIN_BOTANICAL: &str = BUILTIN_PRESET_RAW;

/// 全部内置预设（文件名, 内容）。新增主题 = 新增 JSON + 在此注册，前端零改动。
pub const BUILTIN_PRESETS: &[(&str, &str)] = &[
    ("botanical-garden", BUILTIN_PRESET_RAW),
    ("bamboo-dew", include_str!("../../themes/bamboo-dew.json")),
    ("dusk-violet", include_str!("../../themes/dusk-violet.json")),
    ("warm-sun", include_str!("../../themes/warm-sun.json")),
    ("ink-night", include_str!("../../themes/ink-night.json")),
    ("zhuying", include_str!("../../themes/zhuying.json")),
    ("muxia", include_str!("../../themes/muxia.json")),
    ("chenlan", include_str!("../../themes/chenlan.json")),
    ("nuanju", include_str!("../../themes/nuanju.json")),
    ("ink-black", include_str!("../../themes/ink-black.json")),
];

/// 预设自带的内容区背景图（预设 id, 文件名, 字节）——编译进二进制，
/// 首次运行复制到 themes/preset-bg/ 并把预设 JSON 中的 PRESET_BG:: 占位替换为绝对路径。
pub const PRESET_IMAGES: &[(&str, &str, &[u8])] = &[
    ("zhuying", "zhuying.jpg", include_bytes!("../../themes/preset-bg/zhuying.jpg")),
    ("muxia", "muxia.jpg", include_bytes!("../../themes/preset-bg/muxia.jpg")),
    ("chenlan", "chenlan.jpg", include_bytes!("../../themes/preset-bg/chenlan.jpg")),
    ("nuanju", "nuanju.jpg", include_bytes!("../../themes/preset-bg/nuanju.jpg")),
];

/// 预设 JSON 模板中的图片占位前缀
const PRESET_BG_PLACEHOLDER: &str = "PRESET_BG::";

impl ThemeState {
    /// 启动时加载：active.json 优先；缺失时用内置预设（并落盘）
    pub fn load() -> Result<Self, String> {
        let themes_dir = crate::storage::paths::themes_dir().map_err(|e| e.to_string())?;
        let active_path = themes_dir.join("active.json");

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
            serde_json::from_str(&raw).map_err(|e| format!("主题 JSON 解析失败: {e}"))?
        } else {
            let cfg: ThemeConfig = serde_json::from_str(BUILTIN_BOTANICAL)
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
        let cfg: ThemeConfig = serde_json::from_str(BUILTIN_BOTANICAL).unwrap();
        cfg.validate().unwrap();
        assert_eq!(cfg.name, "botanical-garden");
        assert_eq!(cfg.tokens.color.primary, "#4a7c59");
        assert!(cfg.modules.contains_key("sidebar"));
        assert!(cfg.modules.contains_key("editor"));
        assert!(cfg.modules.contains_key("fragment"));
    }
}
