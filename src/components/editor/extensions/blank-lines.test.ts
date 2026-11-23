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

  /**
   * 回归：多个连续空行在**第二次往返**时坍缩成一个。
   * 用户报的现象是「打开文档时某处换行变多，删掉再退出又变回来」。
   * 根因是 restoreBlankParagraphs 把占位符还原成裸 <br>，markdown-it 把连续
   * <br> 当成同一段落的软换行，于是 N 个空行挤进一个 <p>（含 N 个 hardBreak），
   * 序列化时按段落计数只写回 1 个占位符 —— 空行数就漂了。
   * 修法是还原成完整段落 <p><br></p>。
   */
  it("多个连续空段落多轮往返后数量不漂移", () => {
    const html2 = "<p>甲</p><p></p><p></p><p>乙</p>";
    let md = withEditor(html2, serializeMarkdown);
    expect(withEditor(md, countBlanks), `pass1: ${JSON.stringify(md)}`).toBe(2);
    for (let i = 2; i <= 5; i++) {
      md = withEditor(md, serializeMarkdown);
      expect(withEditor(md, countBlanks), `pass${i}: ${JSON.stringify(md)}`).toBe(2);
    }
  });

  it("三个连续空段落多轮往返也稳定", () => {
    const html3 = "<p>甲</p><p></p><p></p><p></p><p>乙</p>";
    let md = withEditor(html3, serializeMarkdown);
    expect(withEditor(md, countBlanks), `pass1: ${JSON.stringify(md)}`).toBe(3);
    for (let i = 2; i <= 4; i++) {
      md = withEditor(md, serializeMarkdown);
      expect(withEditor(md, countBlanks), `pass${i}: ${JSON.stringify(md)}`).toBe(3);
    }
  });

  /**
   * 回归：空段落不能带「内容性」hardBreak。
   * 用户报的现象是「打开文档时一个换行变成两个」。
   * 根因是占位符被还原成 `<p><br></p>`，段落里那个 br 是真实内容，
   * ProseMirror 渲染时还会再补一个 trailingBreak，于是空行显示成两行高。
   * 正确形态是真空段落 `<p></p>`（content.size === 0）。
   */
  it("还原后的空段落必须是真空段落（不含 hardBreak），否则显示成两行高", () => {
    const md = "甲\n\n\u200b\u2063qjblank\u2063\u200b\n\n乙";
    const e = createEditor(md);
    try {
      const blanks: Array<{ size: number; kids: string[] }> = [];
      e.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.textContent.trim() === "") {
          blanks.push({
            size: node.content.size,
            kids: node.content.content.map((c) => c.type.name),
          });
        }
        return true;
      });
      expect(blanks.length).toBe(1);
      // 真空段落：没有内容，也就不可能有 hardBreak
      expect(blanks[0].size, `kids=${JSON.stringify(blanks[0].kids)}`).toBe(0);
      expect(blanks[0].kids).not.toContain("hardBreak");
    } finally {
      e.destroy();
    }
  });

  it("三个连续空行都还原成真空段落", () => {
    const M = "\u200b\u2063qjblank\u2063\u200b";
    const md = `甲\n\n${M}\n\n${M}\n\n${M}\n\n乙`;
    const e = createEditor(md);
    try {
      let withBreak = 0;
      let empty = 0;
      e.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.textContent.trim() === "") {
          empty++;
          if (node.content.content.some((c) => c.type.name === "hardBreak")) withBreak++;
        }
        return true;
      });
      expect(empty).toBe(3);
      expect(withBreak).toBe(0);
    } finally {
      e.destroy();
    }
  });

  it("单空行多轮往返同样稳定（跨版本文件兼容）", () => {
    // 老文件里可能是旧的裸 <br> 形态，读回重写后应统一收敛到新形态且不漂移
    let md = "甲\n\n\u200b\u2063qjblank\u2063\u200b\n\n乙";
    for (let i = 1; i <= 4; i++) {
      md = withEditor(md, serializeMarkdown);
      expect(withEditor(md, countBlanks), `pass${i}: ${JSON.stringify(md)}`).toBe(1);
    }
  });
});
