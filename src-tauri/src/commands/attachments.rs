//! 图片附件导入（M3）。
//!
//! 两条路径统一落盘到 attachments\<yyyy-MM>\：
//! - 剪贴板粘贴：前端读 File → 字节经 IPC 传入（import_attachment）
//! - 文件选择：前端 dialog 选路径 → Rust 直接读文件（import_attachment_from_path）
//!
//! 相对路径按引用方位置计算（深度恒定原则，见 plan.md §五）：
//! - 笔记在 notes\<笔记本>\<标题>.md（2 层深）→ `../../attachments\<月>\<文件>`
//! - 每日碎片在 daily\<yyyy-MM-dd>.md（1 层深）→ `../attachments\<月>\<文件>`

use crate::storage::{atomic, paths};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 引用的主体：笔记或每日碎片
/// 坑：internally-tagged 枚举（tag="kind"）的容器级 rename_all 只重命名变体名、
/// 不重命名字段，字段必须逐个 #[serde(rename)] 才能对齐前端 camelCase。
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttachmentBase {
    Note {
        notebook: String,
        #[serde(rename = "fileName")]
        file_name: String,
    },
    Daily { day: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    pub abs_path: String,
    pub rel_path: String,
}

const ALLOWED_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// 引用方的 md 文件绝对路径（用于计算相对路径与删除校验）
fn referrer_path(base: &AttachmentBase) -> Result<PathBuf, String> {
    match base {
        AttachmentBase::Note { notebook, file_name } => {
            if !crate::storage::sanitize::is_safe_name(notebook)
                || !crate::storage::sanitize::is_safe_name(file_name)
            {
                return Err("非法引用参数".into());
            }
            Ok(paths::notes_dir()
                .map_err(err)?
                .join(notebook)
                .join(file_name))
        }
        AttachmentBase::Daily { day } => {
            // day 仅允许 yyyy-MM-dd 形态
            if day.len() != 10
                || !day
                    .chars()
                    .enumerate()
                    .all(|(i, c)| (i == 4 || i == 7) && c == '-' || (i != 4 && i != 7) && c.is_ascii_digit())
            {
                return Err(format!("非法日期: {day}"));
            }
            Ok(paths::daily_dir().map_err(err)?.join(format!("{day}.md")))
        }
    }
}

/// 校验扩展名并归一到小写
fn validate_ext(ext: &str) -> Result<String, String> {
    let e = ext.trim_start_matches('.').to_ascii_lowercase();
    if !ALLOWED_EXTS.contains(&e.as_str()) {
        return Err(format!("不支持的图片格式: {ext}"));
    }
    Ok(e)
}

/// 生成附件文件名：yyyyMMdd-HHmmss-<6位随机>.ext（同秒多次插入不冲突）
fn attachment_file_name(ext: &str) -> String {
    let now = Local::now();
    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..6];
    format!("{}-{}.{}", now.format("%Y%m%d-%H%M%S"), suffix, ext)
}

/// 写入字节并返回 {abs_path, rel_path}
fn store_attachment(base: &AttachmentBase, bytes: &[u8], ext: &str) -> Result<AttachmentInfo, String> {
    let ext = validate_ext(ext)?;
    let month = Local::now().format("%Y-%m").to_string();
    let month_dir = paths::attachments_dir().map_err(err)?.join(&month);
    fs::create_dir_all(&month_dir).map_err(err)?;

    let file_name = attachment_file_name(&ext);
    let abs = month_dir.join(&file_name);
    atomic::atomic_write_bytes(&abs, bytes).map_err(|e| format!("写入附件失败: {e}"))?;

    // 相对路径：从引用方 md 文件所在目录出发
    let referrer = referrer_path(base)?;
    let referrer_dir = referrer.parent().ok_or("引用方无父目录")?;
    let rel = pathdiff(referrer_dir, &abs)?;

    Ok(AttachmentInfo {
        abs_path: abs.to_string_lossy().into_owned(),
        rel_path: rel,
    })
}

/// 计算 from_dir 到 target 的相对路径，统一为 `/` 分隔（markdown 惯用）。
/// 手写实现（不引 pathdiff crate）：公共前缀大小写不敏感，`..` 数 = from 剩余段数。
/// 注意：attachments 与 notes/daily 是兄弟目录，from 不需要是 target 的祖先。
fn pathdiff(from_dir: &Path, target: &Path) -> Result<String, String> {
    let from_canon = from_dir
        .canonicalize()
        .map_err(|e| format!("无法解析引用目录 {}: {e}", from_dir.display()))?;
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("无法解析附件 {}: {e}", target.display()))?;

    let from_parts: Vec<String> = from_canon
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    let target_parts: Vec<String> = target_canon
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();

    let mut common = 0;
    while common < from_parts.len()
        && common < target_parts.len()
        && from_parts[common].eq_ignore_ascii_case(&target_parts[common])
    {
        common += 1;
    }
    let ups = from_parts.len() - common;
    let mut rel = vec!["..".to_string(); ups];
    rel.extend(target_parts[common..].iter().cloned());
    Ok(rel.join("/"))
}

// ---------- 命令 ----------

/// 剪贴板粘贴：字节经 IPC 传入
#[tauri::command]
pub fn import_attachment(base: AttachmentBase, bytes: Vec<u8>, ext: String) -> Result<AttachmentInfo, String> {
    store_attachment(&base, &bytes, &ext)
}

/// 文件选择：Rust 直接读取所选文件
#[tauri::command]
pub fn import_attachment_from_path(base: AttachmentBase, file_path: String) -> Result<AttachmentInfo, String> {
    let path = PathBuf::from(&file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| "无法识别文件扩展名".to_string())?
        .to_string();
    let bytes = fs::read(&path).map_err(|e| format!("读取所选文件失败: {e}"))?;
    store_attachment(&base, &bytes, &ext)
}

/// 读取用户自选的任意文件字节（设置窗口全局背景图前端缩放用；
/// 文件由用户经系统对话框主动选择，读取即其意图）
#[tauri::command]
pub fn read_external_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("读取所选文件失败: {e}"))
}

/// 把数据目录内的文件读成 data URI（编辑器图片显示用，零协议依赖）。
/// 路径必须位于数据目录内（canonicalize + 前缀校验，防任意文件读取）。
#[tauri::command]
pub fn read_file_as_data_uri(abs_path: String) -> Result<String, String> {
    use base64::Engine;

    let data_dir = paths::data_dir().map_err(err)?;
    let data_canon = data_dir.canonicalize().map_err(err)?;
    let target = PathBuf::from(&abs_path);
    let target_canon = target.canonicalize().map_err(|e| format!("文件不存在: {e}"))?;
    if !target_canon.starts_with(&data_canon) {
        return Err("路径不在数据目录内".into());
    }
    if !target_canon.is_file() {
        return Err("目标不是文件".into());
    }

    let mime = match target_canon
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };

    let bytes = fs::read(&target_canon).map_err(|e| format!("读取文件失败: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// 提取 md 内容中的图片相对路径（`![...](...)` 语法）
pub fn extract_image_refs(content: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut rest = content;
    while let Some(p) = rest.find("](") {
        let after = &rest[p + 2..];
        let Some(end) = after.find(')') else { break };
        let r = after[..end].trim().to_string();
        if !r.is_empty() && !r.starts_with("http") && !r.starts_with("data:") {
            refs.push(r);
        }
        rest = &after[end + 1..];
    }
    refs
}

/// 规范化引用：取 attachments/ 起算的后缀
/// （笔记 `../../attachments/x.png` 与碎片 `../attachments/x.png` 统一比较）
fn attachment_suffix(rel: &str) -> Option<String> {
    let normalized = rel.replace('\\', "/");
    let idx = normalized.find("attachments/")?;
    Some(normalized[idx..].to_string())
}

/// 递归收集目录下全部 md 文件的图片引用（后缀形式）
fn collect_md_refs(dir: &Path, out: &mut std::collections::HashSet<String>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            collect_md_refs(&entry.path(), out)?;
        } else if entry.file_name().to_string_lossy().ends_with(".md") {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                for r in extract_image_refs(&content) {
                    if let Some(s) = attachment_suffix(&r) {
                        out.insert(s);
                    }
                }
            }
        }
    }
    Ok(())
}

/// 删除不再被任何笔记/碎片引用的附件（笔记/笔记本/当日碎片删除时调用）。
/// 候选 refs 中仍被其他文件引用的保留；防路径逃逸（同 delete_attachment）。
pub fn cleanup_unreferenced_attachments(candidates: &[String]) -> Result<usize, String> {
    if candidates.is_empty() {
        return Ok(0);
    }
    let mut referenced = std::collections::HashSet::new();
    collect_md_refs(&paths::notes_dir().map_err(err)?, &mut referenced)?;
    collect_md_refs(&paths::daily_dir().map_err(err)?, &mut referenced)?;

    let att_dir = paths::attachments_dir().map_err(err)?;
    let mut removed = 0;
    for c in candidates {
        let Some(suffix) = attachment_suffix(c) else { continue };
        if referenced.contains(&suffix) {
            continue; // 仍被引用，保留
        }
        let mut resolved = att_dir.clone();
        for seg in suffix.split('/') {
            if seg == "attachments" {
                continue; // 后缀起点
            }
            if seg.is_empty() || seg == "." || seg == ".." || seg.contains(':') {
                resolved = att_dir.clone();
                break; // 非法段，放弃该候选
            }
            resolved.push(seg);
        }
        if resolved.starts_with(&att_dir) && resolved.is_file() {
            fs::remove_file(&resolved).map_err(err)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// 删除附件（校验解析后的路径必须位于 attachments 目录内）
#[tauri::command]
pub fn delete_attachment(base: AttachmentBase, rel_path: String) -> Result<(), String> {
    let referrer = referrer_path(&base)?;
    let referrer_dir = referrer.parent().ok_or("引用方无父目录")?;
    // 相对路径转绝对：按 `/` 与 `\` 拆分逐段处理，防 `..` 逃逸到 attachments 之外
    let att_dir = paths::attachments_dir().map_err(err)?;
    let mut resolved = att_dir.clone();
    for seg in rel_path.replace('\\', "/").split('/') {
        match seg {
            "" | "." => continue,
            ".." => {
                resolved.pop();
                if !resolved.starts_with(&att_dir) {
                    return Err("非法附件路径".into());
                }
            }
            s => {
                if s.is_empty() || s.contains(':') {
                    return Err("非法附件路径".into());
                }
                resolved.push(s);
            }
        }
    }
    // 目标必须仍在 attachments 内且确实存在
    if !resolved.starts_with(&att_dir) {
        return Err("非法附件路径".into());
    }
    if resolved.exists() {
        fs::remove_file(&resolved).map_err(err)?;
    }
    let _ = referrer_dir; // 引用方目录暂不清理（保守：仅删除附件本身）
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_test_env(f: impl FnOnce() + Send + 'static) {
        let _g = crate::storage::paths::TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join("qingjian-test-att");
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var("QINGJIAN_DATA_DIR", &dir);
        paths::ensure_dirs().unwrap();
        f();
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("QINGJIAN_DATA_DIR");
    }

    #[test]
    fn import_note_attachment_gives_correct_rel_path() {
        with_test_env(|| {
            let base = AttachmentBase::Note {
                notebook: "inbox".into(),
                file_name: "测试.md".into(),
            };
            let info = import_attachment(base, vec![0x89, 0x50, 0x4e, 0x47], "png".into()).unwrap();
            // 笔记 2 层深 → ../../attachments/...
            assert!(info.rel_path.starts_with("../../attachments/"));
            assert!(info.rel_path.ends_with(".png"));
            assert!(info.rel_path.contains('/'));
            assert!(Path::new(&info.abs_path).is_file());

            // 相对路径实际可达
            let referrer = paths::notes_dir().unwrap().join("inbox").join("测试.md");
            let dir = referrer.parent().unwrap();
            let resolved = dir.join(&info.rel_path).canonicalize().unwrap();
            assert_eq!(resolved, Path::new(&info.abs_path).canonicalize().unwrap());
        });
    }

    #[test]
    fn import_daily_attachment_gives_one_level_rel_path() {
        with_test_env(|| {
            let base = AttachmentBase::Daily {
                day: "2026-08-15".into(),
            };
            let info = import_attachment(base, vec![1, 2, 3], "jpg".into()).unwrap();
            assert!(info.rel_path.starts_with("../attachments/"));
            assert!(!info.rel_path.starts_with("../../"));
        });
    }

    #[test]
    fn rejects_bad_ext_and_bad_day() {
        with_test_env(|| {
            let bad_ext = import_attachment(
                AttachmentBase::Daily { day: "2026-08-15".into() },
                vec![],
                "exe".into(),
            );
            assert!(bad_ext.is_err());

            let bad_day = referrer_path(&AttachmentBase::Daily { day: "../evil".into() });
            assert!(bad_day.is_err());
        });
    }

    #[test]
    fn delete_attachment_blocks_escape() {
        with_test_env(|| {
            let base = AttachmentBase::Daily { day: "2026-08-15".into() };
            assert!(delete_attachment(base.clone(), "../../../evil.png".into()).is_err());
            assert!(delete_attachment(base, "../attachments/../notes/x.md".into()).is_err());
        });
    }

    #[test]
    fn cleanup_unreferenced_removes_only_orphans() {
        with_test_env(|| {
            // 附件 A：仅被测试笔记引用（删除后应清理）
            let base_a = AttachmentBase::Note {
                notebook: "inbox".into(),
                file_name: "将被删除.md".into(),
            };
            let info_a = import_attachment(base_a.clone(), vec![1, 2, 3], "png".into()).unwrap();
            // 附件 B：被另一篇笔记引用（应保留）
            let base_b = AttachmentBase::Note {
                notebook: "inbox".into(),
                file_name: "保留.md".into(),
            };
            let info_b = import_attachment(base_b, vec![4, 5, 6], "png".into()).unwrap();

            // 模拟保留笔记引用了 A 与 B（A 共享 → 不应被删）
            let keep_note = paths::notes_dir().unwrap().join("inbox").join("保留.md");
            let keep_refs = format!("![](../../attachments/2026-08/{})\n{}", "x.png", format!("![]({})", info_b.rel_path));
            let _ = keep_refs;
            // 简化：保留笔记引用 A 和 B
            fs::write(
                &keep_note,
                format!("![]({})\n![]({})", info_a.rel_path, info_b.rel_path),
            )
            .unwrap();

            // 候选 = 将被删除笔记的引用（只含 A 的引用中未被保留的部分——构造仅 A）
            let removed = cleanup_unreferenced_attachments(&[info_b.rel_path.clone()]).unwrap();
            assert_eq!(removed, 0, "仍被保留笔记引用的附件不应删除");

            // 构造真正孤儿：不被任何文件引用的附件 C
            let info_c = import_attachment(
                AttachmentBase::Daily { day: "2026-08-16".into() },
                vec![7, 8, 9],
                "png".into(),
            )
            .unwrap();
            // 不写入任何引用
            let removed2 = cleanup_unreferenced_attachments(&[info_c.rel_path.clone()]).unwrap();
            assert_eq!(removed2, 1, "孤儿附件应被删除");
            assert!(!Path::new(&info_c.abs_path).exists());
        });
    }

    #[test]
    fn extract_image_refs_parses_markdown() {
        let md = "文字 ![图A](../../attachments/2026-08/a.png) 和\n\n![图B](../attachments/x.jpg) 以及 <img> 与外部 http://x.com/y.png";
        let refs = extract_image_refs(md);
        assert_eq!(refs, vec!["../../attachments/2026-08/a.png", "../attachments/x.jpg"]);
    }

    #[test]
    fn pathdiff_handles_chinese_and_case() {
        with_test_env(|| {
            let att = paths::attachments_dir().unwrap().join("2026-08").join("x.png");
            fs::create_dir_all(att.parent().unwrap()).unwrap();
            fs::write(&att, b"x").unwrap();
            let from = paths::notes_dir().unwrap().join("日记");
            fs::create_dir_all(&from).unwrap();
            let rel = pathdiff(&from, &att).unwrap();
            assert_eq!(rel, "../../attachments/2026-08/x.png");
        });
    }
}
