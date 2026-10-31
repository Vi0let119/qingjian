// 主窗口：三栏布局（导航栏 / 笔记列表 / 标签页编辑器）+ 错误提示条。
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./Sidebar";
import { NoteTabs } from "./NoteTabs";
import { SearchResults } from "./SearchResults";
import { DailyBrowser } from "./DailyBrowser";
import { useNoteStore } from "../../stores/useNoteStore";
import { useFragmentStore } from "../../stores/useFragmentStore";
import { useWsMode } from "../../stores/useWsMode";
import { BubbleWorkspace } from "../../components/bubble/BubbleWorkspace";
import { ModuleSurface } from "../../components/theme/ModuleSurface";
import { Onboarding } from "./Onboarding";
import { openSettingsWindow } from "./openSettings";
import { IconGear } from "../../components/common/icons";
import "./main.css";

/**
 * 分栏拖拽：起始状态 → mousemove 增量更新 → mouseup 收尾。
 * collapsible：允许拖到阈值以下直接收起（宽度变 0）；从收起状态可重新拖出。
 */
function startDrag(
  e: ReactMouseEvent,
  current: number,
  min: number,
  max: number,
  setter: (w: number) => void,
  collapsible = false
) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = current;
  const COLLAPSE_THRESHOLD = 120;
  const onMove = (ev: MouseEvent) => {
    const raw = startW + ev.clientX - startX;
    let w = Math.min(max, Math.max(startW === 0 ? 0 : min, raw));
    if (collapsible && raw < COLLAPSE_THRESHOLD) {
      w = 0; // 拖到最窄阈值以下 → 收起
    }
    setter(w);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
}

function Divider({
  left,
  onMouseDown,
  onDoubleClick,
}: {
  /** 悬浮位置：距左侧偏移（px），分隔条居中压在面板边界上 */
  left: number;
  onMouseDown: (e: ReactMouseEvent) => void;
  onDoubleClick?: () => void;
}) {
  return (
    <div
      className="qj-splitter"
      style={{ left: left - 3 }}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
}

/** 展开笔记本时侧栏的最小宽度：169px 容不下笔记标题 */
const EXPANDED_SIDEBAR_W = 240;

export function MainWindow() {
  const init = useNoteStore((s) => s.init);
  const error = useNoteStore((s) => s.error);
  const dailyBrowserOpen = useFragmentStore((s) => s.dailyBrowserOpen);
  const fragError = useFragmentStore((s) => s.error);
  const wsMode = useWsMode((s) => s.mode);
  const setWsMode = useWsMode((s) => s.setMode);
  /** 气泡视图下点开笔记 → 切到书写视图（同一窗口内切换，不是新窗口） */
  const [writing, setWriting] = useState(false);

  // 分栏宽度（用户可拖拽，localStorage 记忆）
  // 坑：localStorage 无记录时 getItem 返回 null，Number(null) === 0——
  // 若允许 0 会被误认为"收起"，导致全新用户笔记列表默认塌陷
  const [sidebarW, setSidebarW] = useState(() => {
    const raw = localStorage.getItem("qj-sidebar-w");
    if (raw === null) return 224;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : 224;
  });
  // 首次启动教程（仅显示一次）
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem("qj-onboarding-done") !== null
  );
  useEffect(() => {
    localStorage.setItem("qj-sidebar-w", String(sidebarW));
  }, [sidebarW]);

  useEffect(() => {
    void init();
  }, [init]);

  // 快捷键：Ctrl+N 新建笔记 / Ctrl+F 新建碎片（F=Fragment）/
  //         Ctrl+Shift+N 新建碎片（兼容）/ Ctrl+S 立即落盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        if (e.shiftKey) void useFragmentStore.getState().newFragment();
        else void useNoteStore.getState().createNote();
      } else if (k === "f") {
        e.preventDefault();
        void useFragmentStore.getState().newFragment();
      } else if (k === "s") {
        e.preventDefault();
        // flush 全部打开标签的挂起保存
        for (const flush of useNoteStore.getState().flushRegistry.values()) flush();
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && writing) {
        e.preventDefault();
        setWriting(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [writing]);

  // 关窗前强制落盘所有打开标签。
  // 坑：不能用 preventDefault()+destroy() 组合——Tauri 2 中该组合会卡住关闭流程
  // （close 请求被挂起、destroy 被抑制，窗口永远关不掉）。
  // 正确做法：不 preventDefault，Tauri 会等待这个异步回调完成后再正常关窗。
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    void win
      .onCloseRequested(async () => {
        for (const flush of useNoteStore.getState().flushRegistry.values()) {
          try {
            flush();
          } catch (e) {
            console.error("关窗落盘失败", e);
          }
        }
      })
      .then((un) => {
        unlisten = un;
      });
    return () => unlisten?.();
  }, []);

  const errorMsg = error ?? fragError;
  const clearError = () => {
    useNoteStore.setState({ error: null });
    useFragmentStore.setState({ error: null });
  };

  const hasExpanded = useNoteStore((s) => s.expandedNotebooks.length > 0);
  const searchQuery = useFragmentStore((s) => s.searchQuery);
  // 两栏：侧栏 + 内容区（笔记列表已并入侧栏）。
  // 有笔记本展开时侧栏加宽，否则 169px 宽不下"笔记标题"——
  // 展开出笔记后条目会翻倍，窄栏里标题只能被截成两三个字。
  const effectiveSidebarW = hasExpanded ? Math.max(sidebarW, EXPANDED_SIDEBAR_W) : sidebarW;
  const gridColumns = `${effectiveSidebarW}px 1fr`;

  // ---------- 气泡视图（主视图）----------
  // 整个窗口是一块可漫游的画布，三栏边框布局在这里不存在。
  // 点开笔记 → writing 为 true → 同一窗口内换成书写视图（不新开窗口）。
  if (wsMode === "bubble" && !dailyBrowserOpen && !writing) {
    return (
      <div className="qj-main qj-main-bubble">
        <BubbleWorkspace
          onOpenNote={() => {
            setWriting(true);
          }}
        />
        <button
          type="button"
          className="qj-view-switch"
          title="切换到列表视图"
          onClick={() => setWsMode("list")}
        >
          列表
        </button>
        {errorMsg && (
          <div className="qj-error-bar" onClick={clearError}>
            {errorMsg}（点击关闭）
          </div>
        )}
        {!onboardingDone && (
          <Onboarding
            onDone={() => {
              localStorage.setItem("qj-onboarding-done", "1");
              setOnboardingDone(true);
            }}
          />
        )}
      </div>
    );
  }

  // ---------- 书写视图（气泡点开后）：编辑器独占全窗 ----------
  // 侧栏与笔记列表都不存在，只留一条悬浮工具条：返回气泡 / 新建 / 设置。
  if (writing && !dailyBrowserOpen) {
    return (
      <div className="qj-main qj-main-writing">
        <ModuleSurface module="tabs" className="qj-writing-surface">
          <NoteTabs />
        </ModuleSurface>

        <div className="qj-writing-dock">
          <button
            type="button"
            className="qj-dock-btn"
            title="返回气泡视图 (Esc)"
            onClick={() => setWriting(false)}
          >
            ←
          </button>
          <span className="qj-dock-sep" aria-hidden="true" />
          <button
            type="button"
            className="qj-dock-btn"
            title="新建笔记 (Ctrl+N)"
            onClick={() => void useNoteStore.getState().createNote()}
          >
            ＋
          </button>
          <button
            type="button"
            className="qj-dock-btn"
            title="设置"
            onClick={() => void openSettingsWindow()}
          >
            <IconGear size={14} />
          </button>
        </div>

        {errorMsg && (
          <div className="qj-error-bar" onClick={clearError}>
            {errorMsg}（点击关闭）
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="qj-main" style={{ gridTemplateColumns: gridColumns }}>
      {!writing && (
        <button
          type="button"
          className="qj-view-switch"
          title="切换到气泡视图"
          onClick={() => setWsMode("bubble")}
        >
          气泡
        </button>
      )}
      <ModuleSurface module="sidebar" className="qj-main-sidebar qj-reveal qj-reveal-1">
        <Sidebar />
      </ModuleSurface>
      {/* 分隔条悬浮在面板边界上（不占列宽，面板无缝相接，拖动功能保留） */}
      <Divider
        left={sidebarW}
        onMouseDown={(e) => startDrag(e, sidebarW, 160, 420, setSidebarW)}
      />
      {/* 中间那栏笔记列表已取消：笔记作为子项挂在侧栏的笔记本下面 */}
      {dailyBrowserOpen ? (
        <ModuleSurface module="tabs" className="qj-main-daily qj-reveal qj-reveal-2">
          <DailyBrowser />
        </ModuleSurface>
      ) : searchQuery.trim() ? (
        <ModuleSurface module="tabs" className="qj-main-tabs qj-reveal qj-reveal-3">
          <SearchResults />
        </ModuleSurface>
      ) : (
        <ModuleSurface module="tabs" className="qj-main-tabs qj-reveal qj-reveal-3">
          <NoteTabs />
        </ModuleSurface>
      )}
      {errorMsg && (
        <div className="qj-error-bar" onClick={clearError}>
          {errorMsg}（点击关闭）
        </div>
      )}
      {!onboardingDone && (
        <Onboarding
          onDone={() => {
            localStorage.setItem("qj-onboarding-done", "1");
            setOnboardingDone(true);
          }}
        />
      )}
    </div>
  );
}
