// @vitest-environment happy-dom
// 回归：连续空行（多个回车）在保存后必须保留。
// 用户报的是"加进去的回车符在每次应用重新打开的时候会被吃掉"。
//
// 根因：markdown-it 在**解析**阶段就把连续空行吃掉（`甲\n\n\n\n乙` 解析出来
// 只有两个段落、中间没有任何空段落），所以只改序列化没用。
// 修法：空段落落盘时写成只含占位符的段落，读回时还原成空段落。
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import { FontSize } from "./fontSize";
import {
  createImageExtension,
  createMarkdownExtension,
  restoreBlankParagraphs,
  serializeMarkdown,
} from "./markdown";

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
    content: restoreBlankParagraphs(content),
  });
}

function withEditor<T>(content: string, fn: (e: Editor) => T): T {
  const e = createEditor(content);
  try {
    return fn(e);
  } finally {
    e.destroy();
  }
}

/**
 * 数"视觉上的空行"。
 * 读回来时连续的占位行会被合并成一个段落里的多个 hardBreak，
 * 所以按"空段落 + 其中的 hardBreak"一起数，才等于用户看到的空行数。
 */
function countBlanks(e: Editor): number {
  let n = 0;
  e.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.textContent.trim() === "") {
      const breaks = node.content.content.filter((c) => c.type.name === "hardBreak").length;
      n += Math.max(1, breaks);
    }
    return true;
  });
  return n;
}

/** 模拟一次「保存 → 重新打开 → 再保存」 */
function saveReloadSave(md: string): string {
  const saved = withEditor(md, serializeMarkdown);
  return withEditor(saved, serializeMarkdown);
}

describe("空行保留", () => {
  it("单个空行（段落间隔）稳定", () => {
    expect(saveReloadSave("第一段\n\n第二段")).toBe("第一段\n\n第二段");
  });

  it("敲两次回车产生的空段落，保存后重新打开还在", () => {
    const saved = withEditor("<p>第一段</p><p></p><p>第二段</p>", serializeMarkdown);
    expect(withEditor(saved, countBlanks), `保存后：${JSON.stringify(saved)}`).toBe(1);
    expect(saveReloadSave(saved)).toBe(saved);
  });

  it("多个连续空段落都能保留", () => {
    const saved = withEditor("<p>甲</p><p></p><p></p><p>乙</p>", serializeMarkdown);
    expect(withEditor(saved, countBlanks), `保存后：${JSON.stringify(saved)}`).toBe(2);
  });

  it("占位符不会泄漏到编辑器可见文本", () => {
    const saved = withEditor("<p>甲</p><p></p><p>乙</p>", serializeMarkdown);
    const text = withEditor(saved, (e) => e.state.doc.textContent);
    expect(text).not.toContain("qjblank");
    expect(text).not.toContain("\u200b");
  });

  it("普通单段内容不受影响", () => {
    expect(saveReloadSave("只有一段")).toBe("只有一段");
  });
});
