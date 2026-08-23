//! 应用全局状态。
//! - DailyState：碎片 section store + label→id 映射（M4）
//! - ThemeState：主题配置 + 应用/广播（M5）

use crate::storage::section_store::DailyState;
use crate::theme::ThemeState;

pub struct AppState {
    pub daily: DailyState,
    pub theme: ThemeState,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            daily: DailyState::new(),
            theme: ThemeState::load()?,
        })
    }
}
