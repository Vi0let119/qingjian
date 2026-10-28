// 打开设置窗口（主窗口侧栏与书写视图的悬浮工具条共用）。
// 已存在则聚焦，不重复创建。
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect, EffectState } from "@tauri-apps/api/window";
import { useThemeStore } from "../../stores/useThemeStore";
import { applyWindowIcon } from "../../lib/windowIcon";

export async function openSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("settings");
  if (existing) {
    await existing.setFocus();
    return;
  }
  const effect = useThemeStore.getState().config?.window.effect ?? "none";
  const options: ConstructorParameters<typeof WebviewWindow>[1] = {
    url: "settings.html",
    title: "设置 - 轻笺",
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 480,
    transparent: effect !== "none",
  };
  if (effect === "mica" || effect === "acrylic") {
    options.windowEffects = {
      effects: [effect === "mica" ? Effect.Mica : Effect.Acrylic],
      state: EffectState.Active,
    };
  }
  const win = new WebviewWindow("settings", options);
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (e) => reject(new Error(String(e))));
  });
  await applyWindowIcon(win);
}
