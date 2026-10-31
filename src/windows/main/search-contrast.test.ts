// 回归：所有主题下，搜索结果卡片里的文字都必须与卡片底色有足够对比度。
// 曾经踩过的坑：样式里写了不存在的变量 --qj-text-muted，
// var() 取不到值 → 回落到浏览器默认黑色，深色主题下正文直接看不见。
import { describe, it, expect } from "vitest";

interface ThemeColor {
  primary: string;
  bg: string;
  surface: string;
  text: string;
  textSecondary: string;
}

// 直接吃构建期已知的主题文件，避免依赖 node:fs（项目没装 @types/node）
const themeModules = import.meta.glob<{ tokens: { color: ThemeColor } }>(
  "../../../src-tauri/themes/*.json",
  { eager: true, import: "default" }
);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** 与 CSS color-mix(in srgb, a p%, b) 等价的混合 */
function mix(a: string, b: string, aRatio: number): string {
  return blend(a, b, aRatio);
}

/** 卡片底色：surface 以 62% 叠在窗口底色上（见 main.css .qj-search-card） */
function blend(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  const mix = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const themes = Object.entries(themeModules).map(([path, mod]) => ({
  name: path.split("/").pop() ?? path,
  color: mod.tokens.color,
}));

describe("搜索结果卡片对比度", () => {
  it("主题文件读得到", () => {
    expect(themes.length).toBeGreaterThan(10);
  });

  for (const theme of themes) {
    it(`${theme.name}：标题与摘要都看得清`, () => {
      const cardBg = blend(theme.color.surface, theme.color.bg, 0.62);
      const titleRatio = contrast(theme.color.text, cardBg);
      // 摘要色 = textSecondary 42% + text 58%（见 main.css .qj-search-card-snippet）
      const snippetColor = mix(theme.color.textSecondary, theme.color.text, 0.42);
      const snippetRatio = contrast(snippetColor, cardBg);

      expect(
        titleRatio,
        `标题对比度 ${titleRatio.toFixed(2)}（文字 ${theme.color.text}，底色 ${cardBg}）`
      ).toBeGreaterThanOrEqual(4.5);
      // 摘要按 5.4 要求：4.5 只是"最低能读"，实测用户觉得偏淡；
      // 但沙汀这类"卡片底色本身偏暗"的主题，再往上只能把字压成纯黑，
      // 反而突兀——5.4 是这套色板在不丑的前提下能给到的上限
      expect(
        snippetRatio,
        `摘要对比度 ${snippetRatio.toFixed(2)}（文字 ${snippetColor}，底色 ${cardBg}）`
      ).toBeGreaterThanOrEqual(5.4);
    });
  }
});
