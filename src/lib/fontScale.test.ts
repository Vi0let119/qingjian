import { describe, expect, it } from "vitest";
import { bodyFontSize } from "./fontScale";

describe("bodyFontSize（界面字体大小 × 主题字号）", () => {
  it("px 单位按缩放系数相乘", () => {
    expect(bodyFontSize("14px", 1)).toBe("14.00px");
    expect(bodyFontSize("14px", 1.3)).toBe("18.20px");
    // 13.5 × 0.85 = 11.475 —— toFixed 按双精度实际值四舍五入得 11.47
    expect(bodyFontSize("13.5px", 0.85)).toBe("11.47px");
  });

  it("非 px 单位原样透传（不猜测无法换算的单位）", () => {
    expect(bodyFontSize("0.875rem", 1.3)).toBe("0.875rem");
    expect(bodyFontSize("inherit", 1.2)).toBe("inherit");
  });

  it("脏数据不抛异常", () => {
    expect(bodyFontSize("  ", 1.2)).toBe("  ");
    expect(bodyFontSize("abc", 2)).toBe("abc");
  });
});
