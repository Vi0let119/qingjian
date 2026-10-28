//! 主题配置模型（与 settings/themes/active.json 一一对应）。
//! 一个预设 = 一个符合此 schema 的 JSON 文件，可插拔。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ThemeConfig {
    pub version: u32,
    /// 预设 id（用户自定义后仍保留来源 id）
    pub name: String,
    /// light | dark（影响对比度候选色顺序）
    pub base: String,
    pub window: WindowEffectConfig,
    pub tokens: Tokens,
    /// 模块名 → 模块配置（sidebar/noteList/tabs/editor/fragment/settings）
    pub modules: BTreeMap<String, ModuleConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowEffectConfig {
    /// none | acrylic | mica
    pub effect: String,
    /// active
    pub state: String,
    /// 全窗口背景图（绝对路径，覆盖整个界面，各模块以毛玻璃半透明叠加其上）
    #[serde(default)]
    pub background_image: Option<String>,
    /// cover | contain | repeat
    #[serde(default)]
    pub background_fit: Option<String>,
    /// 全局背景虚化 0–30
    #[serde(default)]
    pub blur: Option<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub color: ColorTokens,
    pub font: FontTokens,
    pub radius: String,
    pub shadow: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ColorTokens {
    pub primary: String,
    pub accent: String,
    pub danger: String,
    pub bg: String,
    pub surface: String,
    pub text: String,
    pub text_secondary: String,
    pub border: String,

    // ---------- v3「气泡视图」扩展色板 ----------
    // 全部可选：旧的自定义主题缺这些字段时由前端按 primary/bg 推导兜底，
    // 保证老配置仍然可用（见 lib/themePalette.ts 的派生逻辑）。
    /// 桌面底色（气泡画布最底层）
    #[serde(default)]
    pub desk: Option<String>,
    /// 画布上的柔光斑：RGB 形式 "r,g,b"，用于气泡 backdrop-filter 的透出层
    #[serde(default)]
    pub glow: Option<String>,
    /// 气泡主色（通常比 primary 更淡）
    #[serde(default)]
    pub bubble: Option<String>,
    /// 气泡描边/高光色
    #[serde(default)]
    pub bubble_edge: Option<String>,
    /// 涟漪色
    #[serde(default)]
    pub ripple: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FontTokens {
    pub family: String,
    pub size: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModuleConfig {
    /// 模块背景图（绝对路径或 data URI）；"引用图片" = 图片作为模块背景
    pub background_image: Option<String>,
    /// cover | contain | repeat
    pub background_fit: Option<String>,
    /// 雾化模糊强度 0–30
    pub blur: Option<u8>,
    /// 非空时该模块纯色覆盖（忽略背景图）
    pub solid_color: Option<String>,
    /// 非空时手动文字色；null = 自动对比度
    pub text_color: Option<String>,
}

impl ThemeConfig {
    /// 校验配置合法性（颜色格式、模糊范围、效果枚举）
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.window.effect.as_str(), "none" | "acrylic" | "mica") {
            return Err(format!("非法窗口效果: {}", self.window.effect));
        }
        if let Some(fit) = self.window.background_fit.as_deref() {
            if !matches!(fit, "cover" | "contain" | "repeat") {
                return Err(format!("非法窗口背景填充方式: {fit}"));
            }
        }
        if let Some(blur) = self.window.blur {
            if blur > 30 {
                return Err(format!("窗口背景虚化超限: {blur}"));
            }
        }
        for (name, m) in &self.modules {
            if let Some(blur) = m.blur {
                if blur > 30 {
                    return Err(format!("模块 {name} 模糊强度超限: {blur}"));
                }
            }
            if let Some(color) = m.solid_color.as_ref() {
                if !is_css_color(color) {
                    return Err(format!("模块 {name} 非法颜色: {color}"));
                }
            }
            if let Some(color) = m.text_color.as_ref() {
                if !is_css_color(color) {
                    return Err(format!("模块 {name} 非法文字色: {color}"));
                }
            }
        }
        for color in [
            &self.tokens.color.primary,
            &self.tokens.color.accent,
            &self.tokens.color.danger,
            &self.tokens.color.bg,
            &self.tokens.color.surface,
            &self.tokens.color.text,
            &self.tokens.color.text_secondary,
            &self.tokens.color.border,
        ] {
            if !is_css_color(color) {
                return Err(format!("非法 token 颜色: {color}"));
            }
        }
        Ok(())
    }
}

/// 接受 #rgb/#rrggbb/#rrggbbaa 与 rgba()/rgb() 形式
fn is_css_color(s: &str) -> bool {
    let t = s.trim();
    (t.starts_with('#') && (t.len() == 4 || t.len() == 7 || t.len() == 9))
        || (t.starts_with("rgb") && t.ends_with(')'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> ThemeConfig {
        ThemeConfig {
            version: 1,
            name: "test".into(),
            base: "light".into(),
            window: WindowEffectConfig {
                effect: "mica".into(),
                state: "active".into(),
                background_image: None,
                background_fit: None,
                blur: None,
            },
            tokens: Tokens {
                color: ColorTokens {
                    primary: "#4a7c59".into(),
                    accent: "#f9a620".into(),
                    danger: "#b7472a".into(),
                    bg: "#f5f3ed".into(),
                    surface: "#fffdf8".into(),
                    text: "#2b2b28".into(),
                    text_secondary: "#6b6b63".into(),
                    border: "rgba(74,124,89,0.25)".into(),
                    desk: None,
                    glow: None,
                    bubble: None,
                    bubble_edge: None,
                    ripple: None,
                },
                font: FontTokens {
                    family: "Segoe UI".into(),
                    size: "14px".into(),
                },
                radius: "10px".into(),
                shadow: "none".into(),
            },
            modules: BTreeMap::new(),
        }
    }

    #[test]
    fn valid_config_passes() {
        assert!(base_config().validate().is_ok());
    }

    #[test]
    fn rejects_bad_effect_and_blur() {
        let mut c = base_config();
        c.window.effect = "glassmorphism".into();
        assert!(c.validate().is_err());

        let mut c2 = base_config();
        c2.modules.insert(
            "sidebar".into(),
            ModuleConfig {
                blur: Some(99),
                ..Default::default()
            },
        );
        assert!(c2.validate().is_err());
    }

    #[test]
    fn rejects_bad_colors() {
        let mut c = base_config();
        c.modules.insert(
            "editor".into(),
            ModuleConfig {
                solid_color: Some("not-a-color".into()),
                ..Default::default()
            },
        );
        assert!(c.validate().is_err());
    }
}
