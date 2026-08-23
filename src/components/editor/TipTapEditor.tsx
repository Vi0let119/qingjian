// 通用富文本编辑器（主窗口笔记 / 碎片窗口复用）。
// - 自动保存：onUpdate → dirty → debounce → onSave(markdown)
// - 挂载时用 initialContent 初始化；内容生命周期由外层（标签页）管理
// - compact 模式：精简工具栏（碎片窗口）
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import { FontSize } from "./extensions/fontSize";
import {
  createImageExtension,
  createMarkdownExtension,
  rewriteImageSrcs,
  serializeMarkdown,
} from "./extensions/markdown";
import { MenuBar } from "./MenuBar";
import { debounce } from "../../lib/debounce";
import "./editor.css";

export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";

export interface TipTapEditorProps {
  /** markdown 初始内容 */
  initialContent: string;
  /** 保存回调：收到序列化后的 markdown 文本 */
  onSave: (md: string) => Promise<void>;
  /** 自动保存防抖延迟（默认 500ms） */
  autosaveDelayMs?: number;
  /** 碎片窗口精简模式 */
  compact?: boolean;
  placeholder?: string;
  /** 保存状态变化（供外部显示"已保存 14:23"等） */
  onSaveStatus?: (status: SaveStatus) => void;
  /**
   * 插入图片：file 为剪贴板粘贴的图片（工具栏点击则为 undefined）。
   * 返回图片 src（asset:// 或数据 URL）。M3 由附件导入实现。
   */
  onInsertImage?: (file?: File) => Promise<string | null>;
  /** 载入时图片 src 映射：md 相对路径 → data URI（可异步） */
  resolveImageSrc?: (relSrc: string) => string | Promise<string>;
  /** 保存时图片 src 映射：asset:// URL → md 相对路径 */
  persistImageSrc?: (assetSrc: string) => string;
  /** 只读模式（历史浏览）：无工具栏、不可编辑 */
  readonly?: boolean;
  /** 粘贴图片失败时回调（浮到错误条，不只进 console） */
  onPasteError?: (msg: string) => void;
  /** 检索跳转：打开后在编辑器文档纯文本中查找 query 并选中定位 */
  reveal?: { query: string } | null;
  /** 定位完成（含未找到）后回调——由外层清除跳转请求，避免卡住后续跳转 */
  onRevealApplied?: () => void;
  /** 刷新父组件的 flush 注册（供切标签/关窗前落盘） */
  registerFlush?: (flush: () => void) => void;
}

export function TipTapEditor({
  initialContent,
  onSave,
  autosaveDelayMs = 500,
  compact = false,
  placeholder = "开始书写…",
  onSaveStatus,
  onInsertImage,
  resolveImageSrc,
  persistImageSrc,
  readonly = false,
  onPasteError,
  reveal,
  onRevealApplied,
  registerFlush,
}: TipTapEditorProps) {
  const [status, setStatus] = useState<SaveStatus>("clean");
  const editorRef = useRef<Editor | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 载入阶段重写图片 src 时抑制 dirty/自动保存 */
  const suppressUpdate = useRef(false);

  // 以下 ref 转发避免 useEditor 闭包捕获旧值
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onStatusRef = useRef(onSaveStatus);
  onStatusRef.current = onSaveStatus;
  const onInsertImageRef = useRef(onInsertImage);
  onInsertImageRef.current = onInsertImage;
  const onPasteErrorRef = useRef(onPasteError);
  onPasteErrorRef.current = onPasteError;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;
  const persistImageSrcRef = useRef(persistImageSrc);
  persistImageSrcRef.current = persistImageSrc;

  const setStatusBoth = useCallback((s: SaveStatus) => {
    setStatus(s);
    onStatusRef.current?.(s);
  }, []);

  const doSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      // 注意：serializeMarkdown 必须在 try 内——此前在 try 外，
      // 序列化抛异常会导致保存静默死亡（无错误条、无日志）
      const map = persistImageSrcRef.current;
      const md = serializeMarkdown(editor, map ? (src) => map(src) : undefined);
      setStatusBoth("saving");
      await onSaveRef.current(md);
      setStatusBoth("saved");
    } catch (e) {
      console.error("保存失败", e);
      setStatusBoth("error");
      onPasteErrorRef.current?.(`保存失败: ${String(e)}`);
    }
  }, [setStatusBoth]);

  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  const debouncedRef = useRef(
    debounce(() => {
      void doSaveRef.current();
    }, autosaveDelayMs)
  );

  const flush = useCallback(() => {
    debouncedRef.current.flush();
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    registerFlush?.(flush);
  }, [registerFlush, flush]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontSize,
      createImageExtension(),
      createMarkdownExtension(),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: `qj-editor-content${compact ? " qj-editor-compact" : ""}`,
      },
      editable: () => !readonly,
      // 粘贴图片 → 导入附件 → 插入 image 节点
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (!file) continue;
            const handler = onInsertImageRef.current;
            if (!handler) return true; // 未接图片导入（如碎片窗口）→ 吞掉粘贴，不抛异常
            void handler(file)
              .then((src) => {
                if (src) {
                  try {
                    const node = view.state.schema.nodes.image.create({ src });
                    view.dispatch(view.state.tr.replaceSelectionWith(node));
                  } catch (e) {
                    console.error("图片节点插入失败", e);
                    onPasteErrorRef.current?.(`图片插入失败: ${String(e)}`);
                  }
                }
              })
              .catch((e) => {
                console.error("图片导入失败", e);
                onPasteErrorRef.current?.(`图片导入失败: ${String(e)}`);
              });
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: () => {
      if (suppressUpdate.current) return;
      setStatusBoth("dirty");
      debouncedRef.current();
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // 检索跳转定位：在编辑器文档纯文本中查找 query（与 Rust 清洗后的检索文本一致），
  // 找到后选中并滚动到可见。完成后回调外层清除请求（含未找到的情况，
  // 否则请求残留会在编辑器后续任意一次 re-render 时错误跳转）。
  useEffect(() => {
    if (!editor || !reveal || !reveal.query) return;
    const doc = editor.state.doc;
    const q = reveal.query.toLowerCase();
    // 遍历文本节点累计纯文本，定位首个命中
    let accText = "";
    const posMap: { start: number; text: string }[] = [];
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        posMap.push({ start: pos, text: node.text });
        accText += node.text;
      }
      return true;
    });
    const idx = accText.toLowerCase().indexOf(q);
    if (idx >= 0) {
      // 字符偏移 → 文本节点内位置
      let remain = idx;
      let pmPos = 0;
      for (const m of posMap) {
        const len = m.text.length;
        if (remain < len) {
          pmPos = m.start + remain;
          break;
        }
        remain -= len;
      }
      if (pmPos > 0) {
        suppressUpdate.current = true; // 纯选择变化不触发保存
        try {
          editor
            .chain()
            .setTextSelection({ from: pmPos, to: pmPos + reveal.query.length })
            .run();
          editor.commands.scrollIntoView();
        } finally {
          suppressUpdate.current = false;
        }
      }
    }
    // 延迟清除：React StrictMode 双重挂载下，第一个（将被销毁的）编辑器实例
    // 也会执行定位并清除请求，导致真正显示的第二个实例拿不到 reveal。
    // 延迟 400ms 清除，两个实例都能应用定位，最终存活者可见。
    const t = setTimeout(() => onRevealApplied?.(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, reveal]);

  // 滚轮滚动：WebView2 下原生滚动链不可靠（方向键可滚、滚轮不动），
  // 用原生非 passive 监听器接管滚轮；React 的 onWheel 是 passive 的，preventDefault 无效。
  // 依赖 editor：div 在编辑器创建后才渲染，否则 ref 为 null 监听器永远不挂上。
  // deltaMode 归一化：部分环境以行模式（deltaMode=1，每格仅 ~3 单位）发送事件，
  // 直接加 deltaY 会导致几乎不滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !editor) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dy = e.deltaY * unit;
      const canDown = dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const canUp = dy < 0 && el.scrollTop > 0;
      if (canDown || canUp) {
        el.scrollTop += dy;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // 中键按住拖动滚动（autoscroll，Chromium/WebView2 不支持原生实现）
    let autoScroll = false;
    let autoStartY = 0;
    let autoStartTop = 0;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      autoScroll = true;
      autoStartY = e.clientY;
      autoStartTop = el.scrollTop;
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!autoScroll) return;
      const dy = (autoStartY - e.clientY) * 1.2;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(max, Math.max(0, autoStartTop + dy));
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1) autoScroll = false;
    };
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [editor]);

  // 载入后把图片 src 从 md 相对路径换成 data URI（重写事务不触发 dirty）。
  // 映射可为异步（相对路径 → Rust 读字节 → data URI），全部完成后一次性重写。
  useEffect(() => {
    const map = resolveImageSrcRef.current;
    if (!editor || !map) return;
    suppressUpdate.current = true;
    let disposed = false;
    const release = () => {
      if (!disposed) suppressUpdate.current = false;
    };

    const srcs: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image" && typeof node.attrs.src === "string") {
        srcs.push(node.attrs.src);
      }
    });
    if (srcs.length === 0) {
      release();
      return;
    }

    void Promise.all(srcs.map(async (src) => [src, await map(src)] as const))
      .then((pairs) => {
        if (disposed) return;
        const lookup = new Map(pairs);
        rewriteImageSrcs(editor, (src) => lookup.get(src) ?? src);
        release();
      })
      .catch((e) => {
        console.error("图片 src 映射失败", e);
        onPasteErrorRef.current?.(`图片加载失败: ${String(e)}`);
        release();
      });
    return () => {
      disposed = true;
      suppressUpdate.current = false;
    };
  }, [editor]);

  // 卸载时 flush（关标签/关窗口最后的保障）
  useEffect(() => {
    return () => {
      debouncedRef.current.flush();
    };
  }, []);

  const insertImage = useCallback(async () => {
    const src = await onInsertImageRef.current?.();
    if (src && editorRef.current) {
      editorRef.current.chain().focus().setImage({ src }).run();
    }
  }, []);

  if (!editor) return null;

  return (
    <div className="qj-editor">
      {!readonly && (
        <MenuBar editor={editor} compact={compact} onInsertImage={onInsertImage ? insertImage : undefined} />
      )}
      <div className="qj-editor-scroll" ref={scrollRef}>
        <EditorContent editor={editor} />
      </div>
      <div className={`qj-save-indicator qj-save-${status}`} title="保存状态">
        {status === "saved" ? "已保存" : status === "saving" ? "保存中…" : status === "error" ? "保存失败" : ""}
      </div>
    </div>
  );
}
