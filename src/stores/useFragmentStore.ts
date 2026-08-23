// 碎片模块状态：碎片窗口会话 + 主窗口"每日碎片"浏览视图。
import { create } from "zustand";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect, EffectState } from "@tauri-apps/api/window";
import { nowHM } from "../lib/dates";
import { useThemeStore } from "./useThemeStore";

interface FragmentStore {
  /** 当前碎片窗口的 section id（碎片窗口内使用） */
  sectionId: string | null;
  setSectionId: (id: string | null) => void;

  /** 主窗口：每日碎片浏览器开关 */
  dailyBrowserOpen: boolean;
  openDailyBrowser: () => void;
  closeDailyBrowser: () => void;
  /** 切换（侧栏按钮用：进入/返回） */
  toggleDailyBrowser: () => void;

  error: string | null;

  /** 新建碎片窗口（可多开；重复点击各开一个） */
  newFragment: () => Promise<void>;
}

export const useFragmentStore = create<FragmentStore>((set) => ({
  sectionId: null,
  setSectionId: (id) => set({ sectionId: id }),

  dailyBrowserOpen: false,
  openDailyBrowser: () => set({ dailyBrowserOpen: true }),
  closeDailyBrowser: () => set({ dailyBrowserOpen: false }),
  toggleDailyBrowser: () => set((s) => ({ dailyBrowserOpen: !s.dailyBrowserOpen })),

  error: null,

  newFragment: async () => {
    try {
      // 按当前主题的窗口效果创建（transparent 是效果可见前提）
      const effect = useThemeStore.getState().config?.window.effect ?? "none";
      const options: ConstructorParameters<typeof WebviewWindow>[1] = {
        url: "fragment.html",
        title: `碎片 · ${nowHM()}`,
        width: 380,
        height: 320,
        minWidth: 300,
        minHeight: 200,
        transparent: effect !== "none",
      };
      if (effect === "mica" || effect === "acrylic") {
        options.windowEffects = {
          effects: [effect === "mica" ? Effect.Mica : Effect.Acrylic],
          state: EffectState.Active,
        };
      }
      // label 唯一，多开不冲突；capabilities 已声明 fragment-*
      const win = new WebviewWindow(`fragment-${crypto.randomUUID()}`, options);
      // 等待窗口创建完成，失败（如被权限拒绝）则报错
      await new Promise<void>((resolve, reject) => {
        void win.once("tauri://created", () => resolve());
        void win.once("tauri://error", (e) => reject(new Error(String(e))));
      });
      set({ error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
