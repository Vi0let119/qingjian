// 气泡视图的层级状态（笔记本层 / 笔记层）。
//
// 为什么放在 store 而不是 BubbleWorkspace 的 useState：
// 点开笔记进入书写视图时 BubbleWorkspace 会被卸载（MainWindow 里两个 return 分支
// 互斥），组件本地 state 随之丢失。返回时重新挂载就退回初始层——
// 用户从「随笔 → 烟花」里退出，却回到了全部笔记本。
// 层级属于"导航位置"，生命周期应长于单个视图，所以提升到 store。
import { create } from "zustand";

export type BubbleLayer = { kind: "notebooks" } | { kind: "notes"; notebook: string };

interface BubbleLayerStore {
  layer: BubbleLayer;
  /** 进入某笔记本 */
  openNotes: (notebook: string) => void;
  /** 回到笔记本层 */
  back: () => void;
  /** 重置（例如切换 workspace 模式时） */
  reset: () => void;
}

export const useBubbleLayer = create<BubbleLayerStore>((set) => ({
  layer: { kind: "notebooks" },
  openNotes: (notebook) => set({ layer: { kind: "notes", notebook } }),
  back: () => set({ layer: { kind: "notebooks" } }),
  reset: () => set({ layer: { kind: "notebooks" } }),
}));
