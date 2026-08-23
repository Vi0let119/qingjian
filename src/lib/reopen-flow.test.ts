// @vitest-environment happy-dom
// 回归：重开笔记的完整图片管线（相对路径 → data URI 显示 → 保存映射回相对路径）。
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock IPC：readFileAsDataUri 返回可辨认的 data URI
// （真实 base64 在 Rust 端生成；btoa 不支持中文，这里用 Unicode 安全编码）
vi.mock("./api", () => ({
  api: {
    readFileAsDataUri: async (p: string) =>
      `data:image/png;base64,${btoa(unescape(encodeURIComponent(p)))}`,
  },
}));

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createImageExtension, createMarkdownExtension, rewriteImageSrcs, serializeMarkdown } from "../components/editor/extensions/markdown";
import { relToAbs } from "./paths";
import { absToDataUri, registerDataUri, relForDataUri } from "./dataUri";

const NOTE_ABS =
  "C:\\Users\\user\\AppData\\Roaming\\轻笺\\notes\\3232\\无标题笔记 2026-08-16 18-26.md";

const NOTE_MD = `大大撒旦

test

![](../../attachments/2026-08/20260816-192040-a59441.png)`;

beforeEach(() => {
  // 清缓存
  vi.resetModules();
});

describe("重开笔记图片管线", () => {
  it("相对路径 → data URI → 再映射回相对路径", async () => {
    const editor = new Editor({
      extensions: [StarterKit, createImageExtension(), createMarkdownExtension()],
      content: NOTE_MD,
    });
    try {
      // 加载阶段：收集 rel src → 绝对路径 → data URI
      const rels: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image" && typeof node.attrs.src === "string") {
          rels.push(node.attrs.src);
        }
      });
      expect(rels.length).toBe(1);
      const rel = rels[0];

      const abs = relToAbs(NOTE_ABS, rel);
      expect(abs).toContain("轻笺\\attachments\\2026-08\\20260816-192040-a59441.png");

      const uri = await absToDataUri(abs);
      expect(uri).toContain("data:image/png;base64,");
      registerDataUri(uri, rel);

      // 重写编辑器内的 src
      rewriteImageSrcs(editor, (src) => (src === rel ? uri : src));
      let domSrc = "";
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image") domSrc = node.attrs.src;
      });
      expect(domSrc).toBe(uri);

      // 保存阶段：data URI 映射回相对路径
      const md = serializeMarkdown(editor, (src) =>
        src.startsWith("data:") ? (relForDataUri(src) ?? src) : src
      );
      expect(md).toContain(`![](../../attachments/2026-08/20260816-192040-a59441.png)`);
      expect(md).not.toContain("data:image");
    } finally {
      editor.destroy();
    }
  });
});
