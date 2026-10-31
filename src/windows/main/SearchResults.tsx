// 搜索结果页：占用内容区，卡片网格展示命中笔记（参考「原子笔记」的全屏搜索结果）。
// 侧栏搜索框清空后回到原来的笔记。
import { useEffect, useMemo, useState } from "react";
import { api, type SearchHit } from "../../lib/api";
import { useNoteStore } from "../../stores/useNoteStore";
import { useFragmentStore } from "../../stores/useFragmentStore";

/** 把片段里的关键词包成 <mark>，其余部分原样输出（片段来自后端纯文本，不含标签） */
function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const at = lower.indexOf(ql, i);
    if (at < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={key++} className="qj-search-mark">
        {text.slice(at, at + q.length)}
      </mark>
    );
    i = at + q.length;
  }
  return parts;
}

export function SearchResults() {
  const query = useFragmentStore((s) => s.searchQuery);
  const openNote = useNoteStore((s) => s.openNote);
  const setPendingReveal = useNoteStore((s) => s.setPendingReveal);

  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 防抖：输入停下来再查，避免每敲一个字就扫全盘
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setError(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchAllNotes(q, 200)
        .then((res) => {
          setHits(res);
          setError(null);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const arr = map.get(h.notebook) ?? [];
      arr.push(h);
      map.set(h.notebook, arr);
    }
    return [...map.entries()];
  }, [hits]);

  return (
    <section className="qj-search-results">
      <header className="qj-search-head">
        <h2 className="qj-search-title">
          搜索「{query.trim()}」
          <span className="qj-search-count">
            {loading ? "搜索中…" : `${hits.length} 条`}
          </span>
        </h2>
      </header>

      {error && <div className="qj-empty">搜索失败：{error}</div>}

      {!error && !loading && hits.length === 0 && (
        <div className="qj-empty">
          <p className="qj-empty-hint">没有找到包含「{query.trim()}」的笔记</p>
        </div>
      )}

      <div className="qj-search-body">
        {grouped.map(([notebook, list]) => (
          <section key={notebook} className="qj-search-group">
            <h3 className="qj-search-group-title">
              {notebook}
              <span className="qj-search-group-count">{list.length}</span>
            </h3>
            <div className="qj-search-grid">
              {list.map((h) => (
                <button
                  key={`${h.notebook}/${h.fileName}`}
                  type="button"
                  className="qj-search-card"
                  onMouseDown={() => {
                    // 打开笔记并在文中定位到关键词（沿用原来的 pendingReveal 机制）
                    openNote(h.notebook, h.fileName);
                    setPendingReveal({
                      notebook: h.notebook,
                      fileName: h.fileName,
                      query: query.trim(),
                    });
                    // 清空搜索 → 回到刚打开的那篇笔记
                    useFragmentStore.getState().setSearchQuery("");
                  }}
                >
                  <span className="qj-search-card-title">{highlight(h.title, query)}</span>
                  <span className="qj-search-card-snippet">{highlight(h.snippet, query)}</span>
                  <span className="qj-search-card-meta">{h.notebook}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
