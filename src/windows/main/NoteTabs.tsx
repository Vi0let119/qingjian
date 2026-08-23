// 标签页条 + 编辑器区域。所有打开的标签编辑器保持挂载（隐藏非激活者）。
import { useNoteStore } from "../../stores/useNoteStore";
import { ModuleSurface } from "../../components/theme/ModuleSurface";
import { NoteEditorPane } from "./NoteEditorPane";

export function NoteTabs() {
  const openTabs = useNoteStore((s) => s.openTabs);
  const activeTabId = useNoteStore((s) => s.activeTabId);
  const activateTab = useNoteStore((s) => s.activateTab);
  const closeTab = useNoteStore((s) => s.closeTab);

  return (
    <div className="qj-tabs-root">
      <div className="qj-tabs-strip">
        {openTabs.map((tab) => (
          <div
            key={tab.id}
            className={`qj-tab${tab.id === activeTabId ? " is-active" : ""}`}
            title={`${tab.notebook} / ${tab.title}`}
            onMouseDown={() => activateTab(tab.id)}
          >
            <span className="qj-tab-title">{tab.title}</span>
            <button
              type="button"
              className="qj-tab-close"
              title="关闭标签"
              onMouseDown={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <ModuleSurface module="editor" className="qj-tabs-body">
        {openTabs.length === 0 && (
          <div className="qj-empty">
            <svg className="qj-empty-leaf qj-leaf-float" viewBox="0 0 48 48" aria-hidden="true">
              <path
                d="M24 44 C 24 34 27 26 35 20 C 35 29 32 37 24 44 Z"
                fill="rgba(74,124,89,0.5)"
              />
              <path
                d="M24 44 C 24 36 21 30 14 26 C 15 34 19 40 24 44 Z"
                fill="rgba(107,154,116,0.42)"
              />
              <path
                d="M24 44 C 23 38 24 30 26 22"
                stroke="rgba(74,124,89,0.38)"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <p className="qj-empty-title">轻笺</p>
            <p className="qj-empty-hint">选择左侧笔记开始书写，或新建一篇笔记。</p>
          </div>
        )}
        {openTabs.map((tab) => (
          <div
            key={tab.id}
            className="qj-tab-pane"
            style={{ display: tab.id === activeTabId ? "flex" : "none" }}
          >
            <NoteEditorPane tab={tab} />
          </div>
        ))}
      </ModuleSurface>
    </div>
  );
}
