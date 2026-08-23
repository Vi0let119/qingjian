// @vitest-environment happy-dom
// M2 决策门：tiptap-markdown 0.8.10 对 字号/下划线/图片/嵌套 的往返语义测试。
// 验收标准（plan.md §六.1）：
//  1. parse → serialize 语义稳定（幂等：二次往返输出一致）
//  2. 关键标记保留：<u>、font-size、![图片](相对路径)、**加粗**
//  3. 不达标 → 触发后备方案（扩展注册自定义 storage.markdown）
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import { FontSize } from "./fontSize";
import { createImageExtension, createMarkdownExtension, serializeMarkdown } from "./markdown";
import fixture from "./__fixtures__/roundtrip.md?raw";

function createEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontSize,
      createImageExtension(),
      createMarkdownExtension(),
    ],
    content,
  });
}

function roundtrip(md: string): string {
  const editor = createEditor(md);
  try {
    return serializeMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

describe("markdown 往返（决策门）", () => {
  it("parse → serialize 语义稳定（幂等）", () => {
    const once = roundtrip(fixture);
    const twice = roundtrip(once);
    expect(twice).toBe(once);
  });

  it("关键标记保留", () => {
    const out = roundtrip(fixture);
    expect(out).toContain("<u>下划线</u>");
    expect(out).toContain("font-size: 24px");
    expect(out).toContain("大字号");
    expect(out).toContain("font-size: 18px");
    expect(out).toContain("粗体大字号");
    expect(out).toContain("**加粗**");
    expect(out).toContain("*斜体*");
    expect(out).toContain("![示例图](../attachments/2026-08/test.png)");
    expect(out).toContain("# 标题一");
    expect(out).toContain("- 列表项 1");
    expect(out).toContain("> 引用一段话");
    expect(out).toContain("`行内代码`");
  });

  it("中文内容无损", () => {
    const out = roundtrip(fixture);
    expect(out).toContain("中文标点测试：，。！？「轻笺」——省略号……");
  });

  it("字号/下划线可再次解析为对应 mark", () => {
    // 二次 parse 后检查文档中真实存在 textStyle(fontSize) 与 underline mark
    const once = roundtrip(fixture);
    const editor = createEditor(once);
    try {
      let foundFontSize = false;
      let foundUnderline = false;
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks) {
          if (mark.type.name === "textStyle" && mark.attrs.fontSize) foundFontSize = true;
          if (mark.type.name === "underline") foundUnderline = true;
        }
        return true;
      });
      expect(foundFontSize).toBe(true);
      expect(foundUnderline).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("无 alt 的图片（粘贴场景）序列化不抛异常", () => {
    // 回归：TipTap Image 的 alt 默认 null，曾导致 esc(null) 崩溃、保存静默失败
    const editor = new Editor({
      extensions: [
        StarterKit,
        createImageExtension(),
        createMarkdownExtension(),
      ],
      content: "",
    });
    try {
      editor.commands.setImage({ src: "data:image/png;base64,iVBORw0KGgo=" });
      const md = serializeMarkdown(editor, (src) =>
        src.startsWith("data:") ? "../../attachments/2026-08/x.png" : src
      );
      expect(md).toContain("![](../../attachments/2026-08/x.png)");
    } finally {
      editor.destroy();
    }
  });

  it("空文档往返为空", () => {
    expect(roundtrip("")).toBe("");
  });

  it("纯文本往返", () => {
    expect(roundtrip("只有一行文字")).toContain("只有一行文字");
  });
});
