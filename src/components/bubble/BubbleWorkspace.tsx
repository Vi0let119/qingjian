// 气泡工作区：笔记本层 → 笔记层 → 书写层，三层之间的切换与展开动画。
// 书写层不是气泡：点开笔记后气泡放大成纸面（FLIP），保证光标/输入法可靠。
import { useCallback, useEffect, useRef, useState } from "react";
import { BubbleCanvas, type BubbleItem } from "./BubbleCanvas";
import { useNoteStore } from "../../stores/useNoteStore";
import { IconChevronLeft, IconPlus } from "../common/icons";
import "./bubble.css";
import "./workspace.css";

/** 由内容量推导气泡直径，限制在可读范围内。
 * 基准调小（96 起），因为环形排布时 5 个以上大气泡会互相挤压。 */
export function bubbleSizeFor(weight: number): number {
  const base = 92;
  const k = 14;
  return Math.round(Math.min(168, Math.max(84, base + Math.sqrt(Math.max(0, weight)) * k)));
}

/** 相对时间：气泡副标题用 */
export function relativeTime(secs: number): string {
  if (!secs) return "";
  const now = Date.now() / 1000;
  const d = now - secs;
  if (d < 90) return "刚刚";
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  const dt = new Date(secs * 1000);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

export type BubbleLayer = { kind: "notebooks" } | { kind: "notes"; notebook: string };

interface BubbleWorkspaceProps {
  /** 从气泡层进入书写层时的回调（由外层切换到编辑器） */
  onOpenNote: (notebook: string, fileName: string) => void;
  /** 外部（如搜索/列表）要求直接聚焦某篇笔记 */
  focusNotebook?: string | null;
}

export function BubbleWorkspace({ onOpenNote, focusNotebook }: BubbleWorkspaceProps) {
  const notebooks = useNoteStore((s) => s.notebooks);
  const notes = useNoteStore((s) => s.notes);
  const activeNotebook = useNoteStore((s) => s.activeNotebook);
  const selectNotebook = useNoteStore((s) => s.selectNotebook);
  const createNote = useNoteStore((s) => s.createNote);

  const [layer, setLayer] = useState<BubbleLayer>({ kind: "notebooks" });
  /** 展开动画：被点气泡在视口中的矩形 */
  const [opening, setOpening] = useState<{ rect: DOMRect; title: string } | null>(null);
  const pendingRef = useRef<{ notebook: string; fileName: string } | null>(null);

  // 外部要求聚焦某个笔记本（例如搜索命中）
  useEffect(() => {
    if (focusNotebook) setLayer({ kind: "notes", notebook: focusNotebook });
  }, [focusNotebook]);

  const notebookItems: BubbleItem[] = notebooks.map((nb, i) => ({
    id: nb.name,
    title: nb.name,
    // 气泡上只呈现笔记本名称：数量交给进入后的笔记层与面包屑，
    // 气泡本身越干净，空间感越强（空笔记本用虚线轮廓区分，不再靠文字标注）
    size: bubbleSizeFor(nb.noteCount),
    ghost: nb.noteCount === 0,
    index: i,
  }));

  const noteItems: BubbleItem[] = notes.map((n, i) => ({
    id: n.fileName,
    title: n.title,
    size: bubbleSizeFor(0),
    meta: relativeTime(n.updatedAt),
    index: i,
  }));

  // 布局会把第一个气泡放在正中心：中心应该留给内容最多的那颗，
  // 空笔记本排在最后（它们用虚线轮廓，本来就更轻）。
  const orderedNotebooks = [...notebookItems].sort((a, b) => {
    if (a.ghost !== b.ghost) return a.ghost ? 1 : -1;
    return b.size - a.size;
  });

  const back = useCallback(() => {
    setLayer({ kind: "notebooks" });
  }, []);

  // Esc 返回上层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && layer.kind === "notes") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layer, back]);

  const handleOpen = useCallback(
    async (item: BubbleItem, origin: { x: number; y: number }) => {
      if (layer.kind === "notebooks") {
        // 进入第二层：切换前先把被点气泡的位置记下来，用于新层的展开起点
        await selectNotebook(item.id);
        setLayer({ kind: "notes", notebook: item.id });
        return;
      }
      // 第二层：空气泡 = 新建；否则打开笔记
      if (item.ghost) {
        await createNote();
        const state = useNoteStore.getState();
        const tab = state.openTabs.find((t) => t.id === state.activeTabId);
        if (tab) {
          setOpening({
            rect: new DOMRect(origin.x - 60, origin.y - 60, 120, 120),
            title: tab.title,
          });
          pendingRef.current = { notebook: tab.notebook, fileName: tab.fileName };
        }
        return;
      }
      const nb = layer.kind === "notes" ? layer.notebook : "";
      const target = useNoteStore.getState().notes.find((n) => n.fileName === item.id);
      useNoteStore.getState().openNote(nb, item.id);
      setOpening({
        rect: new DOMRect(origin.x - 60, origin.y - 60, 120, 120),
        title: target?.title ?? item.title,
      });
      pendingRef.current = { notebook: nb, fileName: item.id };
    },
    [layer, selectNotebook, createNote]
  );

  // 展开动画播完再切到编辑器：气泡长成纸面后，书写界面才出现（避免闪跳）
  useEffect(() => {
    if (!opening) return;
    const t = window.setTimeout(() => {
      const p = pendingRef.current;
      setOpening(null);
      pendingRef.current = null;
      if (p) onOpenNote(p.notebook, p.fileName);
    }, 420);
    return () => window.clearTimeout(t);
  }, [opening, onOpenNote]);

  const notebookName =
    layer.kind === "notes" ? layer.notebook : (activeNotebook ?? "");

  return (
    <div className="qj-bubble-workspace">
      {/* 面包屑：层级唯一的导航锚点 */}
      <header className="qj-bubble-crumbs">
        <button
          type="button"
          className="qj-crumb"
          onClick={() => {
            if (layer.kind === "notes") back();
          }}
          disabled={layer.kind === "notebooks"}
          title={layer.kind === "notes" ? "返回全部笔记本 (Esc)" : undefined}
        >
          {layer.kind === "notes" && <IconChevronLeft size={13} />}
          全部笔记本
        </button>
        {layer.kind === "notes" && (
          <>
            <span className="qj-crumb-sep" aria-hidden="true">
              /
            </span>
            <span className="qj-crumb is-current">{notebookName}</span>
          </>
        )}
        <span className="qj-crumbs-spacer" />
        <button
          type="button"
          className="qj-crumb-action"
          onClick={() => {
            if (layer.kind === "notes") void createNote();
            else void createNotebookWindow();
          }}
          title={layer.kind === "notes" ? "在本笔记本新建笔记" : "新建笔记本"}
        >
          <IconPlus size={13} />
          {layer.kind === "notes" ? "新建笔记" : "新建笔记本"}
        </button>
      </header>

      <BubbleCanvas
        layerKey={layer.kind === "notebooks" ? "nb" : `notes:${layer.notebook}`}
        items={layer.kind === "notebooks" ? orderedNotebooks : noteItems}
        onOpen={handleOpen}
        emptyHint={
          layer.kind === "notebooks" ? (
            <>还没有笔记本，点右上角「新建笔记本」开始</>
          ) : (
            <>这个笔记本还没有笔记，点右上角「新建笔记」写下第一段</>
          )
        }
      />

      {/* 展开层：气泡被"吹大"成纸面的过渡 */}
      {opening && (
        <div
          className="qj-bubble-expand"
          style={{
            left: opening.rect.left,
            top: opening.rect.top,
            width: opening.rect.width,
            height: opening.rect.height,
          }}
        >
          <span>{opening.title}</span>
        </div>
      )}
    </div>
  );
}

/** 新建笔记本：复用侧栏的输入流程（简单 prompt 式） */
async function createNotebookWindow() {
  const name = window.prompt("新笔记本名称");
  if (name && name.trim()) {
    await useNoteStore.getState().createNotebook(name.trim());
  }
}
