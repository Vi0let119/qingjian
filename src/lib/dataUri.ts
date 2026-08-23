// 图片显示的数据 URI 通道——零协议依赖，dev/生产行为一致。
// asset:// 自定义协议在 dev 页面下被 WebView2 拦截不可靠（实测裂图），
// 改为：编辑器内存中图片一律 data URI 显示；落盘时映射回 md 相对路径。
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type AttachmentBase } from "./api";

/** File → data URI（剪贴板粘贴路径，前端本地读取字节） */
export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("读取剪贴板图片失败"));
    reader.readAsDataURL(file);
  });
}

/** data URI → 落盘相对路径注册表（粘贴/加载时登记，保存时查询）。
 *  容量上限防内存泄露：data URI 是大字符串（每张图数十~数百KB），
 *  超出上限时逐出最旧条目（笔记标签关闭后对应条目失去意义，逐出无害）。 */
const MAX_REGISTRY_ENTRIES = 300;
const dataUriToRel = new Map<string, string>();

export function registerDataUri(dataUri: string, relPath: string): void {
  dataUriToRel.set(dataUri, relPath);
  if (dataUriToRel.size > MAX_REGISTRY_ENTRIES) {
    const oldest = dataUriToRel.keys().next().value;
    if (oldest) dataUriToRel.delete(oldest);
  }
}

export function relForDataUri(dataUri: string): string | null {
  return dataUriToRel.get(dataUri) ?? null;
}

/** 绝对路径 → data URI（读取路径，带缓存；同样限容防泄露） */
const absToDataUriCache = new Map<string, string>();

export async function absToDataUri(absPath: string): Promise<string> {
  const cached = absToDataUriCache.get(absPath);
  if (cached) return cached;
  const uri = await api.readFileAsDataUri(absPath);
  absToDataUriCache.set(absPath, uri);
  if (absToDataUriCache.size > MAX_REGISTRY_ENTRIES) {
    const oldest = absToDataUriCache.keys().next().value;
    if (oldest) absToDataUriCache.delete(oldest);
  }
  return uri;
}

/**
 * 导入一张图片并返回显示用 data URI（笔记与每日碎片共用）。
 * file = 剪贴板粘贴（本地读字节 → data URI 即时显示）；
 * 无 file = 工具栏点击（dialog 选文件 → Rust 读入）。
 * 同时登记 data URI → md 相对路径映射，保存时经 relForDataUri 还原。
 */
export async function insertImageViaImport(
  base: AttachmentBase,
  file?: File
): Promise<string | null> {
  let dataUri: string;
  let info: { absPath: string; relPath: string };
  if (file) {
    const [uri, imported] = await Promise.all([
      fileToDataUri(file),
      api.importAttachment(base, Array.from(new Uint8Array(await file.arrayBuffer())), extOf(file)),
    ]);
    dataUri = uri;
    info = imported;
  } else {
    const selected = await openDialog({
      title: "选择图片",
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (typeof selected !== "string") return null;
    info = await api.importAttachmentFromPath(base, selected);
    dataUri = await absToDataUri(info.absPath);
  }
  registerDataUri(dataUri, info.relPath);
  return dataUri;
}

/**
 * 用户自选图片 → 前端 canvas 缩放（最长边 1600、JPEG q85）→ data URI。
 * 绕开 IPC 响应体积限制（大图 base64 响应 >1-2MB 会被丢弃）。
 */
export async function filePathToResizedDataUri(filePath: string, maxDim = 1600): Promise<string> {
  const bytes = await api.readExternalFileBytes(filePath);
  const blob = new Blob([new Uint8Array(bytes)]);
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("图片解码失败"));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 不可用");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extOf(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  if (name.endsWith(".gif")) return "gif";
  if (name.endsWith(".webp")) return "webp";
  return file.type.split("/")[1] ?? "png";
}
