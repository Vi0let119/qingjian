// 左侧导航栏：应用头 + 笔记本树 + 底部植物点缀（M4 加入每日碎片入口）。
import { useRef, useState } from "react";
import { useNoteStore } from "../../stores/useNoteStore";
import { useFragmentStore } from "../../stores/useFragmentStore";
import { confirmAction } from "../../lib/confirm";
import { openSettingsWindow } from "./openSettings";
import {
  IconCalendar,
  IconChevronRight,
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
  const searchQuery = useFragmentStore((s) => s.searchQuery);
  const setSearchQuery = useFragmentStore((s) => s.setSearchQuery);
  // WebView2 滚轮接管
  const notebookListRef = useRef<HTMLElement>(null);
  useWheelScroll(notebookListRef);
  const notebooks = useNoteStore((s) => s.notebooks);
  const activeNotebook = useNoteStore((s) => s.activeNotebook);
  const selectNotebook = useNoteStore((s) => s.selectNotebook);
  // 侧栏树：展开状态 + 各本笔记缓存 + 当前打开的标签
  const expandedNotebooks = useNoteStore((s) => s.expandedNotebooks);
  const notesByNotebook = useNoteStore((s) => s.notesByNotebook);
  const toggleNotebookExpanded = useNoteStore((s) => s.toggleNotebookExpanded);
  const openNote = useNoteStore((s) => s.openNote);
  const createNote = useNoteStore((s) => s.createNote);
  const activeTabId = useNoteStore((s) => s.activeTabId);
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
            title={`在当前笔记本「${activeNotebook ?? "inbox"}」新建笔记（Ctrl+N）`}
            onClick={() => void createNote()}
          >
            <IconPlus size={14} />
          </button>
        </span>
      </header>

      {/* 搜索：全局范围（中间栏移除后不再有"当前笔记本"的概念）。
          结果占用内容区，清空后回到原来那篇笔记。 */}
      <div className="qj-sidebar-search">
        <span className="qj-sidebar-search-icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
        </span>
        <input
          className="qj-sidebar-search-input"
          placeholder="搜索全部笔记"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="qj-sidebar-search-clear"
            title="清空搜索"
            onClick={() => setSearchQuery("")}
          >
            ×
          </button>
        )}
      </div>

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

      {/* 笔记本区标题：新建笔记本的入口放在这里，
          和顶部"新建笔记"分开，避免两个加号分不清 */}
      <div className="qj-nb-section-head">
        <span>笔记本</span>
        <button
          type="button"
          className="qj-nb-section-add"
          title="新建笔记本"
          onClick={() => setAdding((v) => !v)}
        >
          <IconPlus size={12} />
        </button>
      </div>

      <nav className="qj-notebook-list" ref={notebookListRef}>
        {notebooks.map((nb) => {
          const expanded = expandedNotebooks.includes(nb.name);
          const children = notesByNotebook[nb.name] ?? [];
          return (
          <div key={nb.name} className="qj-nb-group">
          <div
            className={`qj-notebook-item qj-ink-bar${nb.name === activeNotebook ? " is-active" : ""}${expanded ? " is-expanded" : ""}`}
            onMouseDown={() => {
              // 碎片浏览视图中点笔记本 → 直接回到笔记模块，无需先"返回笔记"
              useFragmentStore.getState().closeDailyBrowser();
              // 选中即展开（同一个动作，避免两个函数各拉一次笔记列表）
              if (nb.name !== activeNotebook) {
                void selectNotebook(nb.name);
                if (!expanded) void toggleNotebookExpanded(nb.name);
              } else {
                void toggleNotebookExpanded(nb.name);
              }
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
                {/* 展开箭头：不显示的话用户不知道笔记本可以点开 */}
                <span className="qj-nb-caret" aria-hidden="true">
                  <IconChevronRight size={11} />
                </span>
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
          {/* 展开后的笔记子项：点开笔记本就地显示它的笔记，
              不再需要中间那栏笔记列表 */}
          {expanded && (
            <ul className="qj-nb-children">
              {/* 空笔记本不用单独提示"还没有笔记"——下面那行"新建笔记"已经说明了一切 */}

              {children.map((n) => (
                <li key={n.fileName}>
                  <button
                    type="button"
                    className={`qj-nb-note${activeTabId === `${nb.name}/${n.fileName}` ? " is-active" : ""}`}
                    title={n.title}
                    onMouseDown={() => {
                      useFragmentStore.getState().closeDailyBrowser();
                      openNote(nb.name, n.fileName);
                    }}
                  >
                    <span className="qj-nb-note-title">{n.title}</span>
                  </button>
                </li>
              ))}
              {/* 就地新建：展开哪个本就在哪个本里建，
                  不用先回到顶部按钮，也不用先切选中 */}
              <li>
                <button
                  type="button"
                  className="qj-nb-note qj-nb-note-add"
                  title={`在「${nb.name}」新建笔记`}
                  onMouseDown={() => {
                    void useNoteStore.getState().createNoteIn(nb.name);
                  }}
                >
                  <IconPlus size={11} />
                  <span>新建笔记</span>
                </button>
              </li>
            </ul>
          )}
          </div>
          );
        })}
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
