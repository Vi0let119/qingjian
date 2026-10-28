/**
 * 数码涟漪：点击气泡后，从点击点扩散一圈"背景起伏"的波纹。
 *
 * 为什么用 Canvas 而不是纯 CSS：
 * 你要的是"带着背景数码上下起伏"——波纹过处的背景像素要有位移，而不是叠加一个圆环。
 * CSS 做不到像素位移，这里用 Canvas 作一层可控的折射叠层：
 * 画一层半透明的高光/暗边条纹，按波纹方程位移，视觉上就是背景被推起来了。
 *
 * 性能：只在波纹存活期间跑 rAF，波纹结束立刻 cancel，不留常驻循环。
 */
import { useEffect, useRef } from "react";

export interface RippleSpec {
  /** 波纹起点（画布坐标） */
  x: number;
  y: number;
  /** 触发时间戳 */
  at: number;
  /** 主色 RGB 三段式，用于着色 */
  rgb: string;
  /** 深色主题下高光要更亮 */
  dark: boolean;
}

interface Props {
  ripple: RippleSpec | null;
  onDone: () => void;
}

const DURATION = 780; // ms
const SPEED = 0.62; // px/ms —— 波纹扩张速度

export function RippleLayer({ ripple, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ripple) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const [r, g, b] = ripple.rgb.split(",").map(Number);

    const draw = (now: number) => {
      const t = now - ripple.at;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      if (t > DURATION) {
        onDone();
        return;
      }

      const radius = t * SPEED;
      // 包络：扩散越远越淡，尾段快速收掉
      const fade = Math.max(0, 1 - t / DURATION);
      const env = fade * fade;

      // 三层同心波纹：主波 + 两道余波，形成"水面被点了一下"的层次
      const rings = [
        { r: radius, width: 34, alpha: 0.5 * env },
        { r: radius * 0.82, width: 22, alpha: 0.26 * env },
        { r: radius * 0.64, width: 14, alpha: 0.14 * env },
      ];

      ctx.globalCompositeOperation = "lighter";
      for (const ring of rings) {
        if (ring.r <= 1 || ring.alpha <= 0.003) continue;
        const grad = ctx.createRadialGradient(
          ripple.x,
          ripple.y,
          Math.max(0, ring.r - ring.width),
          ripple.x,
          ripple.y,
          ring.r + ring.width * 0.5
        );
        // 波峰亮、波谷暗——这一明一暗就是"上下起伏"的错觉
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.45, `rgba(${r},${g},${b},${ring.alpha})`);
        grad.addColorStop(0.62, `rgba(255,255,255,${ring.alpha * (ripple.dark ? 0.5 : 0.34)})`);
        grad.addColorStop(0.8, `rgba(${r},${g},${b},${ring.alpha * 0.32})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ring.r + ring.width, 0, Math.PI * 2);
        ctx.fill();
      }

      // 数码感：沿波峰扫一圈细密刻度，像被数字化的水面
      const ticks = 64;
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2;
        // 起伏：不同角度波峰半径略有差异，制造"上下"的不规则
        const wobble = Math.sin(a * 5 + t * 0.006) * (ring0Wobble(ripple.x, i) ?? 0);
        const rr = radius + wobble * 6;
        const x1 = ripple.x + Math.cos(a) * (rr - 6);
        const y1 = ripple.y + Math.sin(a) * (rr - 6);
        const x2 = ripple.x + Math.cos(a) * (rr + 6);
        const y2 = ripple.y + Math.sin(a) * (rr + 6);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 * env})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [ripple, onDone]);

  return <canvas className="qj-ripple-canvas" ref={canvasRef} aria-hidden="true" />;
}

/** 轻微的空间扰动：让波峰不是完美圆（确定性，不用随机数保证可复现） */
function ring0Wobble(seed: number, i: number): number {
  return Math.sin(seed * 0.01 + i * 1.7) * 0.9;
}
