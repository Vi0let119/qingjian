// 所有 Tauri 命令的强类型封装。组件禁止裸调 invoke，一律走这里。
import { invoke } from "@tauri-apps/api/core";

// ---------- 类型（与 Rust #[serde(rename_all = "camelCase")] 对齐） ----------

export interface NotebookInfo {
  name: string;
  noteCount: number;
}

export interface NoteMeta {
  fileName: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

export interface NoteRead {
  content: string;
  absPath: string;
}

// ---------- 附件 ----------

export type AttachmentBase =
  | { kind: "note"; notebook: string; fileName: string }
  | { kind: "daily"; day: string };

export interface AttachmentInfo {
  absPath: string;
  relPath: string;
}

// ---------- 命令封装 ----------

export const api = {
  // 笔记本
  listNotebooks: () => invoke<NotebookInfo[]>("list_notebooks"),
  createNotebook: (name: string) => invoke<void>("create_notebook", { name }),
  renameNotebook: (oldName: string, newName: string) =>
    invoke<void>("rename_notebook", { oldName, newName }),
  deleteNotebook: (name: string) => invoke<void>("delete_notebook", { name }),

  // 笔记
  listNotes: (notebook: string) => invoke<NoteMeta[]>("list_notes", { notebook }),
  createNote: (notebook: string) => invoke<NoteMeta>("create_note", { notebook }),
  readNote: (notebook: string, fileName: string) =>
    invoke<NoteRead>("read_note", { notebook, fileName }),
  saveNote: (notebook: string, fileName: string, content: string) =>
    invoke<void>("save_note", { notebook, fileName, content }),
  renameNote: (notebook: string, oldFile: string, newTitle: string) =>
    invoke<NoteMeta>("rename_note", { notebook, oldFile, newTitle }),
  deleteNote: (notebook: string, fileName: string) =>
    invoke<void>("delete_note", { notebook, fileName }),
  searchNotes: (notebook: string, query: string) =>
    invoke<{ fileName: string; title: string; snippet: string }[]>("search_notes", {
      notebook,
      query,
    }),

  // 附件
  // 注意：bytes 用 number[]（IPC 经 JSON 序列化，Uint8Array 会被 stringify 成对象导致 serde 反序列化失败）
  importAttachment: (base: AttachmentBase, bytes: number[], ext: string) =>
    invoke<AttachmentInfo>("import_attachment", { base, bytes, ext }),
  importAttachmentFromPath: (base: AttachmentBase, filePath: string) =>
    invoke<AttachmentInfo>("import_attachment_from_path", { base, filePath }),
  deleteAttachment: (base: AttachmentBase, relPath: string) =>
    invoke<void>("delete_attachment", { base, relPath }),
  readFileAsDataUri: (absPath: string) => invoke<string>("read_file_as_data_uri", { absPath }),
  readExternalFileBytes: (path: string) => invoke<number[]>("read_external_file_bytes", { path }),

  // 每日碎片
  dailyRegister: (day: string, windowLabel: string) =>
    invoke<string>("daily_register", { day, windowLabel }),
  dailySave: (sectionId: string, content: string) =>
    invoke<void>("daily_save", { sectionId, content }),
  dailyUnregister: (sectionId: string) => invoke<void>("daily_unregister", { sectionId }),
  dailyRead: (day: string) => invoke<{ content: string; absPath: string }>("daily_read", { day }),
  dailyListDays: () => invoke<string[]>("daily_list_days"),
  dailyDeleteDay: (day: string) => invoke<void>("daily_delete_day", { day }),

  // 主题
  themeGet: () => invoke<ThemeConfig>("theme_get"),
  themeApply: (config: ThemeConfig) => invoke<void>("theme_apply", { config }),
  themeListPresets: () => invoke<{ id: string; name: string; builtin: boolean }[]>("theme_list_presets"),
  themeLoadPreset: (id: string) => invoke<ThemeConfig>("theme_load_preset", { id }),
  themeSave: (name: string, config: ThemeConfig) =>
    invoke<string>("theme_save", { name, config }),
  themeDelete: (id: string) => invoke<void>("theme_delete", { id }),
  themeReset: () => invoke<void>("theme_reset"),
  themeImportBackground: (filePath: string) =>
    invoke<string>("theme_import_background", { filePath }),
};

// ---------- 主题类型（与 Rust theme/model.rs 对齐） ----------

export interface ThemeConfig {
  version: number;
  name: string;
  base: "light" | "dark";
  window: {
    effect: "none" | "acrylic" | "mica";
    state: string;
    /** 全窗口背景图（绝对路径；覆盖整个界面，模块毛玻璃叠于其上） */
    backgroundImage?: string | null;
    backgroundFit?: "cover" | "contain" | "repeat";
    blur?: number;
  };
  tokens: {
    color: {
      primary: string;
      accent: string;
      danger: string;
      bg: string;
      surface: string;
      text: string;
      textSecondary: string;
      border: string;
    };
    font: { family: string; size: string };
    radius: string;
    shadow: string;
  };
  modules: Record<string, ModuleConfig>;
}

export interface ModuleConfig {
  backgroundImage?: string | null;
  backgroundFit?: "cover" | "contain" | "repeat";
  blur?: number;
  solidColor?: string | null;
  textColor?: string | null;
}
