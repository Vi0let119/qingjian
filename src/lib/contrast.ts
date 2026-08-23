// WCAG 对比度计算（纯函数，vitest 覆盖）与自动文字色选择。
// 参考 https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio

/** 解析 #rgb/#rrggbb/#rrggbbaa，返回 [r,g,b] 0-255；无法解析返回 null */
export function parseHex(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  const hex = m[1];
  let r: number, g: number, b: number;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length >= 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return null;
  }
  return [r, g, b];
}

/** sRGB 线性化（WCAG 定义） */
function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度 */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度 (L1+0.05)/(L2+0.05)；无法解析返回 null */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 对给定背景选择可读文字色：
 * 1. 主题 textToken 本身达标（≥4.5）→ 保留（维持设计意图，不无脑换纯黑）
 * 2. 不达标 → 在纯黑/纯白中取对比度更高者
 * 3. 仍不达标（极端背景色）→ 按主题基调强制纯黑/纯白（读数仍返回真实 ratio 供 UI 警告）
 */
export function autoTextColor(
  bg: string,
  textToken: string,
  base: "light" | "dark"
): { color: string; ratio: number } {
  const tokenRatio = contrastRatio(bg, textToken);
  if (tokenRatio !== null && tokenRatio >= 4.5) {
    return { color: textToken, ratio: tokenRatio };
  }
  let best = { color: textToken, ratio: tokenRatio ?? 0 };
  for (const c of ["#ffffff", "#000000"]) {
    const r = contrastRatio(bg, c);
    if (r !== null && r > best.ratio) best = { color: c, ratio: r };
  }
  if (best.ratio >= 4.5) return best;
  const forced = base === "light" ? "#2b2b28" : "#f5f3ed";
  const rf = contrastRatio(bg, forced) ?? 0;
  return { color: forced, ratio: rf };
}

/** #rrggbb → rgba(r,g,b,alpha)（全窗口背景图开启时模块毛玻璃半透明用） */
export function hexToRgba(hex: string, alpha: number): string {
  const parsed = parseHex(hex);
  if (!parsed) return hex;
  const [r, g, b] = parsed;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 把 colorB 以 ratio（0-1）混入 colorA，返回 #rrggbb。
 * 用于从主题 tokens 推导渐变（保证窗口底色与主题和谐）。
 */
export function mixHex(colorA: string, colorB: string, ratio: number): string {
  const a = parseHex(colorA);
  const b = parseHex(colorB);
  if (!a || !b) return colorA;
  const r = Math.round(a[0] + (b[0] - a[0]) * ratio);
  const g = Math.round(a[1] + (b[1] - a[1]) * ratio);
  const bl = Math.round(a[2] + (b[2] - a[2]) * ratio);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * 图片主色采样：canvas 缩到 1×1 取平均色（浏览器环境）。
 * 失败（跨域污染/无 canvas）返回 null → 调用方用 frost 遮罩兜底。
 */
export async function dominantColor(imageSrc: string): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageSrc;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}
