// 编辑器工具栏：加粗/斜体/下划线 + 字号下拉 + 插图（compact 模式隐藏字号下拉）。
import { useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { FONT_SIZE_LEVELS, type FontSizeLevel } from "./extensions/fontSize";
import { IconImage } from "../common/icons";

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

  // 当前选区字号：取 textStyle mark 的 fontSize 属性
  const currentSize = ((): FontSizeLevel | "" => {
    const { from } = editor.state.selection;
    const marks = editor.state.doc.nodeAt(from)?.marks ?? [];
    for (const mark of marks) {
      if (mark.type.name === "textStyle" && typeof mark.attrs.fontSize === "string") {
        return mark.attrs.fontSize as FontSizeLevel;
      }
    }
    return "";
  })();

  return (
    <div className={`qj-menubar${compact ? " qj-menubar-compact" : ""}`}>
      <button
        type="button"
        className={`qj-menubar-btn qj-menubar-b${isActive("bold") ? " is-active" : ""}`}
        title="加粗 (Ctrl+B)"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
      >
        B
      </button>
      <button
        type="button"
        className={`qj-menubar-btn qj-menubar-i${isActive("italic") ? " is-active" : ""}`}
        title="斜体 (Ctrl+I)"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
      >
        I
      </button>
      <button
        type="button"
        className={`qj-menubar-btn qj-menubar-u${isActive("underline") ? " is-active" : ""}`}
        title="下划线 (Ctrl+U)"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleUnderline().run();
        }}
      >
        U
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
          className="qj-menubar-btn qj-menubar-img"
          title="插入图片"
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
