// 主窗口视图模式：气泡视图 / 列表视图。
// 默认气泡（用户选定：进入笔记模块默认是气泡，可切换回列表），选择记在 localStorage。
import { create } from "zustand";

export type WsMode = "bubble" | "list";

const KEY = "qj-ws-mode";

function initial(): WsMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "list" || v === "bubble") return v;
  } catch {
    /* localStorage 不可用时退回默认 */
  }
  return "bubble";
}

interface WsModeStore {
  mode: WsMode;
  setMode: (m: WsMode) => void;
  toggle: () => void;
}

export const useWsMode = create<WsModeStore>((set, get) => ({
  mode: initial(),
  setMode: (m) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* 忽略 */
    }
    set({ mode: m });
  },
  toggle: () => get().setMode(get().mode === "bubble" ? "list" : "bubble"),
}));

/** 兼容命名导出（组件里按 store 常量引用） */
export const wsModeStore = useWsMode;

