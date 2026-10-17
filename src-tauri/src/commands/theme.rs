//! 主题命令：读取/应用/预设列表/重置 + 通用设置。

use crate::state::AppState;
use crate::theme::model::ThemeConfig;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetMeta {
    pub id: String,
    pub name: String,
    /// 是否内置预设（内置不可删除）
    pub builtin: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub autosave_delay_ms: Option<u64>,
    pub default_notebook: Option<String>,
    /// 启动时显示的界面："main"（主界面）或 "fragment"（新增碎片窗口）。
    /// 缺省/None 按碎片窗口处理（见 lib.rs setup）。
    pub startup_window: Option<String>,
    /// 界面字体缩放（CSS zoom 倍率，1.0 = 标准）。缺省/None 按 1.0 处理。
    pub ui_font_scale: Option<f32>,
}

/// 通用设置部分更新：仅覆盖 partial 中为 Some 的字段。
fn merge_settings(current: &mut AppSettings, partial: &AppSettings) {
    if partial.autosave_delay_ms.is_some() {
        current.autosave_delay_ms = partial.autosave_delay_ms;
    }
    if partial.default_notebook.is_some() {
        current.default_notebook = partial.default_notebook.clone();
    }
    if partial.startup_window.is_some() {
        current.startup_window = partial.startup_window.clone();
    }
    if partial.ui_font_scale.is_some() {
        current.ui_font_scale = partial.ui_font_scale;
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn theme_get() -> Result<ThemeConfig, String> {
    // M5 接入前 theme 状态为占位；这里直读文件（与 ThemeState 保持一致）
    let themes_dir = crate::storage::paths::themes_dir().map_err(err)?;
    let path = themes_dir.join("active.json");
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(err)?;
        serde_json::from_str(&raw).map_err(err)
    } else {
        // 尚未初始化：返回内置预设
        let cfg: ThemeConfig = serde_json::from_str(crate::theme::BUILTIN_PRESET_RAW)
            .map_err(|e| format!("内置预设损坏: {e}"))?;
        Ok(cfg)
    }
}

#[tauri::command]
pub fn theme_apply(
    config: ThemeConfig,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.theme.apply(&app, config)
}

/// 列出可用的预设主题（内置 + themes/ 目录下的用户主题 JSON）
#[tauri::command]
pub fn theme_list_presets() -> Result<Vec<PresetMeta>, String> {
    let themes_dir = crate::storage::paths::themes_dir().map_err(err)?;
    let mut presets = Vec::new();
    if themes_dir.exists() {
        for entry in fs::read_dir(&themes_dir).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "active.json" || !name.ends_with(".json") {
                continue;
            }
            let raw = fs::read_to_string(entry.path()).unwrap_or_default();
            if let Ok(cfg) = serde_json::from_str::<ThemeConfig>(&raw) {
                if cfg.validate().is_ok() {
                    presets.push(PresetMeta {
                        id: cfg.name.clone(),
                        name: cfg.name.clone(),
                        builtin: crate::theme::BUILTIN_PRESETS
                            .iter()
                            .any(|(n, _)| n == &cfg.name),
                    });
                }
            }
        }
    }
    Ok(presets)
}

/// 保存用户自定义主题方案（写为 themes/<id>.json，自动出现在预设画廊）。
/// 名称经 sanitize 转安全 id；重名（含内置名）时覆盖用户方案、拒绝内置名。
#[tauri::command]
pub fn theme_save(name: String, config: ThemeConfig) -> Result<String, String> {
    let id = crate::storage::sanitize::sanitize_name(&name);
    if crate::theme::BUILTIN_PRESETS.iter().any(|(n, _)| n == &id) {
        return Err(format!("「{name}」是内置主题名，请换一个名称"));
    }
    let mut cfg = config;
    cfg.name = id.clone();
    cfg.validate()?;

    let path = crate::storage::paths::themes_dir()
        .map_err(err)?
        .join(format!("{id}.json"));
    let raw = serde_json::to_string_pretty(&cfg).map_err(err)?;
    crate::storage::atomic::atomic_write(&path, &raw).map_err(|e| format!("保存主题失败: {e}"))?;
    Ok(id)
}

/// 删除用户自定义主题方案（内置不可删除）
#[tauri::command]
pub fn theme_delete(id: String) -> Result<(), String> {
    if crate::theme::BUILTIN_PRESETS.iter().any(|(n, _)| n == &id) {
        return Err("内置主题不可删除".into());
    }
    if !crate::storage::sanitize::is_safe_name(&id) || id.is_empty() {
        return Err(format!("非法主题 id: {id}"));
    }
    let path = crate::storage::paths::themes_dir().map_err(err)?.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(&path).map_err(err)?;
    }
    Ok(())
}

/// 按 id 加载预设主题（内置或用户保存的方案；设置窗口预设画廊预览用）
#[tauri::command]
pub fn theme_load_preset(id: String) -> Result<ThemeConfig, String> {
    // id 校验防路径穿越（内置或用户方案都走 themes/ 目录）
    if !crate::storage::sanitize::is_safe_name(&id) || id.is_empty() {
        return Err(format!("非法主题 id: {id}"));
    }
    let path = crate::storage::paths::themes_dir().map_err(err)?.join(format!("{id}.json"));
    let raw = fs::read_to_string(&path).map_err(err)?;
    let cfg: ThemeConfig = serde_json::from_str(&raw).map_err(err)?;
    cfg.validate()?;
    Ok(cfg)
}

/// 恢复内置默认主题
#[tauri::command]
pub fn theme_reset(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let cfg: ThemeConfig = serde_json::from_str(crate::theme::BUILTIN_PRESET_RAW)
        .map_err(|e| format!("内置预设损坏: {e}"))?;
    state.theme.apply(&app, cfg)
}

/// 主题背景图导入：把用户选择的图片复制进数据目录（themes/bg/），
/// 使其落在 assetProtocol scope（$APPDATA/轻笺/**）内，前端可用 convertFileSrc 引用。
#[tauri::command]
pub fn theme_import_background(file_path: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&file_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| "无法识别文件扩展名".to_string())?;
    if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
        return Err(format!("不支持的图片格式: {ext}"));
    }
    let bytes = fs::read(&src).map_err(|e| format!("读取所选图片失败: {e}"))?;

    let bg_dir = crate::storage::paths::themes_dir().map_err(err)?.join("bg");
    fs::create_dir_all(&bg_dir).map_err(err)?;
    let name = format!("{}.{}", uuid::Uuid::new_v4().simple(), ext);
    let dest = bg_dir.join(&name);
    crate::storage::atomic::atomic_write_bytes(&dest, &bytes).map_err(|e| format!("保存背景图失败: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn settings_get() -> Result<AppSettings, String> {
    let path = crate::storage::paths::settings_dir().map_err(err)?.join("settings.json");
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(err)?;
        serde_json::from_str(&raw).map_err(err)
    } else {
        Ok(AppSettings::default())
    }
}

#[tauri::command]
pub fn settings_set(partial: AppSettings, app: AppHandle) -> Result<(), String> {
    let path = crate::storage::paths::settings_dir().map_err(err)?.join("settings.json");
    let mut current = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(err)?;
        serde_json::from_str::<AppSettings>(&raw).unwrap_or_default()
    } else {
        AppSettings::default()
    };
    merge_settings(&mut current, &partial);
    let raw = serde_json::to_string_pretty(&current).map_err(err)?;
    crate::storage::atomic::atomic_write(&path, &raw).map_err(err)?;
    // 广播给所有窗口：字体缩放等设置需要即时生效（各窗口 ThemeProvider 监听）
    let _ = app.emit("settings://changed", &current);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_settings_camel_case_roundtrip() {
        let raw = r#"{"autosaveDelayMs":400,"defaultNotebook":"inbox","startupWindow":"main","uiFontScale":1.25}"#;
        let parsed: AppSettings = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.startup_window.as_deref(), Some("main"));
        assert_eq!(parsed.ui_font_scale, Some(1.25));

        // 缺省字段 → None（老版本 settings.json 无新字段也兼容）
        let legacy: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(legacy.startup_window.is_none());
        assert!(legacy.ui_font_scale.is_none());
    }

    #[test]
    fn merge_settings_only_overwrites_some_fields() {
        let mut current = AppSettings {
            autosave_delay_ms: Some(400),
            default_notebook: Some("inbox".into()),
            startup_window: Some("main".into()),
            ui_font_scale: Some(1.0),
        };
        merge_settings(
            &mut current,
            &AppSettings {
                startup_window: Some("fragment".into()),
                ui_font_scale: Some(1.3),
                ..Default::default()
            },
        );
        assert_eq!(current.startup_window.as_deref(), Some("fragment"));
        assert_eq!(current.ui_font_scale, Some(1.3));
        assert_eq!(current.autosave_delay_ms, Some(400));
        assert_eq!(current.default_notebook.as_deref(), Some("inbox"));
    }
}
