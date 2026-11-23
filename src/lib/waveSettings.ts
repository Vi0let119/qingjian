/**
 * 气泡背景波纹（WaveField）的设置类型与默认值。
 *
 * 参数存在 AppSettings 里（Rust 落盘 + 广播），设置窗口拖动滑杆即时生效。
 * 这里只暴露 5 个"最影响观感/手感"的参数，其余 13 个留在 WaveField
 * 的 DEFAULT_OPTIONS 里不对外开放——放出来只会让设置页变成调参面板。
 */

/** 可在设置界面调整的波纹参数。 */
export interface WaveSettings {
  /** 总开关：关闭后波纹静止成静态图案，rAF 完全停掉（省电）。 */
  enabled: boolean;
  /** 竖线横向间距（px）。越小越密、越吃性能。 */
  columnGap: number;
  /** 噪声推动的水平幅度（px）。越大起伏越明显。 */
  amplitude: number;
  /** 流动速度倍率（相对 timeScaleX 基准值）。 */
  speed: number;
  /** 指针影响半径（px）。 */
  pointerRadius: number;
  /** 指针推力（相对 pointerStrength 基准值）。越大越"黏手"。 */
  pointerStrength: number;
}

export const WAVE_DEFAULTS: Readonly<WaveSettings> = Object.freeze({
  enabled: true,
  columnGap: 10,
  amplitude: 32,
  speed: 1,
  pointerRadius: 175,
  pointerStrength: 1,
});

/** 滑杆范围（设置界面与夹取逻辑共用）。 */
export const WAVE_RANGES = Object.freeze({
  columnGap: { min: 6, max: 28, step: 1 },
  amplitude: { min: 0, max: 80, step: 1 },
  speed: { min: 0, max: 3, step: 0.1 },
  // step 必须能整除到 175（默认值）：否则 range 控件会把 175 吸附显示成 180，
  // 界面值与真实值不一致，用户一拖滑杆就把参数永久改成吸附值。
  pointerRadius: { min: 40, max: 400, step: 5 },
  pointerStrength: { min: 0, max: 3, step: 0.1 },
});

/** 把可能缺失/越界的设置夹回合法范围（老版本 settings.json 没有这些字段）。 */
export function normalizeWaveSettings(raw: Partial<WaveSettings> | null | undefined): WaveSettings {
  const clamp = (v: unknown, range: { min: number; max: number }, fallback: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
    return Math.min(range.max, Math.max(range.min, n));
  };
  return {
    enabled: raw?.enabled ?? WAVE_DEFAULTS.enabled,
    columnGap: clamp(raw?.columnGap, WAVE_RANGES.columnGap, WAVE_DEFAULTS.columnGap),
    amplitude: clamp(raw?.amplitude, WAVE_RANGES.amplitude, WAVE_DEFAULTS.amplitude),
    speed: clamp(raw?.speed, WAVE_RANGES.speed, WAVE_DEFAULTS.speed),
    pointerRadius: clamp(raw?.pointerRadius, WAVE_RANGES.pointerRadius, WAVE_DEFAULTS.pointerRadius),
    pointerStrength: clamp(
      raw?.pointerStrength,
      WAVE_RANGES.pointerStrength,
      WAVE_DEFAULTS.pointerStrength
    ),
  };
}

/** 基准值：WaveField 默认参数里对应的原始数字，乘倍率还原。 */
const TIME_SCALE_X_BASE = 0.0025;
const POINTER_STRENGTH_BASE = 0.00065;

/** 把界面设置翻译成 WaveField 的 options。 */
export function toWaveFieldOptions(s: WaveSettings) {
  return {
    columnGap: s.columnGap,
    amplitudeX: s.amplitude,
    // 垂直幅度按参考实现的 1:2 比例跟随水平幅度
    amplitudeY: s.amplitude / 2,
    timeScaleX: TIME_SCALE_X_BASE * s.speed,
    // y 方向速度同步缩放，保持流动方向比例不变
    timeScaleY: 0.00075 * s.speed,
    pointerRadius: s.pointerRadius,
    pointerStrength: POINTER_STRENGTH_BASE * s.pointerStrength,
  };
}
