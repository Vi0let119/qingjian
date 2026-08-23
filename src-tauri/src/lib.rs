//! 轻笺（QingJian）—— 轻量便签应用。
//!
//! 模块划分：
//! - storage/   数据目录解析、文件名清洗、原子写、碎片拼接引擎
//! - commands/  Tauri IPC 命令（笔记 / 每日碎片 / 附件 / 主题）
//! - state.rs   应用全局状态（碎片会话、主题）
//! - theme/     主题模型与状态（加载/应用/广播/窗口效果）

mod commands;
mod state;
mod storage;
mod theme;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 首次启动建好数据目录结构与默认笔记本；清理崩溃遗留的原子写临时文件
            storage::paths::ensure_dirs().map_err(|e| std::io::Error::other(e))?;
            storage::paths::cleanup_temp_files();

            // 加载主题（内置预设初始化 + active.json）
            let app_state = state::AppState::new()
                .map_err(|e| std::io::Error::other(format!("主题初始化失败: {e}")))?;
            app.manage(app_state);

            // 对启动时已声明的窗口（main）应用主题窗口效果
            let effect = app.state::<state::AppState>().theme.get().window.effect.clone();
            for (label, window) in app.webview_windows() {
                if let Err(e) = theme::apply_window_effect(&window, &effect) {
                    eprintln!("[qj] 窗口 {label} 应用主题效果失败（回退纯色）: {e}");
                }
            }
            // JS 创建的碎片/设置窗口在创建时由前端按主题传 windowEffects
            Ok(())
        })
        // 全局窗口事件钩子（对所有窗口生效，含 JS 创建）：
        // Destroyed → 注销碎片 section（空块删除 / 非空块保留）
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                let handle = window.app_handle();
                let app_state = handle.state::<state::AppState>();
                if let Err(e) = commands::daily::daily_unregister_by_label(&label, &app_state) {
                    eprintln!("[qj] 注销碎片会话失败 ({label}): {e}");
                } else {
                    commands::daily::broadcast_daily_changed(handle);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notebooks,
            commands::notes::create_notebook,
            commands::notes::rename_notebook,
            commands::notes::delete_notebook,
            commands::notes::list_notes,
            commands::notes::create_note,
            commands::notes::read_note,
            commands::notes::save_note,
            commands::notes::rename_note,
            commands::notes::delete_note,
            commands::notes::search_notes,
            commands::attachments::import_attachment,
            commands::attachments::import_attachment_from_path,
            commands::attachments::delete_attachment,
            commands::attachments::read_file_as_data_uri,
            commands::attachments::read_external_file_bytes,
            commands::daily::daily_register,
            commands::daily::daily_save,
            commands::daily::daily_unregister,
            commands::daily::daily_read,
            commands::daily::daily_list_days,
            commands::daily::daily_delete_day,
            commands::theme::theme_get,
            commands::theme::theme_apply,
            commands::theme::theme_list_presets,
            commands::theme::theme_load_preset,
            commands::theme::theme_save,
            commands::theme::theme_delete,
            commands::theme::theme_reset,
            commands::theme::theme_import_background,
            commands::theme::settings_get,
            commands::theme::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("轻笺启动失败");
}
