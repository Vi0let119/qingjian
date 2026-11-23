// 编辑器工具栏：加粗/斜体/下划线 + 字号下拉 + 插图（compact 模式隐藏字号下拉）。
import { useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { FONT_SIZE_LEVELS, type FontSizeLevel } from "./extensions/fontSize";
import { IconBold, IconImage, IconItalic, IconUnderline } from "../common/icons";

export interface MenuBarProps {
  editor: Editor;
  compact?: boolean;
  onInsertImage?: () => void;
}

export function MenuBar({ editor, compact = false, onInsertImage }: MenuBarProps) {
  // 用 render 期间重渲染跟踪选区变化（TipTap 在编辑器更新时重渲染组件）
  const isActive = useCallback(
    (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs),
    [editor]
  );

  /**
   * 当前字号：要同时考虑三种情况，否则下拉框会一直显示「字号」——
   * 用户以为设置没生效，其实已经生效了（踩过的坑）。
   *
   *  1. 有选区 / 光标在字中间 → 读 `nodeAt(from)` 的 textStyle mark
   *  2. 光标停在文本**末尾** → `nodeAt(from)` 是下一个节点或 null，要去读
   *     `$from.marks()`（ProseMirror 会给当前位置的左邻 mark）
   *  3. 空选区且刚设过字号 → 读 `state.storedMarks`，这样"选字号 → 后续输入
   *     用它"的反馈能立刻回显
   */
  const currentSize = ((): FontSizeLevel | "" => {
    const { state } = editor;
    const pick = (marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[]) => {
      for (const mark of marks) {
        if (mark.type.name === "textStyle" && typeof mark.attrs.fontSize === "string") {
          return mark.attrs.fontSize as FontSizeLevel;
        }
      }
      return null;
    };

    // 3) 空选区：优先用 storedMarks（用户刚设了"后续输入字号"）
    if (state.selection.empty && state.storedMarks) {
      const fromStored = pick(state.storedMarks);
      if (fromStored) return fromStored;
    }
    // 1)/2) 常规：$from.marks() 已涵盖"光标在字中间"和"停在末尾"两种位置
    const fromCursor = pick(state.selection.$from.marks());
    if (fromCursor) return fromCursor;
    // 兜底：选区起点节点的 mark（有选区时的常见形态）
    const { from } = state.selection;
    return pick(state.doc.nodeAt(from)?.marks ?? []) ?? "";
  })();

  return (
    <div className={`qj-menubar${compact ? " qj-menubar-compact" : ""}`}>
      <button
        type="button"
        className={`qj-menubar-btn${isActive("bold") ? " is-active" : ""}`}
        title="加粗 (Ctrl+B)"
        aria-label="加粗"
        aria-pressed={isActive("bold")}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
      >
        <IconBold />
      </button>
      <button
        type="button"
        className={`qj-menubar-btn${isActive("italic") ? " is-active" : ""}`}
        title="斜体 (Ctrl+I)"
        aria-label="斜体"
        aria-pressed={isActive("italic")}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
      >
        <IconItalic />
      </button>
      <button
        type="button"
        className={`qj-menubar-btn${isActive("underline") ? " is-active" : ""}`}
        title="下划线 (Ctrl+U)"
        aria-label="下划线"
        aria-pressed={isActive("underline")}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleUnderline().run();
        }}
      >
        <IconUnderline />
      </button>

      {!compact && (
        <select
          className="qj-menubar-size"
          title="字号"
          value={currentSize}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") {
              editor.chain().focus().unsetFontSize().run();
            } else {
              editor.chain().focus().setFontSize(v as FontSizeLevel).run();
            }
          }}
        >
          <option value="">字号</option>
          {FONT_SIZE_LEVELS.map((s) => (
            <option key={s} value={s}>
              {parseInt(s, 10)}
            </option>
          ))}
        </select>
      )}

      {onInsertImage && (
        <button
          type="button"
          className="qj-menubar-btn"
          title="插入图片"
          aria-label="插入图片"
          onMouseDown={(e) => {
            e.preventDefault();
            onInsertImage();
          }}
        >
          <IconImage size={14} />
        </button>
      )}
    </div>
  );
}
