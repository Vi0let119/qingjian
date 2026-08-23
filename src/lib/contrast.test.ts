import { describe, it, expect } from "vitest";
import { contrastRatio, autoTextColor, parseHex, luminance, mixHex, hexToRgba } from "./contrast";

// WCAG 已知色对断言（来自 WCAG 规范示例与常用色对）
describe("contrastRatio", () => {
  it("黑白对比度为 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("相同颜色对比度为 1", () => {
    expect(contrastRatio("#4a7c59", "#4a7c59")).toBeCloseTo(1, 5);
  });

  it("fern green on cream 满足 UI 元素可读（≥3.0）", () => {
    // 实测 4.38：主绿用于激活态/按钮等 UI 元素达标；
    // 正文文字用 #2b2b28（下方用例验证 ≥4.5）
    const ratio = contrastRatio("#4a7c59", "#f5f3ed");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(3.0);
  });

  it("正文 token 在米白底上满足 WCAG AA（≥4.5）", () => {
    const ratio = contrastRatio("#2b2b28", "#f5f3ed");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(4.5);
  });

  it("支持 #rgb 缩写", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 0);
  });

  it("非法输入返回 null", () => {
    expect(contrastRatio("not-a-color", "#fff")).toBeNull();
  });
});

describe("luminance / parseHex", () => {
  it("黑色亮度为 0，白色亮度为 1", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 5);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("parseHex 解析三种形式", () => {
    expect(parseHex("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseHex("#4a7c59")).toEqual([0x4a, 0x7c, 0x59]);
    expect(parseHex("#4a7c5980")).toEqual([0x4a, 0x7c, 0x59]);
    expect(parseHex("red")).toBeNull();
  });
});

describe("hexToRgba", () => {
  it("转换为 rgba 并应用透明度", () => {
    expect(hexToRgba("#4a7c59", 0.86)).toBe("rgba(74,124,89,0.86)");
    expect(hexToRgba("#fff", 0.5)).toBe("rgba(255,255,255,0.5)");
  });

  it("非法输入原样返回", () => {
    expect(hexToRgba("oops", 0.5)).toBe("oops");
  });
});

describe("mixHex", () => {
  it("ratio 0 返回 A，ratio 1 返回 B，中间值线性混合", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#4a7c59", "#f5f3ed", 0.5)).toBe("#a0b8a3");
  });

  it("非法输入回退 A", () => {
    expect(mixHex("not-a-color", "#ffffff", 0.5)).toBe("not-a-color");
  });
});

describe("autoTextColor", () => {
  it("深色背景自动选白色", () => {
    const r = autoTextColor("#1a1a1a", "#2b2b28", "light");
    expect(r.color).toBe("#ffffff");
    expect(r.ratio).toBeGreaterThan(4.5);
  });

  it("浅色背景保留深色 token", () => {
    const r = autoTextColor("#f5f3ed", "#2b2b28", "light");
    expect(r.color).toBe("#2b2b28");
    expect(r.ratio).toBeGreaterThan(4.5);
  });

  it("低对比 token 被纯黑/白取代", () => {
    // 灰 token 在灰底上达不到 4.5 → 换纯色
    const r = autoTextColor("#888888", "#909090", "light");
    expect(r.ratio).toBeGreaterThan(4.5);
    expect(["#ffffff", "#000000", "#2b2b28", "#f5f3ed"]).toContain(r.color);
  });
});
