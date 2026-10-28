// 模块表面容器：按主题配置渲染 背景图（含雾化模糊）/ 纯色覆盖 / 文字色。
// 分层：背景图层（filter: blur 模糊图片本身）→ frost 遮罩层（可读性兜底）→ 内容层。
// 设计要点：
// - 模块纯色通过覆盖 --qj-surface/--qj-bg 变量实现（子面板样式引用变量自动跟随）
// - 背景图模式给容器挂 data-has-image，CSS 让直接子面板背景透明以透出图片
// 用法：<ModuleSurface module="sidebar">…</ModuleSurface>
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useThemeStore } from "../../stores/useThemeStore";
import { autoTextColor, contrastRatio, dominantColor, hexToRgba } from "../../lib/contrast";
import { absToDataUri } from "../../lib/dataUri";
import { assetSrcToAbs } from "../../lib/paths";
import "./module-surface.css";

export interface ModuleSurfaceProps {
  /** 模块名（sidebar/noteList/tabs/editor/fragment/settings 等） */
  module: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Windows 路径反斜杠在 CSS 字符串中是转义符，需加倍 */
function cssEscape(url: string): string {
  return url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function ModuleSurface({ module, className, style, children }: ModuleSurfaceProps) {
  const config = useThemeStore((s) => s.config);
  // 设置窗口预览态优先（改配置实时预览）
  const preview = useThemeStore((s) => s.preview);
  const cfg = preview ?? config;

  const m = cfg?.modules[module];
  const [sampled, setSampled] = useState<string | null>(null);

  // 背景图存在且无纯色覆盖时采样主色（自动文字色用）
  const imageSrc = m?.backgroundImage ?? null;
  const solidColor = m?.solidColor ?? null;

  // 背景图 URL 解析：data URI 直用；旧版 asset:// 形式先还原为绝对路径；
  // 绝对路径 → data URI（asset 协议在 dev 下不可靠，统一走数据 URI 通道）
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageSrc) {
      setBgImageUrl(null);
      return;
    }
    let alive = true;
    const resolve = async (): Promise<string | null> => {
      if (imageSrc.startsWith("data:")) return imageSrc;
      if (imageSrc.startsWith("http") && !imageSrc.includes("asset.localhost")) return imageSrc;
      const abs = assetSrcToAbs(imageSrc) ?? imageSrc; // 旧 asset:// 形式还原；否则按绝对路径处理
      return absToDataUri(abs);
    };
    void resolve()
      .then((u) => {
        if (alive) setBgImageUrl(u);
      })
      .catch((e) => {
        console.error("背景图加载失败", e);
        if (alive) setBgImageUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [imageSrc]);

  const displayImage = bgImageUrl ?? (imageSrc?.startsWith("data:") ? imageSrc : null);

  useEffect(() => {
    if (!displayImage || solidColor || !cfg) {
      setSampled(null);
      return;
    }
    let alive = true;
    void dominantColor(displayImage).then((c) => {
      if (alive) setSampled(c);
    });
    return () => {
      alive = false;
    };
  }, [displayImage, solidColor, cfg]);

  const { vars, hasImage } = useMemo(() => {
    const out: Record<string, string> = {};
    if (!cfg || !m) return { vars: out, hasImage: false };

    // 模块底色：纯色覆盖优先，否则主题 surface/bg（子面板通过变量继承）
    out["--qj-surface"] = solidColor ?? cfg.tokens.color.surface;
    out["--qj-bg"] = solidColor ?? cfg.tokens.color.bg;

    const hasImage = !solidColor && !!displayImage;
    if (hasImage) {
      out["--qj-m-bg-image"] = `url("${cssEscape(displayImage)}")`;
      out["--qj-m-bg-fit"] = m.backgroundFit ?? "cover";
      out["--qj-m-blur"] = `${m.blur ?? 0}px`;
      // 外扩仅在有雾化时（隐藏 blur 边缘）；无雾化时外扩会让图片被放大裁切
      out["--qj-m-bg-inset"] = (m.blur ?? 0) > 0 ? "-16px" : "0px";
      out["--qj-m-bg-repeat"] = m.backgroundFit === "repeat" ? "repeat" : "no-repeat";
    }

    // 文字色：手动优先 → 自动对比度（纯色直接算；图片用采样主色；无背景用主题 surface）
    const bgForContrast = solidColor ?? sampled ?? cfg.tokens.color.surface;
    if (m.textColor) {
      out["--qj-m-text"] = m.textColor;
      out["--qj-m-ratio"] = String(contrastRatio(bgForContrast, m.textColor) ?? 0);
    } else {
      const auto = autoTextColor(bgForContrast, cfg.tokens.color.text, cfg.base);
      out["--qj-m-text"] = auto.color;
      out["--qj-m-ratio"] = String(auto.ratio);
      // 图片背景且对比度不足 → frost 遮罩兜底
      if (hasImage && auto.ratio < 4.5) {
        out["--qj-m-frost"] = cfg.base === "light" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
      }
    }
    return { vars: out, hasImage };
  }, [cfg, m, solidColor, displayImage, sampled]);

  if (!cfg || !m) {
    return (
      <div className={`qj-module ${className ?? ""}`} style={style}>
        {children}
      </div>
    );
  }

  // 全窗口背景图开启 → 所有模块一律毛玻璃（模块自有图/纯色均让位给全局壁纸）
  const windowImageOn = !!cfg?.window.backgroundImage;
  const frosted = windowImageOn;
  const frostedBg = frosted
    ? hexToRgba(solidColor ?? cfg.tokens.color.surface, 0.6)
    : undefined;

  // v2「纸页」：模块没有自定义背景（无纯色、无背景图、非毛玻璃）时不写内联背景，
  // 让 CSS 的纸页色阶（.qj-sidebar/.qj-note-list/.qj-tabs-root）生效。
  // 之前无条件写 tokens.color.surface，导致三栏被同一块白色盖平，叠层完全消失。
  const useThemeSurface = frosted || !!solidColor || hasImage;

  return (
    <div
      className={`qj-module ${className ?? ""}${frosted ? " qj-module-frosted" : ""}`}
      data-has-image={!frosted && hasImage ? "true" : undefined}
      style={{
        ...style,
        // solidColor 覆盖为纯色；背景图透明（图层接管）；否则交给 CSS 纸页色阶；
        // 毛玻璃模式下背景为对应色的 60% 半透明（壁纸清晰可见）
        ...(useThemeSurface
          ? frostedBg
            ? { background: frostedBg }
            : solidColor
              ? { background: solidColor }
              : { background: "transparent" }
          : {}),
        ...(vars as CSSProperties),
      }}
    >
      {!frosted && hasImage && <div className="qj-module-bg" aria-hidden="true" />}
      <div className="qj-module-content">{children}</div>
    </div>
  );
}
