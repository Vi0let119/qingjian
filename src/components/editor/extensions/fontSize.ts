// 自定义字号扩展：TipTap 无内置字号，TextStyle 只是"带 style 属性的 mark"基类。
// 通过 addGlobalAttributes 把 fontSize 属性挂到 textStyle mark 上，
// 序列化/解析 HTML 走 style="font-size: Npx"，md 侧由 tiptap-markdown 的
// HTMLMark 兜底自动输出 <span style="font-size: Npx">（html 模式）。
import { Extension } from "@tiptap/core";
import "@tiptap/extension-text-style";

export type FontSizeLevel =
  | "12px"
  | "14px"
  | "16px"
  | "18px"
  | "20px"
  | "24px"
  | "28px"
  | "32px";

export const FONT_SIZE_LEVELS: FontSizeLevel[] = [
  "12px",
  "14px",
  "16px",
  "18px",
  "20px",
  "24px",
  "28px",
  "32px",
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /** 给选区设置字号 */
      setFontSize: (size: FontSizeLevel) => ReturnType;
      /** 清除选区字号 */
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create<{ types: string[] }>({
  name: "fontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) =>
              element.style.fontSize?.match(/^[1-9]\d*px$/)?.[0] ?? null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: FontSizeLevel) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain()
            .setMark("textStyle", { fontSize: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
