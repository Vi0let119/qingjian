/**
 * 主题色板派生层（v3）。
 *
 * 目的：让所有视觉层（气泡画布 / 气泡 / 涟漪 / 碎片窗口 / 编辑器纸面）
 * 都只有一个颜色来源——主题 tokens。任何层写死颜色，换主题就会花。
 *
 * 新主题在 JSON 里显式提供 desk/glow/bubble/bubbleEdge/ripple；
 * 老的自定义主题缺这些字段时，这里按 primary/bg 推导，保证仍然可用。
 */
import type { ThemeConfig } from "./api";
import { hexToRgba, mixHex } from "./contrast";

export interface BubblePalette {
  /** 画布最底层（桌面） */
  desk: string;
  /** 柔光斑颜色，RGB 三段式 "r,g,b" */
  glow: string;
  /** 气泡主色（半透明） */
  bubble: string;
  /** 气泡描边 / 高光 */
  bubbleEdge: string;
  /** 涟漪色 */
  ripple: string;
  /** 画布上的文字（面包屑等） */
  ink: string;
  inkDim: string;
  /** 是否深色底（决定阴影方向与文字明暗） */
  dark: boolean;
}

/** 主题是否有完整的 v3 扩展色板 */
export function hasFullPalette(cfg: ThemeConfig): boolean {
  const c = cfg.tokens.color;
  return !!(
    (c as unknown as Record<string, unknown>).desk &&
    (c as unknown as Record<string, unknown>).glow &&
    (c as unknown as Record<string, unknown>).bubble
  );
}

/**
 * 从主题推导完整气泡色板。
 * 显式色板优先；缺失字段按主色与底色的关系推导（而不是写死某个颜色）。
 */
export function bubblePalette(cfg: ThemeConfig | null): BubblePalette {
  const dark = cfg?.base === "dark";

  // 兜底默认值（无主题时）：中性灰，不偏向任何色相
  const fallback = {
    desk: dark ? "#141719" : "#dedbd1",
    primary: "#4a7c59",
    accent: "#c8a05a",
    bg: dark ? "#191c1f" : "#f0eee6",
    text: dark ? "#f2f0ea" : "#26251f",
    textSecondary: dark ? "#a5a49d" : "#5d5c55",
  };

  if (!cfg) {
    return {
      desk: fallback.desk,
      glow: hexToRgbTriplet(fallback.primary),
      bubble: hexToRgba(fallback.primary, 0.1),
      bubbleEdge: hexToRgba(fallback.primary, 0.34),
      ripple: hexToRgba(fallback.primary, 0.45),
      ink: fallback.text,
      inkDim: fallback.textSecondary,
      dark: false,
    };
  }

  const c = cfg.tokens.color as unknown as Record<string, string | undefined>;

  const desk = c.desk ?? mixHex(cfg.tokens.color.bg, dark ? "#000000" : "#8a8578", dark ? 0.35 : 0.12);
  const primary = cfg.tokens.color.primary;

  return {
    desk,
    glow: c.glow ?? hexToRgbTriplet(primary),
    bubble: c.bubble ?? hexToRgba(primary, dark ? 0.16 : 0.1),
    bubbleEdge: c.bubbleEdge ?? hexToRgba(primary, dark ? 0.45 : 0.32),
    ripple: c.ripple ?? hexToRgba(primary, 0.5),
    ink: cfg.tokens.color.text,
    inkDim: cfg.tokens.color.textSecondary,
    dark,
  };
}

/** "#4a7c59" → "74,124,89"（供 rgba(...) 与 canvas 使用） */
export function hexToRgbTriplet(hex: string): string {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `${r},${g},${b}`;
}

/** 把色板写成 CSS 变量（挂到元素或 :root 上） */
export function paletteVars(p: BubblePalette): Record<string, string> {
  return {
    "--qj-desk": p.desk,
    "--qj-glow-rgb": p.glow,
    "--qj-bubble": p.bubble,
    "--qj-bubble-edge": p.bubbleEdge,
    "--qj-ripple": p.ripple,
    "--qj-canvas-ink": p.ink,
    "--qj-canvas-ink-dim": p.inkDim,
  };
}
