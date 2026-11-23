// 书写行间距：设置值 → CSS 变量 --qj-line-scale。
//
// 为什么用倍率而不是直接写 line-height 数值：
// editor.css 里正文基准是 line-height: 1.9、碎片紧凑模式是 1.7，
// 两者按同一倍率缩放才能保持一致的比例关系。
// 倍率 1.0 时 CSS 算出来正好是原来的写死值，老用户观感不变。

/** 可调范围。上限 1.6 时正文行高约 3.04，已经相当舒缓；再大就散了。 */
export const LINE_SPACING_MIN = 0.8;
export const LINE_SPACING_MAX = 1.6;
export const LINE_SPACING_STEP = 0.05;
export const LINE_SPACING_DEFAULT = 1;

/** 夹回合法范围（老配置缺字段、被手改坏、NaN 都兜住）。 */
export function normalizeLineSpacing(raw: number | null | undefined): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : LINE_SPACING_DEFAULT;
  return Math.min(LINE_SPACING_MAX, Math.max(LINE_SPACING_MIN, n));
}

/** 写成 CSS 变量值。 */
export function lineSpacingCssValue(scale: number): string {
  return String(normalizeLineSpacing(scale));
}

/** 给界面显示的百分比文案。 */
export function lineSpacingLabel(scale: number): string {
  return `${Math.round(normalizeLineSpacing(scale) * 100)}%`;
}
