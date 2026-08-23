//! 数据目录解析与初始化。
//!
//! 布局（%APPDATA%\轻笺\）：
//! - notes\<笔记本>\<标题>.md   笔记本 = 文件夹，笔记 = .md 文件
//! - daily\<yyyy-MM-dd>.md      每日碎片整合文件
//! - attachments\<yyyy-MM>\    图片附件（按月分目录）
//! - settings\themes\          主题预设与当前生效主题

use std::path::PathBuf;

/// 数据根目录。测试可用环境变量 QINGJIAN_DATA_DIR 覆盖（亦为将来便携模式留口）。
pub fn data_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("QINGJIAN_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let appdata = std::env::var("APPDATA").map_err(|_| "无法定位 %APPDATA% 目录".to_string())?;
    Ok(PathBuf::from(appdata).join("轻笺"))
}

pub fn notes_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("notes"))
}

pub fn daily_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("daily"))
}

pub fn attachments_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("attachments"))
}

pub fn settings_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("settings"))
}

pub fn themes_dir() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join("themes"))
}

/// 默认笔记本名
pub const DEFAULT_NOTEBOOK: &str = "inbox";

/// 测试专用：跨模块共享的环境变量锁。
/// 所有操作 QINGJIAN_DATA_DIR 的测试（任何模块）都必须持有此锁，
/// 否则 cargo test 并行执行时各模块互相覆盖环境变量导致失败。
#[cfg(test)]
pub static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 清理原子写崩溃遗留的临时文件（`.name.tmp-*`）。
/// 正常流程中 rename 后不存在；仅进程在 create 与 rename 之间被杀时残留。
pub fn cleanup_temp_files() {
    let Ok(root) = data_dir() else { return };
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                stack.push(path);
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') && name.contains(".tmp-") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// 确保数据目录结构存在（含默认笔记本 inbox）。
pub fn ensure_dirs() -> Result<(), String> {
    let dirs = [
        notes_dir()?,
        daily_dir()?,
        attachments_dir()?,
        themes_dir()?,
    ];
    for d in &dirs {
        std::fs::create_dir_all(d).map_err(|e| format!("创建目录失败 {}: {e}", d.display()))?;
    }
    let inbox = notes_dir()?.join(DEFAULT_NOTEBOOK);
    if !inbox.exists() {
        std::fs::create_dir_all(&inbox)
            .map_err(|e| format!("创建默认笔记本失败 {}: {e}", inbox.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_respects_env_override() {
        let _g = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // 测试环境里设置一个临时目录，避免污染真实 APPDATA
        let tmp = std::env::temp_dir().join("qingjian-test-paths");
        std::env::set_var("QINGJIAN_DATA_DIR", &tmp);
        assert_eq!(data_dir().unwrap(), tmp);
        std::env::remove_var("QINGJIAN_DATA_DIR");
    }

    #[test]
    fn ensure_dirs_creates_structure() {
        let _g = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join("qingjian-test-ensure");
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("QINGJIAN_DATA_DIR", &tmp);
        ensure_dirs().unwrap();
        assert!(notes_dir().unwrap().is_dir());
        assert!(daily_dir().unwrap().is_dir());
        assert!(attachments_dir().unwrap().is_dir());
        assert!(themes_dir().unwrap().is_dir());
        assert!(notes_dir().unwrap().join(DEFAULT_NOTEBOOK).is_dir());
        // 幂等
        ensure_dirs().unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::remove_var("QINGJIAN_DATA_DIR");
    }
}
