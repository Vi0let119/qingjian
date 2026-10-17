// 编辑器视图缩放（Ctrl+滚轮 / Ctrl+0 复位）：只影响查看，不改变文档与主题的实际字号。
// 每个窗口独立一份（窗口即独立 JS 上下文），同一窗口内切标签共享不重置。
import { create } from "zustand";

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

/** 限制在 [ZOOM_MIN, ZOOM_MAX] 并抹平浮点误差（保留两位小数） */
export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

interface EditorZoomStore {
  /** 视图缩放倍率（1 = 实际大小） */
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export const useEditorZoomStore = create<EditorZoomStore>((set) => ({
  zoom: 1,
  zoomIn: () => set((s) => ({ zoom: clampZoom(s.zoom + ZOOM_STEP) })),
  zoomOut: () => set((s) => ({ zoom: clampZoom(s.zoom - ZOOM_STEP) })),
  reset: () => set({ zoom: 1 }),
}));
