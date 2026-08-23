// 中部笔记列表：搜索 + 新建 + 重命名/删除（按更新时间倒序）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNoteStore } from "../../stores/useNoteStore";
import { confirmAction } from "../../lib/confirm";
import { IconPencil, IconPlus, IconTrash } from "../../components/common/icons";
import { debounce } from "../../lib/debounce";
import { api } from "../../lib/api";
import { useWheelScroll } from "../../lib/useWheelScroll";

/** 排序方式（偏好存 localStorage） */
type SortMode = "updated" | "created" | "name";

/** 摘要中高亮检索词（首个命中） */
function highlightSnippet(snippet: string, q: string): ReactNode {
  const idx = snippet.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0 || !q) return snippet;
  return (
    <>
      {snippet.slice(0, idx)}
      <mark className="qj-snippet-mark">{snippet.slice(idx, idx + q.length)}</mark>
      {snippet.slice(idx + q.length)}
    </>
  );
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function NoteList() {
  const notes = useNoteStore((s) => s.notes);
  const activeNotebook = useNoteStore((s) => s.activeNotebook);
  const openTabs = useNoteStore((s) => s.openTabs);
  const activeTabId = useNoteStore((s) => s.activeTabId);
  const createNote = useNoteStore((s) => s.createNote);
  const openNote = useNoteStore((s) => s.openNote);
  const renameNote = useNoteStore((s) => s.renameNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const renameNoteInList = useNoteStore((s) => s.renameNoteInList);
  const deleteNoteInList = useNoteStore((s) => s.deleteNoteInList);

  const [query, setQuery] = useState("");
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem("qj-sort") as SortMode) || "updated"
  );

  useEffect(() => {
    localStorage.setItem("qj-sort", sortMode);
  }, [sortMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.fileName.toLowerCase().includes(q)
    );
  }, [notes, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortMode === "created") {
      arr.sort((a, b) => b.createdAt - a.createdAt); // 最新创建在前
    } else if (sortMode === "name") {
      arr.sort((a, b) => a.title.localeCompare(b.title, "zh")); // 按名称（中文排序）
    } else {
      arr.sort((a, b) => b.updatedAt - a.updatedAt); // 最近修改在前
    }
    return arr;
  }, [filtered, sortMode]);

  // 内容全文检索（同一笔记本内）：防抖 300ms 调 Rust 搜索
  // 坑：防抖闭包会捕获创建时的 activeNotebook（首次渲染为 null）导致永远空结果，
  // 必须在回调内从 store 取实时值
  const [contentHits, setContentHits] = useState<{ fileName: string; snippet: string }[]>([]);
  const debouncedSearchRef = useRef(
    debounce(async (q: string) => {
      const nb = useNoteStore.getState().activeNotebook;
      if (!q.trim() || !nb) {
        setContentHits([]);
        return;
      }
      try {
        const hits = await api.searchNotes(nb, q);
        setContentHits(hits.map((h) => ({ fileName: h.fileName, snippet: h.snippet })));
      } catch (e) {
        console.error("内容检索失败", e);
        setContentHits([]);
      }
    }, 300)
  );
  useEffect(() => {
    void debouncedSearchRef.current(query);
  }, [query, activeNotebook]);

  // 合并展示：标题/文件名命中的笔记 + 内容命中（未在列表中的补充显示摘要）
  const displayItems = useMemo(() => {
    if (!query.trim()) return sorted.map((n) => ({ kind: "note" as const, note: n, hit: null as null }));
    const seen = new Set(sorted.map((n) => n.fileName));
    const extra = contentHits
      .filter((h) => !seen.has(h.fileName))
      .map((h) => ({ kind: "hit" as const, note: null as null, hit: h }));
    return [
      ...sorted.map((n) => ({ kind: "note" as const, note: n, hit: null as null })),
      ...extra,
    ];
  }, [sorted, contentHits, query]);

  const tabIdOf = (fileName: string) => `${activeNotebook}/${fileName}`;

  // WebView2 滚轮接管
  const itemsRef = useRef<HTMLDivElement>(null);
  useWheelScroll(itemsRef);

  const submitRename = (fileName: string) => {
    const title = editValue.trim();
    setEditingFile(null);
    setEditValue("");
    if (!title || !activeNotebook) return;
    const tabId = tabIdOf(fileName);
    const tab = openTabs.find((t) => t.id === tabId);
    if (tab) void renameNote(tabId, title);
    else void renameNoteInList(fileName, title);
  };

  return (
    <section className="qj-note-list">
      <header className="qj-note-list-header">
        <input
          className="qj-input"
          placeholder="搜索笔记…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="qj-sort-select"
          title="排序方式"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
        >
          <option value="updated">最近修改</option>
          <option value="created">最新创建</option>
          <option value="name">名称</option>
        </select>
        <button type="button" className="qj-btn-primary" title="新建笔记" onClick={() => void createNote()}>
          <IconPlus size={15} />
        </button>
      </header>
      <div className="qj-note-items" ref={itemsRef}>
        {displayItems.length === 0 && (
          <div className="qj-empty qj-empty-small">{query ? "没有匹配的笔记" : "还没有笔记，点击 ＋ 新建"}</div>
        )}
        {displayItems.map((item) => {
          if (item.kind === "hit" && item.hit) {
            // 内容命中的笔记（标题未命中）：摘要展示 + 点击定位到文中
            const hitTitle =
              notes.find((n) => n.fileName === item.hit!.fileName)?.title ??
              item.hit.fileName.replace(/\.md$/, "");
            return (
              <div
                key={`hit-${item.hit.fileName}`}
                className="qj-note-item qj-note-hit"
                onMouseDown={() => {
                  const nb = activeNotebook!;
                  openNote(nb, item.hit!.fileName);
                  useNoteStore.getState().setPendingReveal({
                    notebook: nb,
                    fileName: item.hit!.fileName,
                    query: query.trim(),
                  });
                }}
              >
                <div className="qj-note-item-main">
                  <span className="qj-note-title">
                    <span className="qj-hit-badge">内容</span>
                    {hitTitle}
                  </span>
                  <span className="qj-note-snippet">
                    {highlightSnippet(item.hit.snippet, query.trim())}
                  </span>
                </div>
              </div>
            );
          }
          const note = item.note!;
          const tabId = tabIdOf(note.fileName);
          const isOpen = openTabs.some((t) => t.id === tabId);
          return (
            <div
              key={note.fileName}
              className={`qj-note-item${tabId === activeTabId ? " is-active" : ""}`}
              onMouseDown={() => openNote(activeNotebook!, note.fileName)}
            >
              {editingFile === note.fileName ? (
                <input
                  className="qj-input"
                  autoFocus
                  value={editValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => submitRename(note.fileName)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename(note.fileName);
                    if (e.key === "Escape") {
                      setEditingFile(null);
                      setEditValue("");
                    }
                  }}
                />
              ) : (
                <>
                  <div className="qj-note-item-main">
                    <span className="qj-note-title">{note.title}</span>
                    <span className="qj-note-time">{formatTime(note.updatedAt)}</span>
                  </div>
                  <div className="qj-note-item-actions">
                    {isOpen && <span className="qj-note-open-dot" title="已打开" />}
                    <button
                      type="button"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFile(note.fileName);
                        setEditValue(note.title);
                      }}
                    >
                      <IconPencil size={12} />
                    </button>
                    <button
                      type="button"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmAction(`删除笔记「${note.title}」？`, () => {
                          if (isOpen) void deleteNote(tabId);
                          else void deleteNoteInList(note.fileName);
                        });
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
