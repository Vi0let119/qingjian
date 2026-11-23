// 气泡画布的背景波纹层：Perlin 噪声驱动的竖线波场。
//
// 位置很关键——必须放在 .qj-bubble-canvas 里、**.qj-bubble-stage 之外**：
// stage 上挂着拖拽平移/滚轮缩放的 transform，波纹若放进去会被一起拖动，
// 视觉上就变成"背景跟着气泡跑"，失去"背景"的属性。
import { useEffect, useRef } from "react";
import { WaveField } from "../../lib/waveField";
import { toWaveFieldOptions, type WaveSettings } from "../../lib/waveSettings";

interface WaveLayerProps {
  settings: WaveSettings;
}

export function WaveLayer({ settings }: WaveLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fieldRef = useRef<WaveField | null>(null);

  // 只在挂载时建实例；后续参数变化走 setOptions，避免每帧重挂
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const field = new WaveField(svg, toWaveFieldOptions(settings));
    fieldRef.current = field;
    return () => {
      field.destroy();
      fieldRef.current = null;
    };
    // settings 故意不进依赖：首次由它初始化，之后由下面那个 effect 增量更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 参数变化：原地改选项（WaveField 会自己重建网格）+ 开关动效
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.setOptions(toWaveFieldOptions(settings));
    field.setEnabled(settings.enabled);
  }, [settings]);

  return (
    <div className="qj-wave-layer" aria-hidden="true">
      <svg ref={svgRef} className="qj-wave-svg" />
    </div>
  );
}
