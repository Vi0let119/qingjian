// tiptap-markdown 0.8.10 装配。
//
// 调研结论（见 PROGRESS.md）：序列化器对每个 schema mark 默认用 HTMLMark 兜底——
// open/close 标签由该 mark 的 renderHTML 渲染得出，options.html 默认 true。
// ⇒ Underline 自动输出 <u>…</u>，FontSize 自动输出 <span style="font-size:Npx">…</span>，
//   无需自定义 serializer（若实测不达标，再在扩展上注册 storage.markdown，见计划决策门）。
// 解析侧：markdown-it(html:true) 渲染 → DOMParser → TipTap 用各扩展 parseHTML 解析。
import { Markdown } from "tiptap-markdown";
import Image from "@tiptap/extension-image";
import type { Editor } from "@tiptap/core";

/**
 * 带正确 markdown 序列化的 Image 扩展。
 *
 * 坑：prosemirror-markdown 的 render() 对已注册 spec 的节点不自动 closeBlock，
 * 而内置 image spec 只写 `![alt](src)` 不调 closeBlock(node)，
 * 导致图片块后紧跟列表等块时粘连成一行（往返不稳定）。
 * 修复：重写 serialize，写完图片后调用 state.closeBlock(node)。
 */
export function createImageExtension() {
  return Image.extend({
    // 大文件性能：图片懒加载
    renderHTML({ HTMLAttributes }) {
      return ["img", { ...HTMLAttributes, loading: "lazy" }];
    },
    addStorage() {
      return {
        markdown: {
          serialize(state: MarkdownStateLike, node: { attrs: { alt?: string | null; src?: string | null; title?: string | null } }) {
            // 坑：TipTap Image 的 alt/src 默认值是 null（不是 undefined），
            // 解构默认值 `alt = ""` 对 null 不生效，esc(null) 会抛
            // "Cannot read properties of null (reading 'replace')" —— 必须用 ??
            const { alt, src, title } = node.attrs;
            const safeAlt = alt ?? "";
            const safeSrc = src ?? "";
            state.write(
              "![" + state.esc(safeAlt) + "](" + safeSrc.replace(/[()]/g, "\\$&") +
                (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + ")"
            );
            state.closeBlock(node);
          },
        },
      };
    },
  });
}

/** MarkdownSerializerState 的最小接口（prosemirror-markdown 提供实现） */
interface MarkdownStateLike {
  write(text: string): void;
  esc(text: string): string;
  closeBlock(node: unknown): void;
}

export function createMarkdownExtension() {
  return Markdown.configure({
    // 保持默认 html: true（行内 HTML 原样保留）；剪贴板文本不做 md 转换（我们只落盘 md）
    transformCopiedText: false,
    transformPastedText: false,
  });
}

/** 就地重写编辑器文档中所有图片节点的 src（如 rel → asset:// 或反向），触发一次事务。 */
export function rewriteImageSrcs(editor: Editor, mapSrc: (src: string) => string): void {
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && typeof node.attrs.src === "string") {
      const next = mapSrc(node.attrs.src);
      if (next !== node.attrs.src) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next });
      }
    }
  });
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
}

/**
 * 序列化当前文档为 markdown。
 * 可选对图片 src 做映射（保存时 asset:// URL → md 相对路径），
 * 映射在文档副本上进行，不影响编辑器实时状态。
 */
export function serializeMarkdown(
  editor: Editor,
  mapImageSrc?: (src: string) => string
): string {
  let doc = editor.state.doc;
  if (mapImageSrc) {
    const tr = editor.state.tr;
    doc.descendants((node, pos) => {
      if (node.type.name === "image" && typeof node.attrs.src === "string") {
        const next = mapImageSrc(node.attrs.src);
        if (next !== node.attrs.src) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next });
        }
      }
    });
    doc = tr.doc;
  }
  const serializer = (editor.storage as { markdown?: { serializer: { serialize(d: typeof doc): string } } })
    .markdown?.serializer;
  if (!serializer) {
    throw new Error("markdown 扩展未加载");
  }
  return serializer.serialize(doc);
}
