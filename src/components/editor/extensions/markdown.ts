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

/**
 * 空段落的占位标记。
 *
 * Markdown 语法本身表达不了"连续多个空行"——`段落一\n\n\n\n段落二` 解析回来
 * 只有一个空行，多个回车就这样被吃掉了。
 * 这里把用户敲出来的空段落写成一个只含占位符的段落，解析时再还原成真正的空段落。
 * 用零宽字符包住一个标记，肉眼不可见，也不会被 Markdown 渲染器吃掉。
 */
const BLANK_MARK = "\u200b\u2063qjblank\u2063\u200b";

/** 读入时还原：占位段落 → 真正的空段落。
 *
 *  时序很重要：Markdown 扩展先把 md 解析成 HTML，ProseMirror 再把 HTML 解析成文档。
 *  如果在 md 文本里删掉占位符，那个段落就成了 `<p></p>`，
 *  ProseMirror 解析空 `<p>` 时会跳过它——空行照样丢。
 *  所以要在 md 层面把它换成**带 br 的段落**：`<p><br></p>` 会被解析成一个空段落节点，
 *  再配合 editor.css 里对空段落的高度处理，视觉上就是一行空行。 */
export function restoreBlankParagraphs(content: string): string {
  if (!content.includes(BLANK_MARK)) return content;
  return content.split(BLANK_MARK).join("<br>");
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
  // 空段落要写成占位段落再序列化。
  // 原因：markdown-it 在**解析**阶段就把连续空行吃掉了（`段落一\n\n\n\n段落二`
  // 解析出来只有两个段落、中间没有任何空段落），所以只改序列化没用。
  // 落盘时把空段落写成一个只含占位符的段落，读回来时再还原成空段落，
  // 多个回车就能完整往返（用户报的"回车被吃掉"）。
  // 空行有两种形态：真正空的段落，以及"只含 hardBreak"的段落
  // （后者是读回占位符的产物）。两种都要写回占位符，
  // 否则每保存一次空行就会漂移一次（多一个或少一个）。
  const blankRanges: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return true;
    if (node.content.size === 0) {
      blankRanges.push({ from: pos + 1, to: pos + 1 });
      return true;
    }
    const onlyBreaks = node.content.content.every((child) => child.type.name === "hardBreak");
    if (onlyBreaks) {
      blankRanges.push({ from: pos + 1, to: pos + 1 + node.content.size });
    }
    return true;
  });
  // 整篇都是空段落（新建的空笔记）→ 直接返回空，不写占位符。
  // 否则空笔记会存成一个只有 qjblank 的文件。
  const hasText = doc.textContent.trim().length > 0;
  if (blankRanges.length && hasText) {
    const tr = editor.state.tr;
    // 从后往前替换，避免位置偏移
    for (const r of [...blankRanges].reverse()) {
      tr.replaceWith(r.from, r.to, editor.schema.text(BLANK_MARK));
    }
    doc = tr.doc;
  }

  const serializer = (editor.storage as { markdown?: { serializer: { serialize(d: typeof doc): string } } })
    .markdown?.serializer;
  if (!serializer) {
    throw new Error("markdown 扩展未加载");
  }
  return serializer.serialize(doc);
}
