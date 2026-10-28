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
    // 验证用：设置 QJ_CDP_PORT 时打开 WebView2 远程调试端口（不设置则完全不生效）
    let cdp_port = std::env::var("QJ_CDP_PORT").ok();
    if let Some(port) = cdp_port.clone() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            format!("--remote-debugging-port={port}"),
        );
    }

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

            // 按通用设置决定启动界面：主界面 或 新增碎片窗口（缺省 → 碎片窗口）
            let mut settings = commands::theme::settings_get().unwrap_or_default();
            // 调试：环境变量可强制启动界面（QJ_FORCE_STARTUP=main|fragment），便于自动化验证
            if let Ok(force) = std::env::var("QJ_FORCE_STARTUP") {
                if force == "main" || force == "fragment" {
                    settings.startup_window = Some(force);
                }
            }
            let main = app
                .get_webview_window("main")
                .expect("tauri.conf.json 必须声明 main 窗口");
            if settings.startup_window.as_deref() == Some("main") {
                main.show().map_err(|e| std::io::Error::other(e))?;
                let _ = main.set_focus();
            } else {
                // 主窗口保持隐藏（前端"进入主界面"按钮负责 show），启动一个碎片窗口
                let frag = tauri::WebviewWindowBuilder::new(
                    app,
                    "fragment-boot",
                    tauri::WebviewUrl::App("fragment.html".into()),
                )
                .title("新增碎片")
                .inner_size(380.0, 320.0)
                .min_inner_size(300.0, 200.0)
                .center()
                .build()
                .map_err(|e| std::io::Error::other(format!("创建启动碎片窗口失败: {e}")))?;
                if let Err(e) = theme::apply_window_effect(&frag, &effect) {
                    eprintln!("[qj] 启动碎片窗口应用主题效果失败（回退纯色）: {e}");
                }
            }
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
                // 零可见窗口守卫：隐藏主窗口（碎片启动模式）不算存活窗口，
                // 否则关掉碎片后进程残留、无任何界面可回到
                let any_visible = handle
                    .webview_windows()
                    .iter()
                    .filter(|(l, _)| l.as_str() != label)
                    .any(|(_, w)| w.is_visible().unwrap_or(false));
                #[cfg(debug_assertions)]
                eprintln!(
                    "[qj-debug] destroyed={label}, any_visible={any_visible}, all={:?}",
                    handle
                        .webview_windows()
                        .iter()
                        .map(|(l, w)| (l.clone(), w.is_visible()))
                        .collect::<Vec<_>>()
                );
                if !any_visible {
                    handle.exit(0);
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
