import { describe, expect, it } from "vitest";
import {
  LINE_SPACING_DEFAULT,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  lineSpacingCssValue,
  lineSpacingLabel,
  normalizeLineSpacing,
} from "./lineSpacing";

describe("normalizeLineSpacing", () => {
  it("缺省/非法值回落 1.0", () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(normalizeLineSpacing(v as number | null | undefined)).toBe(LINE_SPACING_DEFAULT);
    }
  });

  it("越界值被夹回范围", () => {
    expect(normalizeLineSpacing(0.1)).toBe(LINE_SPACING_MIN);
    expect(normalizeLineSpacing(99)).toBe(LINE_SPACING_MAX);
  });

  it("范围内的值原样保留", () => {
    expect(normalizeLineSpacing(1.25)).toBe(1.25);
    expect(normalizeLineSpacing(LINE_SPACING_MIN)).toBe(LINE_SPACING_MIN);
    expect(normalizeLineSpacing(LINE_SPACING_MAX)).toBe(LINE_SPACING_MAX);
  });

  it("默认值确实落在范围内", () => {
    expect(LINE_SPACING_DEFAULT).toBeGreaterThanOrEqual(LINE_SPACING_MIN);
    expect(LINE_SPACING_DEFAULT).toBeLessThanOrEqual(LINE_SPACING_MAX);
  });
});

describe("呈现", () => {
  it("CSS 值是可用的数字字符串", () => {
    expect(lineSpacingCssValue(1.3)).toBe("1.3");
    // 越界同样被夹
    expect(Number(lineSpacingCssValue(99))).toBe(LINE_SPACING_MAX);
  });

  it("标签是百分比", () => {
    expect(lineSpacingLabel(1)).toBe("100%");
    expect(lineSpacingLabel(1.35)).toBe("135%");
  });
});
