//! 原子文件写入：临时文件（与目标同目录，跨卷 rename 会失败）+ sync_all + rename。
//! Windows 上 std::fs::rename 走 MoveFileExW(MOVEFILE_REPLACE_EXISTING)，可覆盖且原子。

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn atomic_write(path: &Path, content: &str) -> io::Result<()> {
    atomic_write_bytes(path, content.as_bytes())
}

pub fn atomic_write_bytes(path: &Path, content: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "目标路径无父目录"))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "目标文件名无效"))?;

    // 进程号 + 自增序号保证多线程并发写同一文件时临时名不冲突
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{file_name}.tmp-{}-{seq}", std::process::id()));

    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(content)?;
        f.sync_all()?; // rename 前确保数据落盘
        fs::rename(&tmp, path)?;
        Ok(())
    })();

    // 失败时清理临时文件
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    fn test_file(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("qingjian-test-atomic");
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn writes_and_overwrites() {
        let p = test_file("overwrite.txt");
        atomic_write(&p, "第一版").unwrap();
        atomic_write(&p, "第二版").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "第二版");
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn concurrent_writes_never_corrupt() {
        // 4 线程 × 50 次并发写同一文件：最终内容必须是某一次完整 payload
        let p = test_file("concurrent.txt");
        let path = Arc::new(p.clone());
        let payloads: Vec<String> = (0..200).map(|i| format!("payload-{i}-{}\n", "x".repeat(64))).collect();
        let payloads = Arc::new(payloads);

        let mut handles = vec![];
        for t in 0..4 {
            let path = path.clone();
            let payloads = payloads.clone();
            handles.push(thread::spawn(move || {
                for i in 0..50 {
                    let idx = t * 50 + i;
                    atomic_write(&path, &payloads[idx]).unwrap();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        let final_content = fs::read_to_string(&p).unwrap();
        assert!(
            payloads.iter().any(|pl| pl == &final_content),
            "最终文件必须是某次完整写入的 payload"
        );
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn writes_into_missing_dir_fails_cleanly() {
        let p = test_file("no-such-dir/nested.txt");
        assert!(atomic_write(&p, "x").is_err());
    }
}
