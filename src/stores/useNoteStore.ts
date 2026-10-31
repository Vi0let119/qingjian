// 主窗口状态：笔记本/笔记列表/打开标签页（内容本体由编辑器组件管理，store 只存元数据）。
import { create } from "zustand";
import { api, type NotebookInfo, type NoteMeta } from "../lib/api";

export interface NoteTab {
  /** `${notebook}/${fileName}` */
  id: string;
  notebook: string;
  fileName: string;
  title: string;
}

interface NoteStore {
  notebooks: NotebookInfo[];
  notes: NoteMeta[];
  /** 当前选中的笔记本 */
  activeNotebook: string | null;
  openTabs: NoteTab[];
  activeTabId: string | null;
  /** 打开标签的 flush 注册表（切标签/关标签时强制落盘） */
  flushRegistry: Map<string, () => void>;
  error: string | null;
  /** 检索跳转请求：打开笔记后由编辑器在文档内按 query 查找定位 */
  pendingReveal: { notebook: string; fileName: string; query: string } | null;
  setPendingReveal: (r: { notebook: string; fileName: string; query: string } | null) => void;

  /** 侧栏树：笔记本名 → 该本下的笔记（展开时才加载） */
  notesByNotebook: Record<string, NoteMeta[]>;
  /** 已展开的笔记本（侧栏树用） */
  expandedNotebooks: string[];
  toggleNotebookExpanded: (name: string) => Promise<void>;
  loadNotebookNotes: (name: string) => Promise<void>;

  init: () => Promise<void>;
  selectNotebook: (name: string) => Promise<void>;
  createNotebook: (name: string) => Promise<void>;
  renameNotebook: (oldName: string, newName: string) => Promise<void>;
  deleteNotebook: (name: string) => Promise<void>;

  /** 在 activeNotebook 中新建笔记并打开 */
  createNote: () => Promise<void>;
  /** 在指定笔记本中新建笔记并打开（侧栏"在此新建"用） */
  createNoteIn: (notebook: string) => Promise<void>;
  /** 打开笔记为标签（已开则聚焦） */
  openNote: (notebook: string, fileName: string) => void;
  closeTab: (tabId: string) => void;
  activateTab: (tabId: string) => void;
  renameNote: (tabId: string, newTitle: string) => Promise<void>;
  deleteNote: (tabId: string) => Promise<void>;
  /** 列表级重命名（笔记未打开时） */
  renameNoteInList: (fileName: string, newTitle: string) => Promise<void>;
  /** 列表级删除（笔记未打开时） */
  deleteNoteInList: (fileName: string) => Promise<void>;
  registerFlush: (tabId: string, flush: () => void) => void;
}

function tabIdOf(notebook: string, fileName: string): string {
  return `${notebook}/${fileName}`;
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  notebooks: [],
  notes: [],
  activeNotebook: null,
  openTabs: [],
  activeTabId: null,
  flushRegistry: new Map(),
  error: null,
  pendingReveal: null,
  setPendingReveal: (r) => set({ pendingReveal: r }),
  notesByNotebook: {},
  expandedNotebooks: [],

  /** 侧栏树展开/收起：展开时按需加载该本的笔记 */
  toggleNotebookExpanded: async (name) => {
    const { expandedNotebooks } = get();
    if (expandedNotebooks.includes(name)) {
      set({ expandedNotebooks: expandedNotebooks.filter((n) => n !== name) });
      return;
    }
    set({ expandedNotebooks: [...expandedNotebooks, name] });
    await get().loadNotebookNotes(name);
  },

  /** 拉取某个本的笔记列表并写进树缓存（展开 / 增删改后都用它刷新） */
  loadNotebookNotes: async (name) => {
    try {
      const notes = await api.listNotes(name);
      // 写缓存时再次读 get()：等待期间可能已有别的本的列表写进来，
      // 用展开时捕获的旧快照合并会把它们抹掉
      set({ notesByNotebook: { ...get().notesByNotebook, [name]: notes } });
      if (get().activeNotebook === name) set({ notes });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  init: async () => {
    try {
      const notebooks = await api.listNotebooks();
      const active = notebooks[0]?.name ?? null;
      set({ notebooks, activeNotebook: active, error: null });
      if (active) await get().selectNotebook(active);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectNotebook: async (name) => {
    set({ activeNotebook: name });
    // 统一走 loadNotebookNotes：它同时更新平铺 notes 和侧栏树缓存，
    // 避免两处各自拉一遍列表后互相覆盖
    await get().loadNotebookNotes(name);
  },

  createNotebook: async (name) => {
    try {
      await api.createNotebook(name);
      await get().init();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameNotebook: async (oldName, newName) => {
    try {
      await api.renameNotebook(oldName, newName);
      const { notebooks, activeNotebook, openTabs } = get();
      const nextTabs = openTabs.map((t) =>
        t.notebook === oldName ? { ...t, notebook: newName, id: tabIdOf(newName, t.fileName) } : t
      );
      set({
        notebooks: notebooks.map((n) => (n.name === oldName ? { ...n, name: newName } : n)),
        activeNotebook: activeNotebook === oldName ? newName : activeNotebook,
        openTabs: nextTabs,
        error: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteNotebook: async (name) => {
    try {
      await api.deleteNotebook(name);
      const { openTabs } = get();
      const surviving = openTabs.filter((t) => t.notebook !== name);
      set({ openTabs: surviving, activeTabId: surviving[0]?.id ?? null });
      await get().init();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createNote: async () => {
    // 兜底：初始化未完成/无选中笔记本时退回默认笔记本，并记录便于排查
    await get().createNoteIn(get().activeNotebook ?? "inbox");
  },

  createNoteIn: async (notebook) => {
    try {
      const meta = await api.createNote(notebook);
      await get().selectNotebook(notebook);
      // 侧栏树里把所在笔记本展开，否则新建的笔记藏在折叠的本子里看不见
      if (!get().expandedNotebooks.includes(notebook)) {
        set({ expandedNotebooks: [...get().expandedNotebooks, notebook] });
      }
      get().openNote(notebook, meta.fileName);
      set({ error: null });
    } catch (e) {
      console.error("[qj] 新建笔记失败:", e);
      set({ error: String(e) });
    }
  },

  openNote: (notebook, fileName) => {
    const { openTabs } = get();
    const id = tabIdOf(notebook, fileName);
    const existing = openTabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: id });
      return;
    }
    const meta = get().notes.find((n) => n.fileName === fileName);
    const tab: NoteTab = {
      id,
      notebook,
      fileName,
      title: meta?.title ?? fileName.replace(/\.md$/, ""),
    };
    set({ openTabs: [...openTabs, tab], activeTabId: id });
  },

  closeTab: (tabId) => {
    // 关标签前强制落盘
    get().flushRegistry.get(tabId)?.();
    const { openTabs, activeTabId, flushRegistry } = get();
    const next = openTabs.filter((t) => t.id !== tabId);
    flushRegistry.delete(tabId);
    const nextActive = activeTabId === tabId ? (next[next.length - 1]?.id ?? null) : activeTabId;
    set({ openTabs: next, activeTabId: nextActive, flushRegistry });
  },

  activateTab: (tabId) => {
    const { activeTabId, flushRegistry } = get();
    if (activeTabId && activeTabId !== tabId) {
      // 切标签前把上一个标签的挂起保存落盘
      flushRegistry.get(activeTabId)?.();
    }
    set({ activeTabId: tabId });
  },

  renameNote: async (tabId, newTitle) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    try {
      const meta = await api.renameNote(tab.notebook, tab.fileName, newTitle);
      const nextTabs = get().openTabs.map((t) =>
        t.id === tabId
          ? { ...t, fileName: meta.fileName, title: meta.title, id: tabIdOf(tab.notebook, meta.fileName) }
          : t
      );
      set({ openTabs: nextTabs, activeTabId: tabIdOf(tab.notebook, meta.fileName), error: null });
      await get().selectNotebook(tab.notebook);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteNote: async (tabId) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    try {
      await api.deleteNote(tab.notebook, tab.fileName);
      get().closeTab(tabId);
      await get().selectNotebook(tab.notebook);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameNoteInList: async (fileName, newTitle) => {
    const notebook = get().activeNotebook;
    if (!notebook) return;
    try {
      await api.renameNote(notebook, fileName, newTitle);
      await get().selectNotebook(notebook);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteNoteInList: async (fileName) => {
    const notebook = get().activeNotebook;
    if (!notebook) return;
    try {
      await api.deleteNote(notebook, fileName);
      await get().selectNotebook(notebook);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  registerFlush: (tabId, flush) => {
    const { flushRegistry } = get();
    flushRegistry.set(tabId, flush);
    set({ flushRegistry });
  },
}));
