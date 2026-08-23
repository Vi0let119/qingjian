// 主题注入层：把 tokens 写入 :root CSS 变量，并订阅 Rust 的 theme://changed 广播
// （设置窗口点"应用"后，所有窗口 200ms 内即时换肤）。
import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type ThemeConfig } from "../../lib/api";
import { useThemeStore } from "../../stores/useThemeStore";
import { mixHex } from "../../lib/contrast";
import { absToDataUri } from "../../lib/dataUri";

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

  // 写入 :root 变量
  useEffect(() => {
    if (!cfg) return;
    const root = document.documentElement;
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
    document.body.style.fontSize = cfg.tokens.font.size;
  }, [cfg]);

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
