// 主题注入层：把 tokens 写入 :root CSS 变量，并订阅 Rust 的 theme://changed 广播
// （设置窗口点"应用"后，所有窗口 200ms 内即时换肤）。
import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type AppSettings, type ThemeConfig } from "../../lib/api";
import { useThemeStore } from "../../stores/useThemeStore";
import { mixHex } from "../../lib/contrast";
import { absToDataUri } from "../../lib/dataUri";
import { bodyFontSize } from "../../lib/fontScale";
import { bubblePalette } from "../../lib/themePalette";

/** tokens → CSS 变量映射 */
const TOKEN_VARS: Record<string, (c: ThemeConfig) => string> = {
  "--qj-primary": (c) => c.tokens.color.primary,
  "--qj-primary-soft": (c) => hexToSoft(c.tokens.color.primary),
  "--qj-accent": (c) => c.tokens.color.accent,
  "--qj-danger": (c) => c.tokens.color.danger,
  "--qj-bg": (c) => c.tokens.color.bg,
  "--qj-surface": (c) => c.tokens.color.surface,
  "--qj-text": (c) => c.tokens.color.text,
  "--qj-text-secondary": (c) => c.tokens.color.textSecondary,
  "--qj-border": (c) => c.tokens.color.border,
  "--qj-font-family": (c) => c.tokens.font.family,
  "--qj-font-size": (c) => c.tokens.font.size,
  "--qj-radius": (c) => c.tokens.radius,
  "--qj-shadow": (c) => c.tokens.shadow,
  // 窗口底色：从主题 tokens 推导的柔和渐变（bg → 主色微染 → 表面色 → bg），
  // 主题切换时全窗口即时重绘，保证和谐
  "--qj-window-gradient": (c) => {
    const { bg, surface, primary } = c.tokens.color;
    const tint1 = mixHex(bg, primary, 0.07);
    const tint2 = mixHex(bg, surface, 0.55);
    return `linear-gradient(168deg, ${bg} 0%, ${tint1} 34%, ${tint2} 70%, ${bg} 100%)`;
  },

  // ---------- v3：纸页色阶改为从主题推导（原先写死浅色，换深色主题就"花"）----------
  // 叠放顺序：桌面(最暗) → 书写纸 → 列表 → 侧栏(最亮)；深色主题反转为越上层略亮。
  "--qj-desk": (c) => bubblePalette(c).desk,
  "--qj-paper-0": (c) => {
    const { bg, primary } = c.tokens.color;
    return mixHex(bg, primary, c.base === "dark" ? 0.05 : 0.015);
  },
  "--qj-paper-1": (c) => {
    const { bg, surface } = c.tokens.color;
    return mixHex(bg, surface, c.base === "dark" ? 0.5 : 0.45);
  },
  "--qj-paper-2": (c) => c.tokens.color.surface,

  // ---------- v3：墨色阶也从主题推导 ----------
  // 原来 ink-100..900 是写死的灰绿阶；深色主题下必须反转，否则文字浮在错误的明度上。
  "--qj-ink-100": (c) => mixHex(c.tokens.color.bg, c.tokens.color.text, 0.06),
  "--qj-ink-200": (c) => mixHex(c.tokens.color.bg, c.tokens.color.text, 0.12),
  "--qj-ink-300": (c) => mixHex(c.tokens.color.bg, c.tokens.color.text, 0.22),
  "--qj-ink-400": (c) => mixHex(c.tokens.color.bg, c.tokens.color.text, c.base === "dark" ? 0.34 : 0.42),
  "--qj-ink-500": (c) => mixHex(c.tokens.color.bg, c.tokens.color.text, 0.55),
  "--qj-ink-600": (c) => c.tokens.color.textSecondary,
  "--qj-ink-700": (c) => mixHex(c.tokens.color.textSecondary, c.tokens.color.text, 0.45),
  "--qj-ink-800": (c) => mixHex(c.tokens.color.textSecondary, c.tokens.color.text, 0.8),
  "--qj-ink-900": (c) => c.tokens.color.text,

  // ---------- v3：气泡视图色板 ----------
  "--qj-glow-rgb": (c) => bubblePalette(c).glow,
  "--qj-bubble": (c) => bubblePalette(c).bubble,
  "--qj-bubble-edge": (c) => bubblePalette(c).bubbleEdge,
  "--qj-ripple": (c) => bubblePalette(c).ripple,
  "--qj-canvas-ink": (c) => bubblePalette(c).ink,
  "--qj-canvas-ink-dim": (c) => bubblePalette(c).inkDim,
};

/** #rrggbb → 12% 透明度 rgba（激活底等淡色） */
function hexToSoft(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "rgba(74,124,89,0.12)";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},0.12)`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const config = useThemeStore((s) => s.config);
  const setConfig = useThemeStore((s) => s.setConfig);
  // 设置窗口预览态优先（与 ModuleSurface 一致：本窗口实时预览，应用后广播全局）
  const preview = useThemeStore((s) => s.preview);
  const cfg = preview ?? config;

  // 全窗口背景图：绝对路径 → data URI（复用图片通道），渲染为最底层背景
  const [windowBgUrl, setWindowBgUrl] = useState<string | null>(null);
  const windowImage = cfg?.window.backgroundImage ?? null;
  useEffect(() => {
    if (!windowImage) {
      setWindowBgUrl(null);
      return;
    }
    if (windowImage.startsWith("data:")) {
      setWindowBgUrl(windowImage);
      return;
    }
    let alive = true;
    absToDataUri(windowImage)
      .then((u) => {
        if (alive) setWindowBgUrl(u);
      })
      .catch((e) => {
        console.error("窗口背景图加载失败", e);
        if (alive) setWindowBgUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [windowImage]);

  // 初始加载 + 订阅广播
  useEffect(() => {
    let disposed = false;
    void api.themeGet().then((c) => {
      if (!disposed) setConfig(c);
    });
    let unlisten: (() => void) | null = null;
    void listen<ThemeConfig>("theme://changed", (e) => {
      setConfig(e.payload);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setConfig]);

  // 界面字体缩放（通用设置）：写入基准字号变量，各窗口加载时读取，
  // 设置窗口改动后经 settings://changed 广播即时同步。
  // 坑：不能用 documentElement.style.zoom——元素坐标系会随之改变，
  // WebView2 计算 IME 候选窗位置时拿不到缩放映射，中文输入法候选框会跑到窗口左上角。
  // 改为 font-size 基准变量 + rem/em 布局，文字真正放大且不移动任何坐标系。
  const [fontScale, setFontScale] = useState(1);
  useEffect(() => {
    let disposed = false;
    void api
      .settingsGet()
      .then((s) => {
        if (!disposed) setFontScale(s.uiFontScale ?? 1);
      })
      .catch(() => {});
    let unlisten: (() => void) | null = null;
    void listen<AppSettings>("settings://changed", (e) => {
      setFontScale(e.payload.uiFontScale ?? 1);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    // 只设基准字号，不设 zoom。html 字号 = 14px × scale，正文用 rem 继承。
    document.documentElement.style.fontSize = `${14 * fontScale}px`;
    document.documentElement.style.setProperty("--qj-font-scale", String(fontScale));
  }, [fontScale]);

  // 写入 :root 变量
  useEffect(() => {
    if (!cfg) return;
    const root = document.documentElement;
    // 供 Canvas 等非 CSS 渲染层判断明暗（涟漪高光强度、阴影方向）
    root.dataset.base = cfg.base;
    for (const [varName, getter] of Object.entries(TOKEN_VARS)) {
      root.style.setProperty(varName, getter(cfg));
    }
    // 窗口级效果（Mica/亚克力）要求 webview 背景透明才可见；
    // 无效果时回退主题渐变色（系统关闭透明效果等场景）
    document.body.style.background =
      cfg.window.effect !== "none" ? "transparent" : "var(--qj-bg)";
    document.body.style.backgroundImage =
      cfg.window.effect !== "none" ? "" : "var(--qj-window-gradient)";
    document.body.style.fontFamily = cfg.tokens.font.family;
    document.body.style.fontSize = bodyFontSize(cfg.tokens.font.size, fontScale);
  }, [cfg, fontScale]);

  // 全窗口背景图开启标记（body class 驱动模块毛玻璃与面板层级）
  const hasWindowImage = !!windowBgUrl;
  useEffect(() => {
    document.body.classList.toggle("qj-window-image-on", hasWindowImage);
    return () => document.body.classList.remove("qj-window-image-on");
  }, [hasWindowImage]);

  const winFit = cfg?.window.backgroundFit ?? "cover";
  const winBlur = cfg?.window.blur ?? 0;

  return (
    <>
      {hasWindowImage && (
        <div
          className="qj-window-backdrop"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${windowBgUrl}")`,
            backgroundSize: winFit === "repeat" ? undefined : winFit,
            backgroundRepeat: winFit === "repeat" ? "repeat" : "no-repeat",
            filter: winBlur > 0 ? `blur(${winBlur}px)` : undefined,
          }}
        />
      )}
      {children}
    </>
  );
}
