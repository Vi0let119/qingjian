// 主题状态：全局配置 + 设置窗口的未应用预览态。
import { create } from "zustand";
import { api, type ThemeConfig } from "../lib/api";

interface ThemeStore {
  /** 当前生效主题（全窗口同步，Rust 广播更新） */
  config: ThemeConfig | null;
  setConfig: (c: ThemeConfig) => void;

  /** 设置窗口预览态（未点应用前的草稿） */
  preview: ThemeConfig | null;
  startPreview: () => void;
  updatePreview: (updater: (cfg: ThemeConfig) => ThemeConfig) => void;
  cancelPreview: () => void;

  applyPreview: () => Promise<void>;
  resetTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  config: null,
  setConfig: (c) => set({ config: c, preview: null }),

  preview: null,
  startPreview: () => {
    const { config } = get();
    if (config) set({ preview: structuredClone(config) });
  },
  updatePreview: (updater) => {
    // 兜底：preview 尚未建立（如 config 加载完成前用户已操作）时从 config 克隆起步，
    // 否则所有更新被静默丢弃、控件表现为"点了没反应"
    const { preview, config } = get();
    const base = preview ?? config;
    if (base) set({ preview: updater(structuredClone(base)) });
  },
  cancelPreview: () => set({ preview: null }),

  applyPreview: async () => {
    const { preview } = get();
    if (!preview) return;
    await api.themeApply(preview);
  },

  resetTheme: async () => {
    await api.themeReset();
  },
}));
