//! 模块二：每日碎片命令。
//! 碎片窗口启动 → daily_register（Rust 侧生成 section 并记录 label 映射）
//! → 输入即 daily_save（单锁内 splice 自己的块 + 原子写）
//! → 窗口 Destroyed 时由 lib.rs 调 daily_unregister_by_label（空块删除/非空保留）。

use crate::state::AppState;
use crate::storage::paths;
use std::fs;
use tauri::{AppHandle, Emitter, State};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn valid_day(day: &str) -> bool {
    day.len() == 10
        && day
            .chars()
            .enumerate()
            .all(|(i, c)| (i == 4 || i == 7) && c == '-' || (i != 4 && i != 7) && c.is_ascii_digit())
}

#[tauri::command]
pub fn daily_register(day: String, window_label: String, state: State<'_, AppState>) -> Result<String, String> {
    if !valid_day(&day) {
        return Err(format!("非法日期: {day}"));
    }
    // 前端日期仅供参考，实际以 Rust 时钟为准（register 内部取本地今天）
    let _ = day;
    state.daily.register(&window_label)
}

#[tauri::command]
pub fn daily_save(
    section_id: String,
    content: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    state.daily.save(&section_id, content)?;
    // 广播：每日碎片浏览页实时刷新
    let _ = app.emit("daily://changed", ());
    Ok(())
}

#[tauri::command]
pub fn daily_unregister(section_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.daily.unregister(&section_id)
}

/// 按 label 注销（lib.rs 窗口 Destroyed 事件调用）
pub fn daily_unregister_by_label(label: &str, state: &AppState) -> Result<(), String> {
    state.daily.unregister_by_label(label)
}

/// 广播碎片变更（供 lib.rs 注销后调用，浏览页实时刷新）
pub fn broadcast_daily_changed(app: &AppHandle) {
    let _ = app.emit("daily://changed", ());
}

/// 读取某天的碎片整合文件（历史浏览）
#[tauri::command]
pub fn daily_read(day: String) -> Result<DailyRead, String> {
    if !valid_day(&day) {
        return Err(format!("非法日期: {day}"));
    }
    let path = paths::daily_dir().map_err(err)?.join(format!("{day}.md"));
    let content = if path.exists() {
        fs::read_to_string(&path).map_err(err)?
    } else {
        String::new()
    };
    // 坑：不用 canonicalize()——Windows 下返回 \\?\C:\ 前缀，前端拼接会坏路径
    let abs_path = path.to_string_lossy().into_owned();
    Ok(DailyRead { content, abs_path })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyRead {
    pub content: String,
    pub abs_path: String,
}

/// 删除某天的碎片记录文件（不存在视为成功），并清理无引用附件
fn delete_day_file(day: &str) -> Result<(), String> {
    if !valid_day(day) {
        return Err(format!("非法日期: {day}"));
    }
    let path = paths::daily_dir().map_err(err)?.join(format!("{day}.md"));
    if path.exists() {
        let refs = fs::read_to_string(&path)
            .map(|c| crate::commands::attachments::extract_image_refs(&c))
            .unwrap_or_default();
        fs::remove_file(&path).map_err(err)?;
        if let Err(e) = crate::commands::attachments::cleanup_unreferenced_attachments(&refs) {
            eprintln!("[qj] 清理当日碎片附件失败: {e}");
        }
    }
    Ok(())
}

/// 删除某天的全部碎片记录（仅删当日 md 文件；附件保守保留）
#[tauri::command]
pub fn daily_delete_day(day: String, app: AppHandle) -> Result<(), String> {
    delete_day_file(&day)?;
    broadcast_daily_changed(&app);
    Ok(())
}

/// 逆序列出所有有记录的日子
#[tauri::command]
pub fn daily_list_days() -> Result<Vec<String>, String> {
    let dir = paths::daily_dir().map_err(err)?;
    let mut days: Vec<String> = fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".md")?;
            valid_day(stem).then(|| stem.to_string())
        })
        .collect();
    days.sort_by(|a, b| b.cmp(a)); // 逆序：最新在前
    Ok(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_test_env(f: impl FnOnce() + Send + 'static) {
        // 必须用全局共享锁（cargo test 并行执行，环境变量跨模块竞态）
        let _g = crate::storage::paths::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join("qingjian-test-daily-del");
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var("QINGJIAN_DATA_DIR", &dir);
        crate::storage::paths::ensure_dirs().unwrap();
        f();
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("QINGJIAN_DATA_DIR");
    }

    #[test]
    fn delete_day_file_removes_file_and_rejects_bad_day() {
        with_test_env(|| {
            let day = "2026-08-16";
            let path = paths::daily_dir().unwrap().join(format!("{day}.md"));
            fs::write(&path, "# 2026-08-16\n\n内容").unwrap();

            delete_day_file(day).unwrap();
            assert!(!path.exists(), "文件应被删除");

            // 非法日期被拒
            assert!(delete_day_file("../evil").is_err());
            // 删除不存在的一天也不报错
            delete_day_file("2026-08-15").unwrap();
        });
    }
}
