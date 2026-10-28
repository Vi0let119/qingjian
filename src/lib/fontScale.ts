/**
 * 界面字体缩放的纯函数部分（供组件与测试共用）。
 *
 * 为什么需要它：ThemeProvider 会把主题的 tokens.font.size（如 "14px"）写成
 * document.body 的内联 font-size，内联样式优先于 CSS 规则，会压掉 html 基准字号
 * 带来的 rem 缩放。所以「界面字体大小」设置必须在这里显式相乘。
 *
 * 为什么不用 zoom/transform：二者会改变元素坐标系，WebView2 计算中文输入法
 * 候选窗位置时拿不到缩放映射，候选框会跳到窗口左上角。字号乘法则保持坐标系不变。
 */
export function bodyFontSize(tokenSize: string, scale: number): string {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(tokenSize.trim());
  if (!m) return tokenSize; // 非 px 单位（如 rem）原样透传
  return `${(Number(m[1]) * scale).toFixed(2)}px`;
}
