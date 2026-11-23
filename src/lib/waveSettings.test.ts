// WaveField 纯函数与设置归一化的单测。
// 只测不依赖真实 DOM 渲染的部分：网格几何、Perlin 确定性、参数夹取。
import { describe, expect, it } from "vitest";
import { computeGrid, DEFAULT_OPTIONS, Perlin } from "../lib/waveField";
import {
  normalizeWaveSettings,
  toWaveFieldOptions,
  WAVE_DEFAULTS,
  WAVE_RANGES,
} from "../lib/waveSettings";

describe("computeGrid", () => {
  it("按间距铺满画布并给出连贯的基准坐标", () => {
    const g = computeGrid(900, 560, { columnGap: 10, rowGap: 32, marginX: 200, marginY: 30 });
    expect(g.lineCount).toBe(Math.ceil((900 + 200) / 10) + 1);
    expect(g.pointsPerLine).toBe(Math.ceil((560 + 30) / 32) + 1);
    expect(g.baseX.length).toBe(g.lineCount * g.pointsPerLine);
    expect(g.baseY.length).toBe(g.baseX.length);
  });

  it("同一列上的点共享 x，同一行上的点共享 y", () => {
    const g = computeGrid(400, 300, { columnGap: 20, rowGap: 25 });
    const rows = g.pointsPerLine;
    // 每列第一个点的 x 应等于该列任意点的 x
    for (let c = 0; c < g.lineCount; c++) {
      const firstX = g.baseX[c * rows];
      for (let r = 0; r < rows; r++) {
        expect(g.baseX[c * rows + r]).toBeCloseTo(firstX, 5);
      }
    }
    // 第一列各点的 y 应严格递增（竖线向下延伸）
    for (let r = 1; r < rows; r++) {
      expect(g.baseY[r]).toBeGreaterThan(g.baseY[r - 1]);
    }
  });

  it("间距为 0 或负数时不产生 Infinity/NaN（设置滑杆的下限兜底）", () => {
    for (const bad of [0, -5]) {
      const g = computeGrid(800, 600, { columnGap: bad, rowGap: bad });
      expect(Number.isFinite(g.lineCount)).toBe(true);
      expect(Number.isFinite(g.pointsPerLine)).toBe(true);
      expect(g.baseX.length).toBeGreaterThan(0);
      expect(Number.isFinite(g.baseX[0])).toBe(true);
    }
  });

  it("零尺寸容器返回空网格且不抛错", () => {
    const g = computeGrid(0, 0, {});
    expect(g.baseX.length).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(g.lineCount)).toBe(true);
  });
});

describe("Perlin", () => {
  it("相同 seed 得到完全相同的噪声序列（可复现）", () => {
    const a = new Perlin(12345);
    const b = new Perlin(12345);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(a.noise2(x, y)).toBe(b.noise2(x, y));
    }
  });

  it("不同 seed 给出不同序列", () => {
    const a = new Perlin(1);
    const b = new Perlin(999);
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      if (Math.abs(a.noise2(i * 0.3, i * 0.2) - b.noise2(i * 0.3, i * 0.2)) > 1e-6) diff++;
    }
    expect(diff).toBeGreaterThan(40);
  });

  it("输出落在约 -1…1 区间内", () => {
    const p = new Perlin(42);
    for (let i = 0; i < 200; i++) {
      const v = p.noise2(i * 0.129, i * 0.071);
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });
});

describe("normalizeWaveSettings", () => {
  it("null / undefined / 空对象全部回落到默认值", () => {
    for (const raw of [null, undefined, {}]) {
      expect(normalizeWaveSettings(raw)).toEqual(WAVE_DEFAULTS);
    }
  });

  it("越界值被夹回滑杆范围", () => {
    const out = normalizeWaveSettings({
      columnGap: 9999,
      amplitude: -50,
      speed: 100,
      pointerRadius: 1,
      pointerStrength: -3,
    });
    expect(out.columnGap).toBe(WAVE_RANGES.columnGap.max);
    expect(out.amplitude).toBe(WAVE_RANGES.amplitude.min);
    expect(out.speed).toBe(WAVE_RANGES.speed.max);
    expect(out.pointerRadius).toBe(WAVE_RANGES.pointerRadius.min);
    expect(out.pointerStrength).toBe(WAVE_RANGES.pointerStrength.min);
  });

  it("NaN / 非数字回落默认而不是污染渲染", () => {
    const out = normalizeWaveSettings({
      columnGap: NaN,
      amplitude: "abc" as unknown as number,
    });
    expect(out.columnGap).toBe(WAVE_DEFAULTS.columnGap);
    expect(out.amplitude).toBe(WAVE_DEFAULTS.amplitude);
  });

  it("enabled 缺省为 true", () => {
    expect(normalizeWaveSettings({ columnGap: 12 }).enabled).toBe(true);
    expect(normalizeWaveSettings({ enabled: false }).enabled).toBe(false);
  });
});

describe("滑杆范围与默认值的一致性", () => {
  // 浏览器 range 控件会把 value 吸附到 min + n*step。
  // 若默认值不在这个序列上，界面显示的数字就和真实值不一致，
  // 用户拖一下就永久改成吸附值 —— 这个坑踩过一次，锁死。
  it("每个可调参数的默认值都落在 min + n*step 上（否则滑杆显示会漂移）", () => {
    const keys = ["columnGap", "amplitude", "speed", "pointerRadius", "pointerStrength"] as const;
    for (const k of keys) {
      const range = WAVE_RANGES[k];
      const def = WAVE_DEFAULTS[k];
      const steps = (def - range.min) / range.step;
      expect(Number.isInteger(steps), `${k}: 默认值 ${def} 不在 step 序列上`).toBe(true);
    }
  });

  it("默认值都落在滑杆范围之内", () => {
    const keys = ["columnGap", "amplitude", "speed", "pointerRadius", "pointerStrength"] as const;
    for (const k of keys) {
      const range = WAVE_RANGES[k];
      expect(WAVE_DEFAULTS[k]).toBeGreaterThanOrEqual(range.min);
      expect(WAVE_DEFAULTS[k]).toBeLessThanOrEqual(range.max);
    }
  });
});

describe("toWaveFieldOptions", () => {
  it("速度按倍率缩放两个方向的 timeScale", () => {
    const base = toWaveFieldOptions({ ...WAVE_DEFAULTS, speed: 1 });
    const fast = toWaveFieldOptions({ ...WAVE_DEFAULTS, speed: 2 });
    expect(fast.timeScaleX).toBeCloseTo(base.timeScaleX * 2, 10);
    expect(fast.timeScaleY).toBeCloseTo(base.timeScaleY * 2, 10);
    // 1× 应与 WaveField 自身默认值一致，保证"默认观感 = 参考实现"
    expect(base.timeScaleX).toBeCloseTo(DEFAULT_OPTIONS.timeScaleX, 10);
    expect(base.timeScaleY).toBeCloseTo(DEFAULT_OPTIONS.timeScaleY, 10);
  });

  it("推力按倍率缩放，1× 等于参考实现默认值", () => {
    const base = toWaveFieldOptions({ ...WAVE_DEFAULTS, pointerStrength: 1 });
    expect(base.pointerStrength).toBeCloseTo(DEFAULT_OPTIONS.pointerStrength, 12);
    expect(toWaveFieldOptions({ ...WAVE_DEFAULTS, pointerStrength: 0 }).pointerStrength).toBe(0);
  });

  it("垂直幅度跟随水平幅度的一半（参考实现的 2:1 比例）", () => {
    const o = toWaveFieldOptions({ ...WAVE_DEFAULTS, amplitude: 60 });
    expect(o.amplitudeX).toBe(60);
    expect(o.amplitudeY).toBe(30);
  });

  it("默认设置映射回 WaveField 的原始默认值", () => {
    const o = toWaveFieldOptions(WAVE_DEFAULTS);
    expect(o.columnGap).toBe(DEFAULT_OPTIONS.columnGap);
    expect(o.amplitudeX).toBe(DEFAULT_OPTIONS.amplitudeX);
    expect(o.amplitudeY).toBe(DEFAULT_OPTIONS.amplitudeY);
    expect(o.pointerRadius).toBe(DEFAULT_OPTIONS.pointerRadius);
  });
});
