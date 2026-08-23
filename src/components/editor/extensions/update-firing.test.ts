// @vitest-environment happy-dom
// 诊断：直接 view.dispatch(tr) 插入图片节点是否触发 TipTap onUpdate（自动保存依赖它）。
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createImageExtension, createMarkdownExtension } from "./markdown";

function createEditor(onUpdate: () => void) {
  return new Editor({
    extensions: [StarterKit, createImageExtension(), createMarkdownExtension()],
    content: "",
    onUpdate,
  });
}

describe("图片插入触发 onUpdate 诊断", () => {
  it("直接 view.dispatch 插入图片应触发 onUpdate", () => {
    let updates = 0;
    const editor = createEditor(() => updates++);
    try {
      const view = editor.view;
      const node = view.state.schema.nodes.image.create({
        src: "data:image/png;base64,iVBORw0KGgo=",
      });
      view.dispatch(view.state.tr.replaceSelectionWith(node));
      expect(updates).toBeGreaterThan(0);
    } finally {
      editor.destroy();
    }
  });

  it("editor.commands.setImage 应触发 onUpdate（对照组）", () => {
    let updates = 0;
    const editor = createEditor(() => updates++);
    try {
      editor.commands.setImage({ src: "data:image/png;base64,iVBORw0KGgo=" });
      expect(updates).toBeGreaterThan(0);
    } finally {
      editor.destroy();
    }
  });
});
