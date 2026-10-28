/**
 * 窗口图标：用 JS 创建的窗口（碎片 / 设置 / 重建的主窗口）不会自动继承应用图标，
 * Windows 任务栏与标题栏会显示成空白方块。
 *
 * Tauri 2 的窗口创建参数里没有 icon 字段，所以只能在窗口创建成功后调用 setIcon()。
 * 图标用 Vite 的 ?url 指向打包后的 PNG（同源静态资源），交给 Rust 侧按路径加载。
 */
import iconUrl from "../../src-tauri/icons/128x128.png?url";
import { type WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * 给窗口设置应用图标。失败只打日志不抛出——图标缺失不该阻断窗口出现。
 */
export async function applyWindowIcon(win: WebviewWindow): Promise<void> {
  try {
    await win.setIcon(iconUrl);
  } catch (e) {
    console.warn("设置窗口图标失败", e);
  }
}
