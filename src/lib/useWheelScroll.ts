// 滚轮接管：WebView2 下原生滚动链不可靠（方向键可滚、滚轮不动），
// 对任意滚动容器挂非 passive wheel 监听手动滚动（deltaMode 归一化）。
// 用法：const ref = useRef<HTMLDivElement>(null); useWheelScroll(ref);
//       <div ref={ref} className="滚动容器">
// deps：容器在条件渲染后才出现时（如设置窗口主题加载后），
// 传依赖数组让 effect 在容器出现后重新挂监听（否则 ref 为空永远不生效）
import { useEffect, type RefObject } from "react";

export function useWheelScroll(ref: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dy = e.deltaY * unit;
      const canDown = dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const canUp = dy < 0 && el.scrollTop > 0;
      if (canDown || canUp) {
        el.scrollTop += dy;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
