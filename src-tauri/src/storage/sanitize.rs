//! Windows 文件名清洗。
//!
//! 规则：
//! 1. 去除首尾空白与控制字符
//! 2. 非法字符 `\ / : * ? " < > |` 替换为 `_`，连续 `_` 折叠
//! 3. 去除尾随的 `.` 与空格（Windows 不允许）
//! 4. 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，含带扩展名形式）前加 `_`
//! 5. 结果为空时回退 "未命名"
//!
//! 中文等 Unicode 字符原样保留。

const ILLEGAL_CHARS: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn is_reserved(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or(name);
    let upper = base.to_ascii_uppercase();
    RESERVED.contains(&upper.as_str())
}

/// 清洗任意用户输入的名称（笔记本名 / 笔记标题），返回安全的文件/目录名。
pub fn sanitize_name(input: &str) -> String {
    let mut out: String = input
        .chars()
        .map(|c| {
            if c.is_control() || ILLEGAL_CHARS.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();

    // 折叠连续下划线
    let mut folded = String::with_capacity(out.len());
    let mut prev_underscore = false;
    for c in out.chars() {
        if c == '_' {
            if !prev_underscore {
                folded.push(c);
            }
            prev_underscore = true;
        } else {
            folded.push(c);
            prev_underscore = false;
        }
    }
    out = folded;

    // 去尾随点与空格（Windows 限制）
    while out.ends_with('.') || out.ends_with(' ') {
        out.pop();
    }
    // 去首部空格
    out = out.trim_start().to_string();

    if out.is_empty() || out.chars().all(|c| c == '_') {
        out = "未命名".to_string();
    }
    if is_reserved(&out) {
        out = format!("_{out}");
    }
    out
}

/// 校验既有名称是否可安全用作文件/目录名（读路径时的防穿越检查）。
/// 返回 false 表示名称含路径分隔符、`..`、非法字符、控制字符或为空。
pub fn is_safe_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    !name
        .chars()
        .any(|c| c.is_control() || ILLEGAL_CHARS.contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_illegal_chars() {
        assert_eq!(sanitize_name("a/b:c*d?e\"f<g>h|i"), "a_b_c_d_e_f_g_h_i");
    }

    #[test]
    fn keeps_chinese() {
        assert_eq!(sanitize_name("日记"), "日记");
        assert_eq!(sanitize_name("工作/2026?"), "工作_2026_");
    }

    #[test]
    fn trims_trailing_dots_and_spaces() {
        assert_eq!(sanitize_name("标题..."), "标题");
        assert_eq!(sanitize_name("  标题  "), "标题");
    }

    #[test]
    fn collapses_underscore_runs() {
        assert_eq!(sanitize_name("a??b"), "a_b");
    }

    #[test]
    fn empty_falls_back() {
        assert_eq!(sanitize_name("   "), "未命名");
        assert_eq!(sanitize_name(""), "未命名");
        assert_eq!(sanitize_name("???"), "未命名"); // ??? → _ → 折叠 → "_" 不是空，需注意
    }

    #[test]
    fn reserved_names_escaped() {
        assert_eq!(sanitize_name("CON"), "_CON");
        assert_eq!(sanitize_name("con.txt"), "_con.txt");
        assert_eq!(sanitize_name("LPT9"), "_LPT9");
        assert_eq!(sanitize_name("com3"), "_com3");
    }

    #[test]
    fn safe_name_validation() {
        assert!(is_safe_name("日记"));
        assert!(is_safe_name("无标题笔记 2026-08-15 14-23"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name("a/b"));
        assert!(!is_safe_name("a\\b"));
        assert!(!is_safe_name("a:b"));
    }
}
