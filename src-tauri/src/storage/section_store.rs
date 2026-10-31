//! 每日碎片 section 拼接引擎（核心难点）。
//!
//! 方案：标记块拼接（marker-splice），不是整文件重建——进程重启后内存 store 为空，
//! 若每次保存重建整文件，第一个新窗口的首次保存会抹掉当日此前所有碎片。
//! 拼接式每次只读改写属于自己的块，块外内容（含外部编辑）永远保留。
//!
//! 文件格式（daily/2026-08-15.md）：
//! ```markdown
//! # 2026-08-15
//!
//! <!-- qj:section:<uuid> begin -->
//! ## 碎片 · 14:23
//! 内容……
//! <!-- qj:section:<uuid> end -->
//! ```
//!
//! 并发安全：DailyState 单锁串行化所有 mutation 与读-改-写；
//! 落盘用 atomic.rs 的临时文件 + rename（Windows 原子覆盖）。

use crate::storage::atomic;
use chrono::{DateTime, Local, NaiveDate};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

#[derive(Clone)]
pub struct Section {
    pub id: String,
    pub day: NaiveDate,
    pub created_at: DateTime<Local>,
    pub content: String,
}

/// 内存中的当日 section 集合（顺序 = 注册顺序 = 文件内顺序）
pub struct SectionStore {
    pub sections: Vec<Section>,
    pub day: NaiveDate,
}

pub struct DailyState {
    pub store: Mutex<Option<SectionStore>>,
    /// 窗口 label → section id（关窗注销用）
    pub label_to_section: Mutex<HashMap<String, String>>,
}

impl DailyState {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(None),
            label_to_section: Mutex::new(HashMap::new()),
        }
    }
}

// ---------- 块渲染与拼接 ----------

pub fn begin_marker(id: &str) -> String {
    format!("<!-- qj:section:{id} begin -->")
}

pub fn end_marker(id: &str) -> String {
    format!("<!-- qj:section:{id} end -->")
}

fn render_block(section: &Section) -> String {
    let time = section.created_at.format("%H:%M");
    format!(
        "{}\n## 碎片 · {}\n{}\n{}",
        begin_marker(&section.id),
        time,
        section.content.trim(),
        end_marker(&section.id)
    )
}

/// 当日文件头（文件不存在时初始化用）
fn file_header(day: NaiveDate) -> String {
    format!("# {}\n", day.format("%Y-%m-%d"))
}

/// 把某个 section 的块写进当日文件：
/// - 文件不存在：创建（含头）并追加块
/// - 标记存在：替换标记内部
/// - 标记被外部删除：追加到末尾（保留外部内容）
pub fn splice_section(path: &Path, section: &Section) -> std::io::Result<()> {
    let begin = begin_marker(&section.id);
    let end = end_marker(&section.id);
    let block = render_block(section);

    let existing = if path.exists() {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        file_header(section.day)
    };

    let (start, end_idx) = find_markers(&existing, &begin, &end);
    let new_content = match (start, end_idx) {
        (Some(s), Some(e)) => {
            let mut out = String::with_capacity(existing.len() + block.len());
            out.push_str(&existing[..s]);
            out.push_str(&block);
            out.push_str(&existing[e..]);
            out
        }
        _ => {
            let mut out = existing;
            if !out.ends_with('\n') {
                out.push('\n');
            }
            out.push('\n');
            out.push_str(&block);
            out.push('\n');
            out
        }
    };

    atomic::atomic_write(path, &new_content)
}

/// 从文件中移除某 section 的块（含标记行）
pub fn remove_section_from_file(path: &Path, section_id: &str) -> std::io::Result<()> {
    let existing = if path.exists() {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        return Ok(());
    };
    let begin = begin_marker(section_id);
    let end = end_marker(section_id);
    let (start, end_idx) = find_markers(&existing, &begin, &end);
    if let (Some(s), Some(e)) = (start, end_idx) {
        let mut out = String::with_capacity(existing.len());
        out.push_str(&existing[..s]);
        out.push_str(&existing[e..]);
        // 压缩产生的连续空行（保留最多一个空行）
        let cleaned = out.replace("\n\n\n", "\n\n");
        atomic::atomic_write(path, &cleaned)
    } else {
        Ok(())
    }
}

/// 查找 begin/end 标记的行首位置与 end 标记行末位置
fn find_markers(content: &str, begin: &str, end: &str) -> (Option<usize>, Option<usize>) {
    let start = content.find(begin);
    let end_start = content.find(end).map(|i| i + end.len());
    (start, end_start)
}

/// 移除文件中所有内容为空的 section 块（含标记行）。
/// 用于自清理：StrictMode 双注册、异常退出等遗留的孤儿空块；有内容的块永远保留。
/// 返回移除数量。
pub fn remove_empty_sections(path: &Path) -> std::io::Result<usize> {
    let content = if path.exists() {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        return Ok(0);
    };

    // 解析块边界：收集每个 [begin_start, end_end) 区间与块内文本
    let mut blocks: Vec<(usize, usize, String)> = Vec::new();
    let mut pos = 0usize;
    while let Some(rel_begin) = content[pos..].find("<!-- qj:section:") {
        let begin_start = pos + rel_begin;
        let Some(rel_end) = content[begin_start..].find("end -->") else {
            break; // 未闭合的标记，放弃处理
        };
        let end_end = begin_start + rel_end + "end -->".len();
        let inner_start = content[begin_start..end_end].find("-->").map(|i| begin_start + i + 3).unwrap_or(begin_start);
        let inner_end = content[..end_end].rfind("<!--").unwrap_or(end_end);
        let inner = content[inner_start..inner_end].to_string();
        blocks.push((begin_start, end_end, inner));
        pos = end_end;
    }

    if blocks.is_empty() {
        return Ok(0);
    }

    // 倒序移除空块，避免索引偏移
    let mut removed = 0;
    let mut out = content;
    for (start, end, inner) in blocks.into_iter().rev() {
        // 块内去掉标题行（"## 碎片 · HH:mm"）后仍有内容才算非空
        let meaningful = inner
            .lines()
            .any(|l| !l.trim().is_empty() && !l.trim_start().starts_with("## 碎片"));
        if !meaningful {
            out.replace_range(start..end, "");
            removed += 1;
        }
    }
    // 压缩连续空行（仅在有移除时落盘）
    if removed > 0 {
        let cleaned = out.replace("\n\n\n", "\n\n");
        atomic::atomic_write(path, &cleaned)?;
    }
    Ok(removed)
}

// ---------- DailyState 操作（全部在单锁内） ----------

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn day_path(day: NaiveDate) -> Result<std::path::PathBuf, String> {
    Ok(crate::storage::paths::daily_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{}.md", day.format("%Y-%m-%d"))))
}

impl DailyState {
    /// 注册碎片窗口：生成 section、追加空块、记录 label→id 映射。返回 section_id。
    /// 幂等：同一窗口 label 重复注册（如前端 StrictMode 双挂载）时返回既有 section_id，
    /// 避免产生孤儿空块。
    pub fn register(&self, window_label: &str) -> Result<String, String> {
        // 已注册过（StrictMode 双挂载 / 重试）→ 直接复用
        if let Some(existing) = self.label_to_section.lock().unwrap().get(window_label) {
            return Ok(existing.clone());
        }

        let mut store = self.store.lock().unwrap();
        let day = today();

        // store 未加载或日期变了 → 重新加载（进程重启后第一个窗口）
        let fresh = store.as_ref().map(|s| s.day != day).unwrap_or(true);
        if fresh {
            *store = Some(SectionStore {
                sections: Vec::new(),
                day,
            });
            // 自清理：移除文件中无内容的孤儿空块（历史 bug / 异常退出遗留），
            // 有内容的块永远保留
            if let Ok(path) = day_path(day) {
                if let Err(e) = remove_empty_sections(&path) {
                    eprintln!("[qj] 清理孤儿空块失败: {e}");
                }
            }
        }
        let store = store.as_mut().unwrap();

        let section = Section {
            id: uuid::Uuid::new_v4().simple().to_string(),
            day,
            created_at: Local::now(),
            content: String::new(),
        };

        // 只登记，不落盘：以前的实现注册即写一个空块进当日文件，
        // 窗口被强杀 / 进程崩溃时 Destroyed 钩子跑不到，那个空块就永久留在文件里，
        // 每日碎片里于是出现空白页。改成首次 save 时才写（见 save 的 need_insert）。
        let id = section.id.clone();
        store.sections.push(section);
        self.label_to_section
            .lock()
            .unwrap()
            .insert(window_label.to_string(), id.clone());
        Ok(id)
    }

    /// 保存碎片内容（含跨午夜迁移）
    pub fn save(&self, section_id: &str, content: String) -> Result<(), String> {
        let mut store_guard = self.store.lock().unwrap();
        let store = store_guard.as_mut().ok_or("碎片会话未初始化")?;
        let idx = store
            .sections
            .iter()
            .position(|s| s.id == section_id)
            .ok_or("碎片会话不存在")?;

        let day = today();
        if store.sections[idx].day != day {
            // 跨午夜：旧文件移除块，迁移到新日期文件
            let old_day = store.sections[idx].day;
            let old_path = day_path(old_day)?;
            remove_section_from_file(&old_path, section_id).map_err(|e| format!("迁移失败: {e}"))?;
            store.sections[idx].day = day;
            store.day = day;
        }

        // 全空白不落盘：配合同样去掉了 register 里的写块，整个生命周期里
        // 只有"真的有内容"才会在当日文件里出现一个块。
        // 清空已有块时则要删文件里的块，否则内容删了、空块还留着。
        let was_empty = store.sections[idx].content.trim().is_empty();
        store.sections[idx].content = content;
        let path = day_path(day)?;
        let section = store.sections[idx].clone();

        if section.content.trim().is_empty() {
            if !was_empty {
                remove_section_from_file(&path, section_id).map_err(|e| format!("清空碎片失败: {e}"))?;
            }
            return Ok(());
        }

        splice_section(&path, &section).map_err(|e| format!("保存碎片失败: {e}"))
    }

    /// 注销（窗口关闭）：内容为空则删块，否则保留块（内容留在当日文件里）。
    /// 同时清理 label 映射。
    pub fn unregister_by_label(&self, window_label: &str) -> Result<(), String> {
        let section_id = self
            .label_to_section
            .lock()
            .unwrap()
            .remove(window_label);
        if let Some(id) = section_id {
            self.unregister(&id)?;
        }
        Ok(())
    }

    pub fn unregister(&self, section_id: &str) -> Result<(), String> {
        let mut store_guard = self.store.lock().unwrap();
        let store = store_guard.as_mut().ok_or("碎片会话未初始化")?;
        let idx = store
            .sections
            .iter()
            .position(|s| s.id == section_id)
            .ok_or("碎片会话不存在")?;

        let section = store.sections[idx].clone();
        let path = day_path(section.day)?;
        if section.content.trim().is_empty() {
            remove_section_from_file(&path, section_id).map_err(|e| format!("移除空块失败: {e}"))?;
        }
        // 非空：块已在上次 save 落盘，保留即可

        store.sections.remove(idx);
        if store.sections.is_empty() {
            *store_guard = None;
        }
        Ok(())
    }
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn with_test_env(f: impl FnOnce() + Send + 'static) {
        let _g = crate::storage::paths::TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join("qingjian-test-sections");
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var("QINGJIAN_DATA_DIR", &dir);
        crate::storage::paths::ensure_dirs().unwrap();
        f();
        let _ = fs::remove_dir_all(&dir);
        std::env::remove_var("QINGJIAN_DATA_DIR");
    }

    fn test_section(id: &str, day: NaiveDate, content: &str) -> Section {
        Section {
            id: id.to_string(),
            day,
            created_at: Local::now(),
            content: content.to_string(),
        }
    }

    #[test]
    fn splice_replaces_own_block_and_preserves_others() {
        with_test_env(|| {
            let day = today();
            let path = day_path(day).unwrap();

            let a = test_section("aaa", day, "内容A");
            let b = test_section("bbb", day, "内容B");
            splice_section(&path, &a).unwrap();
            splice_section(&path, &b).unwrap();

            // 更新 A：B 的内容与块外内容保留
            let a2 = test_section("aaa", day, "内容A改");
            splice_section(&path, &a2).unwrap();

            let content = fs::read_to_string(&path).unwrap();
            assert!(content.contains("内容A改"));
            assert!(!content.contains("内容A\n")); // 旧 A 被替换
            assert!(content.contains("内容B"));
            // A 与 B 的块都在，且顺序为注册顺序
            let pos_a = content.find(&begin_marker("aaa")).unwrap();
            let pos_b = content.find(&begin_marker("bbb")).unwrap();
            assert!(pos_a < pos_b);
        });
    }

    #[test]
    fn splice_appends_when_marker_deleted_externally() {
        with_test_env(|| {
            let day = today();
            let path = day_path(day).unwrap();
            let a = test_section("aaa", day, "内容A");
            splice_section(&path, &a).unwrap();

            // 外部编辑：删掉标记行（保留其他内容）
            let mut external = fs::read_to_string(&path).unwrap();
            external = external.replace(&begin_marker("aaa"), "").replace(&end_marker("aaa"), "");
            external.push_str("\n外部添加的内容\n");
            fs::write(&path, &external).unwrap();

            let a2 = test_section("aaa", day, "内容A2");
            splice_section(&path, &a2).unwrap();
            let content = fs::read_to_string(&path).unwrap();
            assert!(content.contains("外部添加的内容"), "块外内容必须保留");
            assert!(content.contains("内容A2"), "新块必须追加");
            assert!(content.contains(&begin_marker("aaa")));
        });
    }

    #[test]
    fn remove_section_cleans_block() {
        with_test_env(|| {
            let day = today();
            let path = day_path(day).unwrap();
            let a = test_section("aaa", day, "");
            let b = test_section("bbb", day, "B");
            splice_section(&path, &a).unwrap();
            splice_section(&path, &b).unwrap();

            remove_section_from_file(&path, "aaa").unwrap();
            let content = fs::read_to_string(&path).unwrap();
            assert!(!content.contains(&begin_marker("aaa")));
            assert!(content.contains(&begin_marker("bbb")));
        });
    }

    #[test]
    fn concurrent_registers_and_saves_are_serialized() {
        with_test_env(|| {
            let state = std::sync::Arc::new(DailyState::new());
            let handles: Vec<_> = (0..6)
                .map(|i| {
                    let state = state.clone();
                    std::thread::spawn(move || {
                        let label = format!("frag-{i}");
                        let id = state.register(&label).unwrap();
                        for round in 0..10 {
                            state
                                .save(&id, format!("窗口{i} 第{round}轮内容：{}", "x".repeat(20)))
                                .unwrap();
                        }
                        // 模拟关窗：非空内容保留块
                        state.unregister_by_label(&label).unwrap();
                    })
                })
                .collect();
            for h in handles {
                h.join().unwrap();
            }

            let path = day_path(today()).unwrap();
            let content = fs::read_to_string(&path).unwrap();
            assert!(content.starts_with("# "));
            for i in 0..6 {
                assert!(
                    content.contains(&format!("窗口{i} 第9轮内容")),
                    "每个窗口最后的内容必须在文件中"
                );
            }
            // 6 个 begin 标记 = 6 个块
            assert_eq!(content.matches("<!-- qj:section:").count(), 6 * 2);
        });
    }

    #[test]
    fn empty_section_removed_on_unregister() {
        with_test_env(|| {
            let state = DailyState::new();
            let id = state.register("frag-x").unwrap();
            // 先写点东西再删掉：内容清空时块就应消失
            state.save(&id, "临时".into()).unwrap();
            state.save(&id, "".into()).unwrap();
            state.unregister_by_label("frag-x").unwrap();
            let path = day_path(today()).unwrap();
            let content = fs::read_to_string(&path).unwrap_or_default();
            assert!(!content.contains("qj:section"), "空块应被移除");
            // 文件头保留（写过就有头）
            assert!(content.is_empty() || content.starts_with("# "));
        });
    }

    #[test]
    fn register_is_idempotent_per_label() {
        with_test_env(|| {
            let state = DailyState::new();
            let first = state.register("frag-y").unwrap();
            let second = state.register("frag-y").unwrap();
            assert_eq!(first, second, "重复注册必须返回同一 section");

            state.save(&first, "内容X".into()).unwrap();
            let path = day_path(today()).unwrap();
            let content = fs::read_to_string(&path).unwrap();
            assert_eq!(
                content.matches("<!-- qj:section:").count(),
                2,
                "只应有一个块"
            );
        });
    }

    #[test]
    fn register_alone_leaves_no_file() {
        with_test_env(|| {
            let state = DailyState::new();
            let id = state.register("frag-blank").unwrap();
            let path = day_path(today()).unwrap();
            assert!(
                !path.exists() || fs::read_to_string(&path).unwrap().trim().is_empty(),
                "只注册不输入时，不该在当日文件里留下任何块"
            );
            // 关闭窗口同样不该留东西
            state.unregister(&id).unwrap();
            assert!(!path.exists() || fs::read_to_string(&path).unwrap().trim().is_empty());
        });
    }

    #[test]
    fn save_writes_block_on_first_content_and_removes_on_blank() {
        with_test_env(|| {
            let state = DailyState::new();
            let id = state.register("frag-x").unwrap();
            let path = day_path(today()).unwrap();

            // 空白内容不落盘
            state.save(&id, "   \n  ".into()).unwrap();
            assert!(!path.exists() || fs::read_to_string(&path).unwrap().trim().is_empty());

            // 有内容才写
            state.save(&id, "第一段".into()).unwrap();
            let content = fs::read_to_string(&path).unwrap();
            assert!(content.contains("第一段"));

            // 再清空 → 块要被删掉，不能留空壳
            state.save(&id, "".into()).unwrap();
            let content = fs::read_to_string(&path).unwrap_or_default();
            assert!(
                !content.contains(&id),
                "清空后块必须从文件里移除，否则每日碎片会出现空白页"
            );
        });
    }

    #[test]
    fn remove_empty_sections_keeps_content_blocks() {
        with_test_env(|| {
            let day = today();
            let path = day_path(day).unwrap();
            let a = test_section("aaa", day, "");
            let b = test_section("bbb", day, "有内容的块");
            let c = test_section("ccc", day, "");
            splice_section(&path, &a).unwrap();
            splice_section(&path, &b).unwrap();
            splice_section(&path, &c).unwrap();

            let removed = remove_empty_sections(&path).unwrap();
            assert_eq!(removed, 2, "两个空块应被移除");
            let content = fs::read_to_string(&path).unwrap();
            assert!(!content.contains(&begin_marker("aaa")));
            assert!(!content.contains(&begin_marker("ccc")));
            assert!(content.contains(&begin_marker("bbb")));
            assert!(content.contains("有内容的块"));
        });
    }
}
