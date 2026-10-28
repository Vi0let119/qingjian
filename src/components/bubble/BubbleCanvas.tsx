// 气泡画布：可拖动 / 滚轮平移 / 点击涟漪 / 逐层展开。
// 设计意图见 docs/bubble-view.md：
// 气泡是"浏览与定位层"，点开笔记后才展开成书写纸面——书写不用气泡，避免光标与输入法错位。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { RippleLayer, type RippleSpec } from "./RippleLayer";
import "./bubble.css";

/** 视觉放大系数：布局算出的直径偏保守（为重叠兜底），渲染时放大一点更有存在感。
 * 与位置计算分开，避免放大破坏不重叠约束。 */
export const BUBBLE_VISUAL_SCALE = 1.3;

/** 视口缩放范围（滚轮）。下限保证气泡仍可读，上限避免糊成大块 */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;

/** 从 CSS 变量读主题光晕色（形如 "49,125,89"），供 Canvas 涟漪着色 */
function glowRgbFromCss(el: HTMLElement): string {
  const raw = getComputedStyle(el).getPropertyValue("--qj-glow-rgb").trim();
  return /^\d+,\d+,\d+$/.test(raw) ? raw : "74,124,89";
}

export interface BubbleItem {
  id: string;
  title: string;
  /** 气泡半径（px），由内容量决定 */
  size: number;
  /** 副标题：时间 / 数量 */
  meta?: string;
  /** 是否为空状态气泡（虚线轮廓，点击新建） */
  ghost?: boolean;
  /** 序号：用于 stagger 入场延迟 */
  index: number;
}

interface BubbleCanvasProps {
  items: BubbleItem[];
  /** 点击气泡：给出气泡中心坐标（用于涟漪起点与展开方向） */
  onOpen: (item: BubbleItem, origin: { x: number; y: number }) => void;
  /** 空白处双击：回到中心 */
  emptyHint?: ReactNode;
  /** 层级 key：变化时重播入场动画 */
  layerKey: string;
}

/** 环形排布：第一个在正上方，顺时针铺开。
 *
 * 半径不是估算的——按"相邻两气泡直径之和的一半 + 间隙"反推所需环半径：
 * 相邻圆心角为 2π/n，弦长 = 2R·sin(π/n) ≥ 半径和 + 间隙，
 * 由此得到 R ≥ (半径和 + 间隙) / (2·sin(π/n))。
 * 取所有相邻对的最大值，保证任何一对都不重叠。
 */
export function layoutBubbles(items: BubbleItem[], viewport: { w: number; h: number }) {
  const n = items.length;
  if (n === 0) return [] as Array<BubbleItem & { x: number; y: number }>;

  const cx = viewport.w / 2;
  const cy = viewport.h / 2;

  if (n === 1) {
    return [{ ...items[0], x: cx, y: cy }];
  }

  // 环形排布：2-5 个时 1 个居中、其余环绕（避免环心出现大片空洞）；
  // 6 个以上全部上环，否则中心那个会被挤得看不清。
  // 至少 3 颗才做"中心 + 环绕"：2 颗时中心 + 1 颗环上等于两个孤点，
  // 而且环上只有 1 颗时弦长约束退化（曾把气泡缩到 25px 导致文字看不见）
  const centerFirst = n >= 3 && n <= 5;
  const ringCount = centerFirst ? n - 1 : n;

  const maxSize = Math.max(...items.map((i) => i.size));
  const gap = 22 + maxSize * (BUBBLE_VISUAL_SCALE - 1);
  const angleStep = (Math.PI * 2) / Math.max(1, ringCount);
  const sinHalf = Math.max(0.08, Math.sin(angleStep / 2));

  // 环上气泡两两之间的弦长约束。
  // 环上只有 0 或 1 颗时，"自己和自己"的相邻对没有意义（弦长恒为 0），
  // 会把半径推到无穷然后整体缩到看不见 —— 笔记本里只有 2 篇笔记就会触发。
  let ring = 0;
  const ringItems = centerFirst ? items.slice(1) : items;
  if (ringItems.length >= 2) {
    for (let i = 0; i < ringItems.length; i++) {
      const a = ringItems[i];
      const b = ringItems[(i + 1) % ringItems.length];
      const need = ((a.size + b.size) / 2) * BUBBLE_VISUAL_SCALE + gap;
      ring = Math.max(ring, need / (2 * sinHalf));
    }
  }
  // 中心气泡与环上气泡也要留出间距
  if (centerFirst) {
    const cSize = items[0].size;
    for (const a of ringItems) {
      const need = ((cSize + a.size) / 2) * BUBBLE_VISUAL_SCALE + 18;
      ring = Math.max(ring, need);
    }
  }
  ring = Math.max(ring, 40);

  // 视口约束：纵向压扁 0.82，按纵向余量反推最大可用半径
  const maxR = Math.max(...items.map((i) => i.size)) / 2;
  const usableX = viewport.w / 2 - maxR - 28;
  const usableY = (viewport.h - 96) / 2 - maxR - 28; // 96 ≈ 面包屑高度
  const maxRing = Math.max(60, Math.min(usableX, usableY / 0.82));

  // 半径策略：至少要容得下不重叠（ring），但不能只贴着这个下限——
  // 否则气泡挤在正中、四周大片空荡。这里取"下限"和"可用空间"之间的 0.78，
  // 让环铺开到画面的大部分区域，同时仍然不重叠。
  const idealRing = Math.min(maxRing, Math.max(ring * 1.15, maxRing * 0.94));
  ring = Math.max(ring, idealRing);

  const scale = ring > maxRing ? maxRing / ring : 1;
  ring = Math.min(ring, maxRing);

  const placed = items.map((item, i) => {
    if (centerFirst && i === 0) {
      // 中心那颗：略放大一点，作为视觉锚点（页面里内容最多的笔记本通常排第一）
      return {
        ...item,
        size: Math.round(item.size * scale * 1.06),
        x: cx,
        y: cy,
      };
    }
    const k = centerFirst ? i - 1 : i;
    const angle = -Math.PI / 2 + k * angleStep;
    return {
      ...item,
      // 用实际绘制直径，保证测试与渲染看到的是同一组几何
      size: Math.round(item.size * scale),
      x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring * 0.82, // 纵向压扁一点，更像自然的堆放
    };
  });

  // 保险：纵向压扁 0.82 会缩短纵向弦长，可能仍有一对贴到一起。
  // 逐次缩小到所有相邻对都满足"视觉直径"约束（最多 12 次，避免病态输入死循环）。
  for (let iter = 0; iter < 12; iter++) {
    let worst = 0;
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      const b = placed[(i + 1) % placed.length];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const need = ((a.size + b.size) / 2) * BUBBLE_VISUAL_SCALE;
      if (dist < need) worst = Math.max(worst, need / Math.max(dist, 1));
    }
    if (worst <= 1.001) break;
    for (const p of placed) {
      p.size = Math.max(48, Math.floor(p.size / worst));
    }
  }

  return placed;
}

export function BubbleCanvas({ items, onOpen, emptyHint, layerKey }: BubbleCanvasProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ w: 900, h: 560 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** 视口缩放：滚轮改变，0.6–2.0 */
  const [zoom, setZoom] = useState(1);
  const [ripple, setRipple] = useState<RippleSpec | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(
    null
  );
  /** 层级切换时不做入场位移过渡，避免"新一层从很远的地方滑进来" */
  const skipTransition = useRef(false);

  // 尺寸跟随容器（ResizeObserver：窗口缩放/面板拖拽都能跟上）
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 切层时回到中心并复位缩放，避免上一层拖到很远后看不见新气泡
  useEffect(() => {
    skipTransition.current = true;
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    // 让 React 提交后再恢复过渡
    const t = window.setTimeout(() => {
      skipTransition.current = false;
    }, 30);
    return () => window.clearTimeout(t);
  }, [layerKey]);

  const placed = useMemo(() => layoutBubbles(items, viewport), [items, viewport]);

  // 拖动平移：在空白处按下才拖，避免和点击气泡冲突
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-bubble]")) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        ox: offset.x,
        oy: offset.y,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [offset]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setOffset({ x: d.ox + dx, y: d.oy + dy });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.moved) {
      setOffset({ x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) });
    }
    dragRef.current = null;
  }, []);

  // 滚轮 = 缩放画布（以鼠标位置为锚点），左键拖拽 = 平移。
  // 锚点算法：保持鼠标下的画布点在缩放前后停留在同一屏幕位置，
  // 否则缩放时视觉中心会漂移。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const delta = e.deltaY * unit;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      setZoom((z) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * Math.exp(-delta * 0.0016)));
        if (Math.abs(next - z) < 1e-4) return z;
        // 让 (px,py) 处的画布点在缩放后仍落在同一屏幕位置
        setOffset((o) => ({
          x: px - ((px - o.x) / z) * next,
          y: py - ((py - o.y) / z) * next,
        }));
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleBubble = useCallback(
    (item: BubbleItem & { x: number; y: number }, e: React.MouseEvent) => {
      e.stopPropagation();
      const el = wrapRef.current;
      const rect = el?.getBoundingClientRect();
      // 气泡在画布坐标系中的位置（含缩放与平移）
      const cx = item.x * zoom + offset.x;
      const cy = item.y * zoom + offset.y;
      const origin = rect ? { x: rect.left + cx, y: rect.top + cy } : { x: cx, y: cy };

      // 涟漪起点取实际点击点（不是气泡中心），手感更准
      const px = rect ? e.clientX - rect.left : cx;
      const py = rect ? e.clientY - rect.top : cy;

      const dark = document.documentElement.dataset.base === "dark";
      setRipple({
        x: px,
        y: py,
        at: performance.now(),
        rgb: glowRgbFromCss(el ?? document.documentElement),
        dark,
      });

      // 等波纹扩散一帧再切层，让用户看见"被点中的那一下"
      window.setTimeout(() => onOpen(item, origin), 240);
    },
    [offset, zoom, onOpen]
  );

  return (
    <div
      className="qj-bubble-canvas"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        setOffset({ x: 0, y: 0 });
        setZoom(1);
      }}
      data-zoomed={zoom < 0.5 ? "tiny" : zoom < 0.7 ? "far" : "near"}
      role="group"
      aria-label="气泡视图"
    >
      {placed.length === 0 && <div className="qj-bubble-empty">{emptyHint}</div>}

      <div
        className="qj-bubble-stage"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
          // 切层瞬间关掉过渡：新一层应从当前位置直接出现，而不是从上一层的位移滑过来
          transition: skipTransition.current ? "none" : undefined,
        }}
      >
        {placed.map((b) => (
          <button
            key={b.id}
            type="button"
            data-bubble
            className={`qj-bubble${b.ghost ? " is-ghost" : ""}`}
            style={
              {
                left: b.x,
                top: b.y,
                // 布局按"不重叠"的保守直径算位置，渲染时用 scale 放大视觉尺寸，
                // 两者分开以免放大破坏间距约束
                width: b.size,
                height: b.size,
                "--qj-i": b.index,
                "--qj-bubble-scale": BUBBLE_VISUAL_SCALE,
              } as CSSProperties
            }
            onClick={(e) => handleBubble(b, e)}
            title={b.title}
          >
            <span className="qj-bubble-title">{b.title}</span>
          </button>
        ))}
      </div>

      {/* 数码涟漪：Canvas 像素级波纹（背景被推起来的起伏感），随后层级切换 */}
      <RippleLayer ripple={ripple} onDone={() => setRipple(null)} />
    </div>
  );
}
