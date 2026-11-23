/**
 * WaveField —— Perlin 噪声波场背景，零依赖、框架无关。
 *
 * 移植自 wave-field/wave-field.js（SnowLuma 控制台登录页动效），
 * 改为 TypeScript 并收紧类型；算法与默认值与参考实现保持一致。
 *
 * 设计上只负责几何与描边，**颜色交给 CSS**（`stroke: currentColor`），
 * 因此在任何主题里都能直接套用。
 *
 * @example
 *   const field = new WaveField(svgElement);
 *   field.setOptions({ columnGap: 16 });
 *   field.destroy();
 */

/** 参数字段类型（不带字面量，供 Partial<> 使用）。 */
export interface WaveFieldOptionFields {
  columnGap: number;
  rowGap: number;
  marginX: number;
  marginY: number;
  amplitudeX: number;
  amplitudeY: number;
  angleScale: number;
  noiseScaleX: number;
  noiseScaleY: number;
  timeScaleX: number;
  timeScaleY: number;
  pointerRadius: number;
  pointerStrength: number;
  pointerMaxOffset: number;
  pointerDamping: number;
  pointerEase: number;
  mergePaths: boolean;
  respectReducedMotion: boolean;
  pointerTarget: EventTarget | null;
}

/** 默认参数。数值与参考实现一致，观感可直接对齐。 */
export const DEFAULT_OPTIONS: Readonly<WaveFieldOptionFields> = Object.freeze({
  /** 竖线之间的横向间距（px）。越小越密、越吃性能。 */
  columnGap: 10,
  /** 单条竖线上相邻采样点的纵向间距（px）。 */
  rowGap: 32,
  /** 画布左右各外扩多少（px），避免线条在边缘"断头"。 */
  marginX: 200,
  /** 画布上下各外扩多少（px）。 */
  marginY: 30,

  /** 每个点被噪声推动的水平幅度（px）。 */
  amplitudeX: 32,
  /** 每个点被噪声推动的垂直幅度（px）。 */
  amplitudeY: 16,
  /** 噪声的角度倍率：perlin 输出 × 该值 → 弧度。越大越扭曲。 */
  angleScale: 12,
  /** 噪声在 x 方向的频率。 */
  noiseScaleX: 0.002,
  /** 噪声在 y 方向的频率。 */
  noiseScaleY: 0.0015,
  /** 波动随时间的推进速度（x 方向）。 */
  timeScaleX: 0.0025,
  /** 波动随时间的推进速度（y 方向）。 */
  timeScaleY: 0.00075,

  /** 指针影响半径（px）。 */
  pointerRadius: 175,
  /** 指针推力系数。越大越"粘手"。 */
  pointerStrength: 0.00065,
  /** 单点偏离基准位置的上限（px）。 */
  pointerMaxOffset: 100,
  /** 每帧速度保留率（阻尼）。0.9 附近回弹更"肉"。 */
  pointerDamping: 0.925,
  /** 指针位置跟随的平滑系数（0–1，越大越跟手）。 */
  pointerEase: 0.1,

  /**
   * true = 所有线条合并进单个 <path>（每帧 1 次属性写入，推荐）。
   * false = 每条线一个 <path>（便于单独控制某条线）。
   */
  mergePaths: true,
  /** 遵循 prefers-reduced-motion：为真时该媒体查询命中则静止为静态波纹。 */
  respectReducedMotion: true,
  /** 指针事件的来源，默认 window（适合铺满视口的背景层）。 */
  pointerTarget: null,
});

export type WaveFieldOptions = Readonly<WaveFieldOptionFields>;
export type WaveFieldPatch = Partial<WaveFieldOptionFields>;

/** 网格几何结果。 */
export interface WaveGrid {
  lineCount: number;
  pointsPerLine: number;
  baseX: Float32Array;
  baseY: Float32Array;
}

/** Perlin 噪声（2D），固定梯度表 + 可播种排列。 */
export class Perlin {
  static readonly #GRAD: ReadonlyArray<readonly [number, number]> = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [1, 0], [-1, 0],
    [0, 1], [0, -1], [0, 1], [0, -1],
  ];

  readonly #perm = new Uint8Array(512);

  /** @param seed 0–1 或任意正数；相同 seed 得到相同噪声。 */
  constructor(seed: number = Math.random()) {
    this.#seedWith(seed);
  }

  #seedWith(seed: number): void {
    let s = seed;
    if (s > 0 && s < 1) s *= 65536;
    s = Math.floor(s);
    if (s < 256) s |= s << 8;

    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // 确定性洗牌（xorshift 驱动），避免依赖 Math.random 影响可复现性
    let state = ((s ^ 0x9e3779b9) >>> 0) || 1;
    for (let i = 255; i > 0; i--) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      const j = state % (i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.#perm[i] = p[i & 255];
  }

  static #fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  static #lerp(a: number, b: number, t: number): number {
    return (1 - t) * a + t * b;
  }

  static #dot(g: readonly [number, number], x: number, y: number): number {
    return g[0] * x + g[1] * y;
  }

  /** @returns 约 -1…1 的平滑噪声。 */
  noise2(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const perm = this.#perm;
    const G = Perlin.#GRAD;

    const aa = G[perm[X + perm[Y]] % 12];
    const ba = G[perm[X + 1 + perm[Y]] % 12];
    const ab = G[perm[X + perm[Y + 1]] % 12];
    const bb = G[perm[X + 1 + perm[Y + 1]] % 12];

    const u = Perlin.#fade(xf);
    const v = Perlin.#fade(yf);
    const top = Perlin.#lerp(Perlin.#dot(aa, xf, yf), Perlin.#dot(ba, xf - 1, yf), u);
    const bottom = Perlin.#lerp(Perlin.#dot(ab, xf, yf - 1), Perlin.#dot(bb, xf - 1, yf - 1), u);
    return Perlin.#lerp(top, bottom, v);
  }
}

/**
 * 纯函数：按容器尺寸算出采样点网格。
 * 抽出来便于单独测试，也方便在 canvas 等其它渲染目标里复用同一套点阵。
 */
export function computeGrid(
  width: number,
  height: number,
  opts: WaveFieldPatch = {}
): WaveGrid {
  const {
    columnGap = DEFAULT_OPTIONS.columnGap,
    rowGap = DEFAULT_OPTIONS.rowGap,
    marginX = DEFAULT_OPTIONS.marginX,
    marginY = DEFAULT_OPTIONS.marginY,
  } = opts;

  // 参数来自设置界面：夹住下限，避免 0 或负数把网格算成 Infinity
  const gapX = Math.max(1, columnGap);
  const gapY = Math.max(1, rowGap);

  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const cols = Math.ceil((w + marginX) / gapX);
  const rows = Math.ceil((h + marginY) / gapY);
  const lineCount = cols + 1;
  const pointsPerLine = rows + 1;
  const startX = (w - gapX * cols) / 2;
  const startY = (h - gapY * rows) / 2;

  const baseX = new Float32Array(lineCount * pointsPerLine);
  const baseY = new Float32Array(lineCount * pointsPerLine);
  let i = 0;
  for (let c = 0; c < lineCount; c++) {
    const x = startX + gapX * c;
    for (let r = 0; r < pointsPerLine; r++) {
      baseX[i] = x;
      baseY[i] = startY + gapY * r;
      i++;
    }
  }
  return { lineCount, pointsPerLine, baseX, baseY };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function reduceQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
}

/** 指针物理状态。 */
interface PointerState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  v: number;
  vs: number;
  a: number;
  init: boolean;
}

/** 把波场挂到指定的 <svg> 上（它会负责往 svg 里塞 <path>）。 */
export class WaveField {
  readonly #svg: SVGSVGElement;
  readonly #host: HTMLElement;
  #opts: WaveFieldOptions;
  readonly #perlin: Perlin;

  #lineCount = 0;
  #pointsPerLine = 0;
  #count = 0;
  #baseX: Float32Array = new Float32Array(0);
  #baseY: Float32Array = new Float32Array(0);
  #waveX: Float32Array = new Float32Array(0);
  #waveY: Float32Array = new Float32Array(0);
  #offX: Float32Array = new Float32Array(0);
  #offY: Float32Array = new Float32Array(0);
  #velX: Float32Array = new Float32Array(0);
  #velY: Float32Array = new Float32Array(0);

  #paths: SVGPathElement[] = [];
  #parts: string[] = [];
  #raf = 0;
  #enabled = true;
  #destroyed = false;
  #lastW = 0;
  #lastH = 0;
  #mq: MediaQueryList | null = null;
  #ro: ResizeObserver | null = null;
  #onMqChange: (() => void) | null = null;
  #onPointerMove: ((e: PointerEvent) => void) | null = null;

  #p: PointerState = { x: -10, y: 0, sx: 0, sy: 0, lx: 0, ly: 0, v: 0, vs: 0, a: 0, init: false };

  constructor(svg: SVGSVGElement, options: WaveFieldPatch = {}) {
    if (!svg || svg.namespaceURI !== SVG_NS) {
      throw new TypeError("[WaveField] 需要一个 <svg> 元素作为挂载点");
    }
    this.#svg = svg;
    this.#host = (svg.parentElement as HTMLElement) || svg;
    this.#opts = { ...DEFAULT_OPTIONS, ...options };
    this.#perlin = new Perlin();

    this.#ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.#measure()) : null;
    this.#ro?.observe(this.#host);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.#measure, { passive: true });
    }

    this.#bindPointer();
    this.#bindReducedMotion();
    this.#measure();
    this.#start();
  }

  /** 当前是否在跑（false = 停在静态波纹）。 */
  get enabled(): boolean {
    return this.#enabled;
  }

  /** 采样点总数，用于性能评估。 */
  get pointCount(): number {
    return this.#count;
  }

  /** 竖线条数。 */
  get lineCount(): number {
    return this.#lineCount;
  }

  /** 运行时开关。关闭后画面静止在静态波纹，rAF 完全停掉。 */
  setEnabled(on: boolean): void {
    const next = Boolean(on);
    if (next === this.#enabled) return;
    this.#enabled = next;
    this.#start();
  }

  /** 改参数并重建（例如在大屏上降低密度）。 */
  setOptions(patch: WaveFieldPatch): void {
    this.#opts = { ...this.#opts, ...patch };
    // 参数变了必须重建，别让尺寸缓存挡掉
    this.#lastW = 0;
    this.#lastH = 0;
    this.#measure();
    if (!this.#isAnimating()) this.#drawStatic();
  }

  /** 拆干净：停帧、解绑事件、清空 svg。 */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#ro?.disconnect();
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.#measure);
    }
    const target = this.#opts.pointerTarget ?? (typeof window !== "undefined" ? window : null);
    if (this.#onPointerMove) {
      target?.removeEventListener?.("pointermove", this.#onPointerMove as EventListener);
    }
    if (this.#onMqChange) this.#mq?.removeEventListener?.("change", this.#onMqChange);
    for (const p of this.#paths) p.remove();
    this.#paths = [];
    this.#parts = [];
  }

  // —— 内部 ——

  #prefersReduced(): boolean {
    if (!this.#opts.respectReducedMotion) return false;
    return this.#mq?.matches === true || document.documentElement?.dataset?.reduceMotion === "1";
  }

  #isAnimating(): boolean {
    return this.#enabled && !this.#prefersReduced() && !this.#destroyed;
  }

  #bindReducedMotion(): void {
    this.#mq = reduceQuery();
    this.#onMqChange = () => this.#start();
    this.#mq?.addEventListener?.("change", this.#onMqChange);
  }

  #bindPointer(): void {
    const target = this.#opts.pointerTarget ?? (typeof window !== "undefined" ? window : null);
    if (!target || !target.addEventListener) return;

    // 用 clientX/clientY 再减容器 rect：原版用 pageX/pageY，页面一滚动就会错位
    this.#onPointerMove = (e: PointerEvent) => {
      const r = this.#host.getBoundingClientRect();
      this.#p.x = e.clientX - r.left;
      this.#p.y = e.clientY - r.top;
      if (!this.#p.init) {
        this.#p.init = true;
        this.#p.sx = this.#p.x;
        this.#p.sy = this.#p.y;
        this.#p.lx = this.#p.x;
        this.#p.ly = this.#p.y;
      }
    };
    target.addEventListener("pointermove", this.#onPointerMove as EventListener, { passive: true });
  }

  #measure = (): void => {
    if (this.#destroyed) return;
    const rect = this.#host.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!w || !h) return; // 容器还没布局，等下一次 ResizeObserver
    if (w === this.#lastW && h === this.#lastH && this.#count) return; // 尺寸没变，别重建
    this.#lastW = w;
    this.#lastH = h;
    this.#svg.style.width = `${w}px`;
    this.#svg.style.height = `${h}px`;

    const grid = computeGrid(w, h, this.#opts);
    const n = grid.baseX.length;
    this.#lineCount = grid.lineCount;
    this.#pointsPerLine = grid.pointsPerLine;
    this.#count = n;
    this.#baseX = grid.baseX;
    this.#baseY = grid.baseY;
    this.#waveX = new Float32Array(n);
    this.#waveY = new Float32Array(n);
    this.#offX = new Float32Array(n);
    this.#offY = new Float32Array(n);
    this.#velX = new Float32Array(n);
    this.#velY = new Float32Array(n);

    this.#buildPaths();
    if (!this.#isAnimating()) this.#drawStatic();
  };

  #buildPaths(): void {
    for (const p of this.#paths) p.remove();
    this.#paths = [];
    const wanted = this.#opts.mergePaths ? 1 : this.#lineCount;
    for (let i = 0; i < wanted; i++) {
      const path = document.createElementNS(SVG_NS, "path");
      this.#svg.appendChild(path);
      this.#paths.push(path);
    }
  }

  #start(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (this.#destroyed) return;
    if (!this.#isAnimating()) {
      this.#drawStatic();
      return;
    }
    const tick = (ts: number) => {
      this.#raf = requestAnimationFrame(tick);
      this.#step(ts);
      this.#paint();
    };
    this.#raf = requestAnimationFrame(tick);
  }

  /** 推进一帧物理（不做 DOM 写入）。 */
  #step(ts: number): void {
    const o = this.#opts;
    const p = this.#p;
    // 指针平滑跟随 + 速度估计
    p.sx += (p.x - p.sx) * o.pointerEase;
    p.sy += (p.y - p.sy) * o.pointerEase;
    const dx = p.x - p.lx;
    const dy = p.y - p.ly;
    const speed = Math.hypot(dx, dy);
    p.v = speed;
    p.vs += (speed - p.vs) * 0.1;
    if (p.vs > 100) p.vs = 100;
    p.lx = p.x;
    p.ly = p.y;
    p.a = Math.atan2(dy, dx);

    const {
      amplitudeX, amplitudeY, angleScale, noiseScaleX, noiseScaleY,
      timeScaleX, timeScaleY, pointerRadius, pointerStrength,
      pointerMaxOffset, pointerDamping,
    } = o;
    const perlin = this.#perlin;
    const cosA = Math.cos(p.a);
    const sinA = Math.sin(p.a);
    const radius = Math.max(pointerRadius, p.vs);
    const forceScale = radius * p.vs * pointerStrength;

    for (let i = 0; i < this.#count; i++) {
      const bx = this.#baseX[i];
      const by = this.#baseY[i];

      // 时间推进量必须走 timeScale，否则设置里的「流动速度」滑杆完全无效。
      // 系数参考原实现写死的 (ts * 0.0125) / (ts * 0.005)：
      // 0.0125 = timeScaleX(0.0025) × 5，0.005 = timeScaleY(0.00075) × 6.666…
      const n =
        perlin.noise2(
          (bx + ts * timeScaleX * 5) * noiseScaleX,
          (by + ts * timeScaleY * 6.6667) * noiseScaleY
        ) * angleScale;
      this.#waveX[i] = Math.cos(n) * amplitudeX;
      this.#waveY[i] = Math.sin(n) * amplitudeY;

      const ddx = bx - p.sx;
      const ddy = by - p.sy;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        // 距离越远越"软"，避免整体被平移
        const curl = Math.cos(dist * 0.001);
        const force = falloff * curl * forceScale;
        this.#velX[i] += cosA * force;
        this.#velY[i] += sinA * force;
      }
      this.#velX[i] += -this.#offX[i] * 0.005;
      this.#velY[i] += -this.#offY[i] * 0.005;
      this.#velX[i] *= pointerDamping;
      this.#velY[i] *= pointerDamping;
      let ox = this.#offX[i] + this.#velX[i] * 2;
      let oy = this.#offY[i] + this.#velY[i] * 2;
      if (ox > pointerMaxOffset) ox = pointerMaxOffset;
      else if (ox < -pointerMaxOffset) ox = -pointerMaxOffset;
      if (oy > pointerMaxOffset) oy = pointerMaxOffset;
      else if (oy < -pointerMaxOffset) oy = -pointerMaxOffset;
      this.#offX[i] = ox;
      this.#offY[i] = oy;
    }
  }

  /** 时间冻结时用：只算噪声，不含指针扰动。 */
  #drawStatic(): void {
    const o = this.#opts;
    for (let i = 0; i < this.#count; i++) {
      const n =
        this.#perlin.noise2(this.#baseX[i] * o.noiseScaleX, this.#baseY[i] * o.noiseScaleY) *
        o.angleScale;
      this.#waveX[i] = Math.cos(n) * o.amplitudeX;
      this.#waveY[i] = Math.sin(n) * o.amplitudeY;
      this.#offX[i] = 0;
      this.#offY[i] = 0;
      this.#velX[i] = 0;
      this.#velY[i] = 0;
    }
    this.#paint();
  }

  /** 把点写成 path 的 d。合并模式下一帧只写一次属性。 */
  #paint(): void {
    const rows = this.#pointsPerLine;
    const tailIndex = rows - 1;
    const parts = this.#parts;
    parts.length = 0;

    if (this.#opts.mergePaths) {
      const path = this.#paths[0];
      if (!path) return;
      for (let c = 0; c < this.#lineCount; c++) {
        const base = c * rows;
        for (let r = 0; r < rows; r++) {
          const i = base + r;
          const x = Math.round((this.#baseX[i] + this.#waveX[i]) * 10) / 10;
          // 每条线的最后一个点不吃指针位移：不然线头会被扯出尖角
          const y =
            r === tailIndex
              ? Math.round((this.#baseY[i] + this.#waveY[i]) * 10) / 10
              : Math.round((this.#baseY[i] + this.#waveY[i] + this.#offY[i]) * 10) / 10;
          const xx =
            r === tailIndex
              ? x
              : Math.round((this.#baseX[i] + this.#waveX[i] + this.#offX[i]) * 10) / 10;
          parts.push(r === 0 ? `M${xx} ${y}` : `L${xx} ${y}`);
        }
      }
      path.setAttribute("d", parts.join(""));
      return;
    }

    // 一条线一个 path
    for (let c = 0; c < this.#lineCount; c++) {
      const path = this.#paths[c];
      if (!path) continue;
      parts.length = 0;
      const base = c * rows;
      for (let r = 0; r < rows; r++) {
        const i = base + r;
        const tail = r === tailIndex;
        const xx = Math.round((this.#baseX[i] + this.#waveX[i] + (tail ? 0 : this.#offX[i])) * 10) / 10;
        const yy = Math.round((this.#baseY[i] + this.#waveY[i] + (tail ? 0 : this.#offY[i])) * 10) / 10;
        parts.push(r === 0 ? `M${xx} ${yy}` : `L${xx} ${yy}`);
      }
      path.setAttribute("d", parts.join(""));
    }
  }
}

export default WaveField;
