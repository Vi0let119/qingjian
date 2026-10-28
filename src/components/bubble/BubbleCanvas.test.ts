import { describe, expect, it } from "vitest";
import { layoutBubbles, BUBBLE_VISUAL_SCALE, type BubbleItem } from "./BubbleCanvas";

function makeItems(sizes: number[]): BubbleItem[] {
  return sizes.map((size, i) => ({
    id: `b${i}`,
    title: `气泡 ${i}`,
    size,
    index: i,
  }));
}

/** 任意两气泡的圆心距必须 ≥ 视觉半径和（渲染时放大了 1.3 倍，测试必须按视觉尺寸校验，
 * 否则布局通过了、实际却互相压住） */
function minGapOk(placed: Array<{ x: number; y: number; size: number }>) {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const need = ((a.size + b.size) / 2) * BUBBLE_VISUAL_SCALE;
      if (dist < need - 0.5) return { ok: false, pair: [i, j], dist, need };
    }
  }
  return { ok: true, pair: null, dist: 0, need: 0 };
}

describe("气泡排布", () => {
  it("单个气泡居中", () => {
    const out = layoutBubbles(makeItems([100]), { w: 1000, h: 600 });
    expect(out).toHaveLength(1);
    expect(out[0].x).toBe(500);
  });

  it("常规数量下气泡互不重叠", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const sizes = Array.from({ length: n }, (_, i) => 90 + (i % 4) * 20);
      const out = layoutBubbles(makeItems(sizes), { w: 1100, h: 671 });
      const check = minGapOk(out);
      expect(check.ok, `n=${n} 出现重叠: ${JSON.stringify(check)}`).toBe(true);
    }
  });

  it("气泡不超出画布边界", () => {
    const sizes = Array.from({ length: 6 }, () => 150);
    const view = { w: 1100, h: 671 };
    const out = layoutBubbles(makeItems(sizes), view);
    for (const b of out) {
      expect(b.x - b.size / 2).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.size / 2).toBeLessThanOrEqual(view.w + 1);
      // 纵向要考虑 0.82 压扁，留出面包屑高度
      expect(b.y - b.size / 2).toBeGreaterThanOrEqual(-1);
      expect(b.y + b.size / 2).toBeLessThanOrEqual(view.h + 1);
    }
  });

  it("空列表返回空数组", () => {
    expect(layoutBubbles([], { w: 800, h: 600 })).toEqual([]);
  });

  // 回归：笔记层里只有 2 篇笔记时，环上只剩 1 颗，
  // "自己和自己"的弦长约束把半径推到 1057，scale 被压到 0.27，
  // 气泡变成 25px，标题文字整个看不见（用户实际报告过）。
  it("少量气泡不会被缩到读不清（2 篇笔记的笔记本）", () => {
    for (const n of [1, 2, 3, 4]) {
      const out = layoutBubbles(makeItems(Array.from({ length: n }, () => 92)), {
        w: 1100,
        h: 671,
      });
      for (const b of out) {
        expect(b.size, `n=${n} 气泡被过度压缩到 ${b.size}px`).toBeGreaterThanOrEqual(72);
      }
    }
  });

  it("2 个气泡不会退化成'一大一小'的中心+环绕布局", () => {
    const out = layoutBubbles(makeItems([92, 92]), { w: 1100, h: 671 });
    expect(out).toHaveLength(2);
    // 普通环形排布：两颗尺寸相同（中心布局会把第一颗放大 1.06 倍）
    expect(out[0].size).toBe(out[1].size);
  });
});
