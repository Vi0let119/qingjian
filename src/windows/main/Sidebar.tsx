// 左侧导航栏：应用头 + 笔记本树 + 底部植物点缀（M4 加入每日碎片入口）。
import { useRef, useState } from "react";
import { useNoteStore } from "../../stores/useNoteStore";
import { useFragmentStore } from "../../stores/useFragmentStore";
import { confirmAction } from "../../lib/confirm";
import { openSettingsWindow } from "./openSettings";
import {
  IconCalendar,
  IconGear,
  IconNotebook,
  IconPencil,
  IconPlus,
  IconSprout,
  IconTrash,
} from "../../components/common/icons";
import { useWheelScroll } from "../../lib/useWheelScroll";

/** 打开设置窗口（单例：已存在则聚焦；按当前主题传窗口效果） */


export function Sidebar() {
  const dailyBrowserOpen = useFragmentStore((s) => s.dailyBrowserOpen);
  // WebView2 滚轮接管
  const notebookListRef = useRef<HTMLElement>(null);
  useWheelScroll(notebookListRef);
  const notebooks = useNoteStore((s) => s.notebooks);
  const activeNotebook = useNoteStore((s) => s.activeNotebook);
  const selectNotebook = useNoteStore((s) => s.selectNotebook);
  const createNotebook = useNoteStore((s) => s.createNotebook);
  const renameNotebook = useNoteStore((s) => s.renameNotebook);
  const deleteNotebook = useNoteStore((s) => s.deleteNotebook);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const submitAdd = () => {
    const name = newName.trim();
    setNewName("");
    setAdding(false);
    if (name) void createNotebook(name);
  };

  const submitRename = (oldName: string) => {
    const name = editValue.trim();
    setEditingName(null);
    setEditValue("");
    if (name && name !== oldName) void renameNotebook(oldName, name);
  };

  return (
    <aside className="qj-sidebar">
      <header className="qj-sidebar-header">
        <span className="qj-logo">
          <svg className="qj-logo-leaf" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21 C 12 15 14 10 19 7 C 19 12 17 17 12 21 Z" fill="currentColor" />
            <path
              d="M12 21 C 12 16 10 12 5 10 C 6 15 8 18 12 21 Z"
              fill="currentColor"
              opacity="0.55"
            />
          </svg>
          轻笺
        </span>
        <span className="qj-sidebar-header-actions">
          <button
            type="button"
            className="qj-sidebar-icon-btn"
            title="主题设置"
            onClick={() => void openSettingsWindow()}
          >
            <IconGear size={16} />
          </button>
          <button
            type="button"
            className="qj-sidebar-add"
            title="新建笔记本"
            onClick={() => setAdding((v) => !v)}
          >
            <IconPlus size={14} />
          </button>
        </span>
      </header>

      {adding && (
        <div className="qj-sidebar-add-row">
          <input
            className="qj-input"
            autoFocus
            value={newName}
            placeholder="笔记本名称"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd();
              if (e.key === "Escape") {
                setAdding(false);
                setNewName("");
              }
            }}
          />
          <button type="button" className="qj-btn-primary" onClick={submitAdd}>
            确定
          </button>
        </div>
      )}

      <div className="qj-fragment-entry">
        <button
          type="button"
          className="qj-fragment-btn"
          title="打开一个新碎片窗口（可多开，内容自动并入当日记录）· 快捷键 Ctrl+F"
          onClick={() => void useFragmentStore.getState().newFragment()}
        >
          <span className="qj-fragment-btn-icon">
            <IconSprout size={14} />
          </span>
          <span className="qj-fragment-btn-label">新建碎片</span>
        </button>
        <button
          type="button"
          className={`qj-fragment-btn qj-fragment-btn-ghost${dailyBrowserOpen ? " is-active" : ""}`}
          title={dailyBrowserOpen ? "返回笔记模块" : "按日期浏览每日碎片"}
          onClick={() => useFragmentStore.getState().toggleDailyBrowser()}
        >
          <span className="qj-fragment-btn-icon">
            <IconCalendar size={14} />
          </span>
          {dailyBrowserOpen ? "返回笔记" : "每日碎片"}
        </button>
      </div>

      <nav className="qj-notebook-list" ref={notebookListRef}>
        {notebooks.map((nb) => (
          <div
            key={nb.name}
            className={`qj-notebook-item qj-ink-bar${nb.name === activeNotebook ? " is-active" : ""}`}
            onMouseDown={() => {
              // 碎片浏览视图中点笔记本 → 直接回到笔记模块，无需先"返回笔记"
              useFragmentStore.getState().closeDailyBrowser();
              void selectNotebook(nb.name);
            }}
          >
            {editingName === nb.name ? (
              <input
                className="qj-input qj-notebook-edit"
                autoFocus
                value={editValue}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => submitRename(nb.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(nb.name);
                  if (e.key === "Escape") {
                    setEditingName(null);
                    setEditValue("");
                  }
                }}
              />
            ) : (
              <>
                <span className="qj-notebook-icon">
                  <IconNotebook size={13} />
                </span>
                <span className="qj-notebook-name">{nb.name}</span>
                <span className="qj-notebook-count">{nb.noteCount}</span>
                <span className="qj-notebook-actions">
                  <button
                    type="button"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingName(nb.name);
                      setEditValue(nb.name);
                    }}
                  >
                    <IconPencil size={12} />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Tauri WebView2 不支持 window.confirm，用自定义确认
                      confirmAction(`删除笔记本「${nb.name}」及其全部笔记？`, () =>
                        void deleteNotebook(nb.name)
                      );
                    }}
                  >
                    <IconTrash size={12} />
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </nav>

      <footer className="qj-sidebar-footer" aria-hidden="true">
        {/* 低饱和植物线稿点缀。颜色跟随主题（currentColor + accent），
            写死绿色的话在克莱因蓝/深酒红主题里会留下一撮突兀的绿 */}
        <svg viewBox="0 0 120 60" className="qj-plant">
          <g stroke="currentColor" opacity="0.35" strokeWidth="1.6" fill="none" strokeLinecap="round">
            <path d="M60 56 C 58 40 62 28 78 22" />
            <path d="M60 56 C 62 42 56 32 44 28" />
            <path d="M78 22 C 70 20 66 14 66 6" />
            <path d="M78 22 C 86 20 92 12 94 4" />
            <path d="M44 28 C 38 24 36 18 38 10" />
            <path d="M44 28 C 50 30 54 34 56 42" />
          </g>
          <circle cx="92" cy="6" r="2.4" fill="var(--qj-accent)" opacity="0.7" />
        </svg>
      </footer>
    </aside>
  );
}
