// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 让 tauri 内部 log::error!（如 asset 协议 403 拒绝原因）输出到终端/日志
    env_logger::init();
    qingjian_lib::run()
}
