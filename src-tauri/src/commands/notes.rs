//! 模块一：笔记本/笔记 CRUD。
//!
//! 笔记本 = notes\ 下的文件夹；笔记 = 笔记本文件夹内的 .md 文件。
//! 标题 = 文件名 stem；无独立元数据库（轻量）。

use crate::storage::{atomic, paths, sanitize};
use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookInfo {
    pub name: String,
    pub note_count: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub file_name: String,
    pub title: String,
    pub updated_at: i64,
    pub created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRead {
    pub content: String,
    pub abs_path: String,
}

// ---------- 内部工具 ----------

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// 校验笔记本名安全并返回其目录路径（防路径穿越）
fn notebook_dir(name: &str) -> Result<PathBuf, String> {
    if !sanitize::is_safe_name(name) {
        return Err(format!("非法的笔记本名: {name:?}"));
    }
    let dir = paths::notes_dir().map_err(err)?.join(name);
    if !dir.is_dir() {
        return Err(format!("笔记本不存在: {name}"));
    }
    Ok(dir)
}

/// 校验笔记文件名安全（不含路径分隔符）
fn validate_file_name(file_name: &str) -> Result<(), String> {
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    if !sanitize::is_safe_name(stem) || stem.contains('/') || stem.contains('\\') {
        return Err(format!("非法的文件名: {file_name:?}"));
    }
    Ok(())
}

fn modified_millis(path: &std::path::Path) -> i64 {
    path.metadata()
        .and_then(|m| m.modified()) // io::Result<SystemTime>
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn created_millis(path: &std::path::Path) -> i64 {
    path.metadata()
        .and_then(|m| m.created()) // io::Result<SystemTime>（文件创建时间）
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------- 创建时间旁路索引 ----------
// 坑：原子写（临时文件+rename）会把目标文件的"创建时间"重置为保存时刻，
// 导致 created_at == updated_at 永远相等。真实创建时间记录在旁路 JSON 索引里，
// 保存/改名均保留原值。

fn note_key(notebook: &str, file_name: &str) -> String {
    format!("{notebook}/{file_name}")
}

fn created_index_path() -> Result<std::path::PathBuf, String> {
    Ok(paths::settings_dir().map_err(err)?.join("note-created.json"))
}

fn load_created_index() -> std::collections::HashMap<String, i64> {
    created_index_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_created_index(map: &std::collections::HashMap<String, i64>) {
    if let Ok(path) = created_index_path() {
        if let Ok(raw) = serde_json::to_string_pretty(map) {
            let _ = atomic::atomic_write(&path, &raw);
        }
    }
}

/// 笔记创建时间：索引优先（跨保存/改名保留），无索引回退文件创建时间
fn note_created_at(notebook: &str, file_name: &str, path: &std::path::Path) -> i64 {
    load_created_index()
        .get(&note_key(notebook, file_name))
        .copied()
        .unwrap_or_else(|| created_millis(path))
}

/// 笔记标题 = 文件名 stem（数据模型约定：标题即文件名，重命名笔记 = 重命名文件）。
/// 不再从内容首行推导——首行可能是正文（如 "tips:"），会造成列表显示混乱。
fn note_title(_path: &std::path::Path, fallback_stem: &str) -> String {
    fallback_stem.to_string()
}

fn is_md_file(name: &str) -> bool {
    name.len() > 3 && name.ends_with(".md") && name != ".md"
}

// ---------- 笔记本命令 ----------

#[tauri::command]
pub fn list_notebooks() -> Result<Vec<NotebookInfo>, String> {
    let notes_dir = paths::notes_dir().map_err(err)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(&notes_dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let note_count = fs::read_dir(entry.path())
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| is_md_file(&e.file_name().to_string_lossy()))
                    .count()
            })
            .unwrap_or(0);
        result.push(NotebookInfo { name, note_count });
    }
    // 默认笔记本置顶，其余按名称排序
    result.sort_by(|a, b| {
        let a_inbox = a.name == paths::DEFAULT_NOTEBOOK;
        let b_inbox = b.name == paths::DEFAULT_NOTEBOOK;
        b_inbox.cmp(&a_inbox).then_with(|| a.name.cmp(&b.name))
    });
    Ok(result)
}

#[tauri::command]
pub fn create_notebook(name: String) -> Result<(), String> {
    let safe = sanitize::sanitize_name(&name);
    if safe.is_empty() {
        return Err("笔记本名不能为空".into());
    }
    let dir = paths::notes_dir().map_err(err)?.join(&safe);
    if dir.exists() {
        return Err(format!("笔记本已存在: {safe}"));
    }
    fs::create_dir_all(&dir).map_err(err)
}

#[tauri::command]
pub fn rename_notebook(old_name: String, new_name: String) -> Result<(), String> {
    if old_name == paths::DEFAULT_NOTEBOOK {
        return Err("默认笔记本不可重命名".into());
    }
    let old_dir = notebook_dir(&old_name)?;
    let safe = sanitize::sanitize_name(&new_name);
    let new_dir = paths::notes_dir().map_err(err)?.join(&safe);
    if new_dir.exists() {
        return Err(format!("笔记本已存在: {safe}"));
    }
    fs::rename(&old_dir, &new_dir).map_err(err)
}

#[tauri::command]
pub fn delete_notebook(name: String) -> Result<(), String> {
    if name == paths::DEFAULT_NOTEBOOK {
        return Err("默认笔记本不可删除".into());
    }
    let dir = notebook_dir(&name)?;
    // 删除前收集笔记本内全部图片引用（文件删除后统一清理无引用附件）
    let mut refs = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.filter_map(|e| e.ok()) {
            if entry.file_name().to_string_lossy().ends_with(".md") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    refs.extend(crate::commands::attachments::extract_image_refs(&content));
                }
            }
        }
    }
    fs::remove_dir_all(&dir).map_err(err)?;
    if let Err(e) = crate::commands::attachments::cleanup_unreferenced_attachments(&refs) {
        eprintln!("[qj] 清理笔记本附件失败: {e}");
    }
    // 清理该笔记本的创建时间索引（防重名文件复活陈旧创建时间）
    let prefix = format!("{name}/");
    let mut index = load_created_index();
    let before = index.len();
    index.retain(|k, _| !k.starts_with(&prefix));
    if index.len() != before {
        save_created_index(&index);
    }
    Ok(())
}

// ---------- 笔记命令 ----------

#[tauri::command]
pub fn list_notes(notebook: String) -> Result<Vec<NoteMeta>, String> {
    let dir = notebook_dir(&notebook)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(&dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !is_md_file(&file_name) {
            continue;
        }
        let stem = file_name.trim_end_matches(".md").to_string();
        let title = note_title(&entry.path(), &stem);
        result.push(NoteMeta {
            updated_at: modified_millis(&entry.path()),
            created_at: note_created_at(&notebook, &file_name, &entry.path()),
            file_name,
            title,
        });
    }
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(result)
}

#[tauri::command]
pub fn create_note(notebook: String) -> Result<NoteMeta, String> {
    let dir = notebook_dir(&notebook)?;
    let now = Local::now();
    let base = format!("无标题笔记 {}", now.format("%Y-%m-%d %H-%M"));
    let mut file_name = format!("{base}.md");
    let mut counter = 2;
    while dir.join(&file_name).exists() {
        file_name = format!("{base} ({counter}).md");
        counter += 1;
    }
    let path = dir.join(&file_name);
    fs::write(&path, "").map_err(err)?;
    // 记录真实创建时间（原子保存会重置文件创建时间）
    let created = created_millis(&path);
    let mut index = load_created_index();
    index.insert(note_key(&notebook, &file_name), created);
    save_created_index(&index);
    Ok(NoteMeta {
        file_name,
        title: format!("无标题笔记 {}", now.format("%Y-%m-%d %H-%M")),
        updated_at: modified_millis(&path),
        created_at: created,
    })
}

#[tauri::command]
pub fn read_note(notebook: String, file_name: String) -> Result<NoteRead, String> {
    validate_file_name(&file_name)?;
    let dir = notebook_dir(&notebook)?;
    let path = dir.join(&file_name);
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取笔记失败 {}: {e}", path.display()))?;
    // 坑：canonicalize() 在 Windows 返回 \\?\C:\...（verbatim 前缀），
    // 前端路径拼接会把 \\? 当组件处理产生非法路径（os error 123）。
    // path 本身已由 APPDATA 拼接为绝对路径，直接返回即可。
    let abs_path = path.to_string_lossy().into_owned();
    Ok(NoteRead { content, abs_path })
}

#[tauri::command]
pub fn save_note(notebook: String, file_name: String, content: String) -> Result<(), String> {
    validate_file_name(&file_name)?;
    let dir = notebook_dir(&notebook)?;
    let path = dir.join(&file_name);
    atomic::atomic_write(&path, &content).map_err(|e| format!("保存笔记失败: {e}"))
}

#[tauri::command]
pub fn rename_note(notebook: String, old_file: String, new_title: String) -> Result<NoteMeta, String> {
    validate_file_name(&old_file)?;
    let dir = notebook_dir(&notebook)?;
    let old_path = dir.join(&old_file);
    if !old_path.is_file() {
        return Err(format!("笔记不存在: {old_file}"));
    }
    let old_stem = old_file.trim_end_matches(".md");
    let new_stem = sanitize::sanitize_name(&new_title);
    // 迁移创建时间索引：改名保留原创建时间
    let created = note_created_at(&notebook, &old_file, &old_path);
    let migrate_index = |new_file: &str| {
        let mut index = load_created_index();
        index.remove(&note_key(&notebook, &old_file));
        index.insert(note_key(&notebook, new_file), created);
        save_created_index(&index);
    };
    // 仅大小写变化的改名，直接放行（Windows 上 rename 同路径大小写变化也可直接改）
    if new_stem.eq_ignore_ascii_case(old_stem) {
        if new_stem != old_stem {
            let new_path = dir.join(format!("{new_stem}.md"));
            fs::rename(&old_path, &new_path).map_err(err)?;
            migrate_index(&format!("{new_stem}.md"));
        }
        return Ok(NoteMeta {
            file_name: format!("{new_stem}.md"),
            title: new_stem,
            updated_at: modified_millis(&old_path),
            created_at: created,
        });
    }
    let new_file = format!("{new_stem}.md");
    let new_path = dir.join(&new_file);
    if new_path.exists() {
        return Err(format!("同名笔记已存在: {new_stem}"));
    }
    fs::rename(&old_path, &new_path).map_err(err)?;
    migrate_index(&new_file);
    Ok(NoteMeta {
        file_name: new_file,
        title: new_stem,
        updated_at: modified_millis(&new_path),
        created_at: created,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /** 所在笔记本。单笔记本搜索时前端可忽略，全局搜索必须靠它定位 */
    pub notebook: String,
    pub file_name: String,
    pub title: String,
    pub snippet: String,
    /// 命中次数，用于按相关度排序
    pub hits: usize,
}

/// 在单个笔记本里检索，返回命中列表（内部复用）。
fn search_in_notebook(notebook: &str, q: &str) -> Result<Vec<SearchHit>, String> {
    let dir = notebook_dir(notebook)?;
    let mut hits = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        // 笔记本目录不存在（刚删掉）时按无命中处理，不要让全局搜索整个失败
        Err(_) => return Ok(hits),
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !is_md_file(&file_name) {
            continue;
        }
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        let clean = clean_md_for_search(&content);
        let lower = clean.to_lowercase();
        let count = lower.matches(q).count();
        if count == 0 {
            continue;
        }
        let stem = file_name.trim_end_matches(".md").to_string();
        hits.push(SearchHit {
            notebook: notebook.to_string(),
            title: stem,
            file_name,
            snippet: build_snippet(&clean, q),
            hits: count,
        });
    }
    Ok(hits)
}

/// 全文检索：在**单个**笔记本内搜索（大小写不敏感），返回命中与摘要。
#[tauri::command]
pub fn search_notes(notebook: String, query: String) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    search_in_notebook(&notebook, &q)
}

/// 全局检索：跨所有笔记本搜索，按命中次数降序。
/// 侧栏搜索框搬到顶层后不再有"当前笔记本"，所以需要这个。
#[tauri::command]
pub fn search_all_notes(query: String, limit: Option<usize>) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let notes_dir = paths::notes_dir().map_err(err)?;
    let mut all = Vec::new();
    for entry in fs::read_dir(&notes_dir).map_err(err)?.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // 单个笔记本读失败不应让整个搜索失败
        if let Ok(hits) = search_in_notebook(&name, &q) {
            all.extend(hits);
        }
    }
    all.sort_by(|a, b| b.hits.cmp(&a.hits).then_with(|| a.title.cmp(&b.title)));
    let cap = limit.unwrap_or(200);
    all.truncate(cap);
    Ok(all)
}

/// 清洗 markdown 格式标记，得到与编辑器纯文本一致的检索文本：
/// 去 HTML 标签（<span style="font-size:..">/<u>/</u> 等）、图片与链接语法、
/// 加粗/斜体/行内代码标记、引用与列表前缀。
fn clean_md_for_search(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let chars: Vec<char> = content.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '<' {
            // 跳过整个 HTML 标签
            while i < chars.len() && chars[i] != '>' {
                i += 1;
            }
            i += 1; // 跳过 '>'
            continue;
        }
        if c == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            // 图片 ![alt](src)：跳到 ] 后跳过 (url)
            while i < chars.len() && chars[i] != ']' {
                i += 1;
            }
            i += 1;
            if i < chars.len() && chars[i] == '(' {
                while i < chars.len() && chars[i] != ')' {
                    i += 1;
                }
                i += 1;
            }
            continue;
        }
        if c == '[' {
            // 链接 [text](url)：保留下一个 ']' 之后的文本处理交给主循环——简化：跳过到 ')'
            let mut j = i + 1;
            let mut has_close = false;
            while j < chars.len() {
                if chars[j] == ']' {
                    has_close = true;
                    break;
                }
                j += 1;
            }
            if has_close && j + 1 < chars.len() && chars[j + 1] == '(' {
                i = j + 2;
                while i < chars.len() && chars[i] != ')' {
                    i += 1;
                }
                i += 1;
                continue;
            }
        }
        if matches!(c, '*' | '`' | '_') {
            i += 1;
            continue;
        }
        if c == '>' && (i == 0 || chars[i - 1] == '\n') {
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    // 折叠多余空白
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 摘要：清洗后文本中首个匹配行，截取匹配点前后约 30 字符
fn build_snippet(clean_content: &str, q_lower: &str) -> String {
    let Some(line) = clean_content.lines().find(|l| l.to_lowercase().contains(q_lower)) else {
        return String::new();
    };
    let lower = line.to_lowercase();
    let byte_pos = lower.find(q_lower).unwrap_or(0);
    let char_pos = lower[..byte_pos].chars().count();
    let q_len = q_lower.chars().count();
    let chars: Vec<char> = line.chars().collect();
    let from = char_pos.saturating_sub(30);
    let to = (char_pos + q_len + 30).min(chars.len());
    let mut s: String = chars[from..to].iter().collect();
    if from > 0 {
        s.insert(0, '…');
    }
    if to < chars.len() {
        s.push('…');
    }
    s.trim().to_string()
}

#[tauri::command]
pub fn delete_note(notebook: String, file_name: String) -> Result<(), String> {
    validate_file_name(&file_name)?;
    let dir = notebook_dir(&notebook)?;
    let path = dir.join(&file_name);
    if !path.is_file() {
        return Err(format!("笔记不存在: {file_name}"));
    }
    // 删除前提取图片引用，文件删除后清理无引用附件
    let refs = fs::read_to_string(&path)
        .map(|c| crate::commands::attachments::extract_image_refs(&c))
        .unwrap_or_default();
    fs::remove_file(&path).map_err(err)?;
    if let Err(e) = crate::commands::attachments::cleanup_unreferenced_attachments(&refs) {
        eprintln!("[qj] 清理笔记附件失败: {e}");
    }
    // 清理创建时间索引
    let mut index = load_created_index();
    if index.remove(&note_key(&notebook, &file_name)).is_some() {
        save_created_index(&index);
    }
    Ok(())
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn with_test_env(f: impl FnOnce() + Send + 'static) {
        // cargo test 并行执行，环境变量操作需串行（全局共享锁，见 paths::TEST_ENV_LOCK）
        let _g = crate::storage::paths::TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join("qingjian-test-notes");
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var("QINGJIAN_DATA_DIR", &dir);
        paths::ensure_dirs().unwrap();
        f();
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("QINGJIAN_DATA_DIR");
    }

    #[test]
    fn notebook_crud_roundtrip() {
        with_test_env(|| {
            create_notebook("工作".into()).unwrap();
            create_notebook("日记".into()).unwrap();
            create_notebook("工作".into()).expect_err("重复创建应失败");

            let books = list_notebooks().unwrap();
            let names: Vec<&str> = books.iter().map(|b| b.name.as_str()).collect();
            assert!(names.contains(&"工作"));
            assert!(names.contains(&"日记"));
            // inbox 置顶
            assert_eq!(books[0].name, paths::DEFAULT_NOTEBOOK);

            rename_notebook("工作".into(), "工作/2026?".into()).unwrap();
            assert!(list_notebooks().unwrap().iter().any(|b| b.name == "工作_2026_"));

            delete_notebook("工作_2026_".into()).unwrap();
            assert!(!list_notebooks().unwrap().iter().any(|b| b.name == "工作_2026_"));
        });
    }

    #[test]
    fn inbox_is_protected() {
        with_test_env(|| {
            delete_notebook("inbox".into()).expect_err("inbox 不可删除");
            rename_notebook("inbox".into(), "x".into()).expect_err("inbox 不可重命名");
        });
    }

    #[test]
    fn note_crud_and_title_extraction() {
        with_test_env(|| {
            let meta = create_note("inbox".into()).unwrap();
            assert!(meta.file_name.starts_with("无标题笔记"));
            let meta2 = create_note("inbox".into()).unwrap();
            assert_ne!(meta.file_name, meta2.file_name, "同分钟创建不冲突");

            save_note("inbox".into(), meta.file_name.clone(), "# 今日要事\n\n正文内容".into()).unwrap();
            let read = read_note("inbox".into(), meta.file_name.clone()).unwrap();
            assert_eq!(read.content, "# 今日要事\n\n正文内容");
            assert!(read.abs_path.contains("notes"));

            let listed = list_notes("inbox".into()).unwrap();
            let mine = listed.iter().find(|n| n.file_name == meta.file_name).unwrap();
            // 标题 = 文件名 stem（内容首行不参与——可能是正文）
            assert_eq!(mine.title, meta.file_name.trim_end_matches(".md"));

            // 改名
            let renamed = rename_note("inbox".into(), meta.file_name.clone(), "新标题".into()).unwrap();
            assert_eq!(renamed.file_name, "新标题.md");
            assert!(read_note("inbox".into(), "新标题.md".into()).is_ok());
            // 旧名读取失败
            assert!(read_note("inbox".into(), meta.file_name.clone()).is_err());

            delete_note("inbox".into(), "新标题.md".into()).unwrap();
            assert!(read_note("inbox".into(), "新标题.md".into()).is_err());
        });
    }

    #[test]
    fn created_time_preserved_across_save_and_rename() {
        with_test_env(|| {
            let meta = create_note("inbox".into()).unwrap();
            let created = meta.created_at;
            assert!(created > 0);

            // 保存（原子写 rename 会重置文件创建时间，索引必须保住原值）
            std::thread::sleep(std::time::Duration::from_millis(15));
            save_note("inbox".into(), meta.file_name.clone(), "内容".into()).unwrap();
            let after_save = list_notes("inbox".into())
                .unwrap()
                .into_iter()
                .find(|n| n.file_name == meta.file_name)
                .unwrap();
            assert_eq!(after_save.created_at, created, "保存后创建时间不变");
            assert!(after_save.updated_at > created, "修改时间晚于创建时间");

            // 改名保留创建时间
            let renamed = rename_note("inbox".into(), meta.file_name.clone(), "新名".into()).unwrap();
            assert_eq!(renamed.created_at, created, "改名后创建时间不变");
            let after_rename = list_notes("inbox".into())
                .unwrap()
                .into_iter()
                .find(|n| n.file_name == "新名.md")
                .unwrap();
            assert_eq!(after_rename.created_at, created);

            // 删除清理索引
            delete_note("inbox".into(), "新名.md".into()).unwrap();
            assert!(load_created_index().get(&note_key("inbox", "新名.md")).is_none());
        });
    }

    #[test]
    fn search_notes_finds_content_and_snippet() {
        with_test_env(|| {
            let a = create_note("inbox".into()).unwrap();
            let b = create_note("inbox".into()).unwrap();
            save_note("inbox".into(), a.file_name.clone(), "今天去植物园散步，风里有桂花香".into()).unwrap();
            save_note("inbox".into(), b.file_name.clone(), "完全无关的内容".into()).unwrap();

            let hits = search_notes("inbox".into(), "植物园".into()).unwrap();
            assert_eq!(hits.len(), 1, "只有内容含「植物园」的笔记命中");
            assert_eq!(hits[0].file_name, a.file_name);
            assert!(hits[0].snippet.contains("植物园"));

            // 摘要不包含格式标记（行内 HTML 等）
            save_note(
                "inbox".into(),
                a.file_name.clone(),
                "前缀内容<span style=\"font-size: 18px\">植物园</span>后缀".into(),
            )
            .unwrap();
            let hits2 = search_notes("inbox".into(), "植物园".into()).unwrap();
            assert!(hits2[0].snippet.contains("植物园"));
            assert!(
                !hits2[0].snippet.contains("font-size"),
                "摘要不应包含 HTML 属性: {:?}",
                hits2[0].snippet
            );
            assert!(!hits2[0].snippet.contains('<'));

            // 大小写不敏感
            let hits2 = search_notes("inbox".into(), "ABC".into()).unwrap();
            assert!(hits2.is_empty());
            save_note("inbox".into(), b.file_name.clone(), "abc def".into()).unwrap();
            let hits3 = search_notes("inbox".into(), "ABC".into()).unwrap();
            assert_eq!(hits3.len(), 1);

            // 空查询返回空
            assert!(search_notes("inbox".into(), "  ".into()).unwrap().is_empty());
        });
    }

    #[test]
    fn rejects_path_traversal() {
        with_test_env(|| {
            assert!(list_notes("..".into()).is_err());
            assert!(read_note("..".into(), "x.md".into()).is_err());
            assert!(read_note("inbox".into(), "../evil.md".into()).is_err());
            assert!(save_note("inbox".into(), "..\\evil.md".into(), "x".into()).is_err());
        });
    }

    #[test]
    fn duplicate_rename_rejected() {
        with_test_env(|| {
            let a = create_note("inbox".into()).unwrap();
            let b = create_note("inbox".into()).unwrap();
            save_note("inbox".into(), b.file_name.clone(), "内容B".into()).unwrap();
            rename_note("inbox".into(), a.file_name.clone(), "目标名".into()).unwrap();
            rename_note("inbox".into(), b.file_name.clone(), "目标名".into())
                .expect_err("重名改名应失败");
        });
    }
}
