// 气泡背景波纹设置：全局共享（气泡画布读、设置窗口写）。
//
// 落盘走 Rust 的 AppSettings（settings_set 广播 settings://changed），
// 这样主窗口/碎片窗口即时同步，且不必给每个窗口各自维护一份 localStorage。
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { normalizeWaveSettings, type WaveSettings, WAVE_DEFAULTS } from "../lib/waveSettings";
import { api, type AppSettings } from "../lib/api";

interface WaveSettingsStore {
  settings: WaveSettings;
  /** 是否已从后端载入过（未载完时先用默认值渲染，避免闪错） */
  loaded: boolean;
  /** 从后端拉取一次，并挂上广播监听（幂等：重复调用只有一个监听） */
  init: () => Promise<void>;
  /** 本地即时改（滑杆拖动过程，不落盘） */
  setLocal: (patch: Partial<WaveSettings>) => void;
  /** 落盘（防抖由调用方控制） */
  persist: (patch: Partial<WaveSettings>) => Promise<void>;
}

/**
 * 广播监听只挂一次。
 *
 * 坑（本实现第一版踩过）：只在 store 里定义了 apply() 却没真正 listen，
 * 结果设置窗口改了参数、主窗口毫无反应——竖线数量纹丝不动，
 * 只有噪声相位在变（看起来"好像动了"，极难察觉）。
 */
let unlistenPromise: Promise<(() => void) | null> | null = null;

export const useWaveSettings = create<WaveSettingsStore>((set) => ({
  settings: { ...WAVE_DEFAULTS },
  loaded: false,

  init: async () => {
    // 1) 先挂广播（后续任何改动都能收到）
    if (!unlistenPromise) {
      unlistenPromise = listen<AppSettings>("settings://changed", (e) => {
        set({ settings: normalizeWaveSettings(e.payload.bubbleWave), loaded: true });
      }).catch(() => null);
    }
    // 2) 再拉一次当前值（覆盖首次渲染的默认值）
    try {
      const s = await api.settingsGet();
      set({ settings: normalizeWaveSettings(s.bubbleWave), loaded: true });
    } catch {
      // 读取失败就用默认值，不阻塞渲染
      set({ settings: { ...WAVE_DEFAULTS }, loaded: true });
    }
  },

  setLocal: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  persist: async (patch) => {
    await api.settingsSet({ bubbleWave: patch });
  },
}));
