// 碎片窗口：精简编辑器，输入即自动保存到当日整合文件（实时），支持粘贴/插入图片。
// 生命周期：启动 → daily_register（Rust 生成 section 块）→ 输入 debounce → daily_save
// → 窗口关闭 → Rust 侧 Destroyed 钩子注销（空块删除 / 非空块保留）。
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect, EffectState } from "@tauri-apps/api/window";
import { api } from "../../lib/api";
import { nowHM, todayStr } from "../../lib/dates";
import { TipTapEditor, type SaveStatus } from "../../components/editor/TipTapEditor";
import { useFragmentStore } from "../../stores/useFragmentStore";
import { useThemeStore } from "../../stores/useThemeStore";
import { ModuleSurface } from "../../components/theme/ModuleSurface";
import { insertImageViaImport, relForDataUri } from "../../lib/dataUri";
import { IconHome, IconSprout } from "../../components/common/icons";
import "./fragment.css";

/** 打开主界面（已存在则显示并聚焦；被关闭过则按当前主题效果重建）。
 * 启动引导的碎片窗口（fragment-boot）在主界面成功打开后关闭自己。
 * 注意顺序：必须先让主窗口可见再关——Rust 侧"零可见窗口"守卫会把全隐状态判定为应用退出。 */
async function openMainWindow() {
  const isBoot = getCurrentWindow().label === "fragment-boot";
  const existing = await WebviewWindow.getByLabel("main");
  if (existing) {
    await existing.unminimize().catch(() => {});
    await existing.show();
    await existing.setFocus();
  } else {
    const effect = useThemeStore.getState().config?.window.effect ?? "none";
    const options: ConstructorParameters<typeof WebviewWindow>[1] = {
      url: "index.html",
      title: "轻笺",
      width: 1100,
      height: 720,
      minWidth: 800,
      minHeight: 560,
      center: true,
      transparent: effect !== "none",
    };
    if (effect === "mica" || effect === "acrylic") {
      options.windowEffects = {
        effects: [effect === "mica" ? Effect.Mica : Effect.Acrylic],
        state: EffectState.Active,
      };
    }
    const win = new WebviewWindow("main", options);
    await new Promise<void>((resolve, reject) => {
      void win.once("tauri://created", () => resolve());
      void win.once("tauri://error", (e) => reject(new Error(String(e))));
    });
  }
  if (isBoot) {
    await getCurrentWindow().close();
  }
}

export default function FragmentWindow() {
  const sectionId = useFragmentStore((s) => s.sectionId);
  const setSectionId = useFragmentStore((s) => s.setSectionId);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [initError, setInitError] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);

  // 注册会话（每个窗口一次；StrictMode 双挂载会调两次 register，
  // Rust 侧幂等返回同一 section_id，不会产生孤儿块）
  useEffect(() => {
    let alive = true;
    const label = getCurrentWindow().label;
    api
      .dailyRegister(todayStr(), label)
      .then((id) => {
        if (alive) setSectionId(id);
      })
      .catch((e) => {
        if (alive) setInitError(String(e));
      });
    return () => {
      alive = false;
      // 窗口销毁时 Rust 侧钩子负责注销；这里仅清理本地状态
      setSectionId(null);
    };
  }, [setSectionId]);

  if (initError) {
    return <div className="qj-frag-error">初始化失败：{initError}</div>;
  }
  if (!sectionId) {
    return <div className="qj-frag-error">正在接入当日记录…</div>;
  }

  // 启动引导的碎片窗口：点"打开主界面"后会关闭自己（普通碎片窗口保持打开）
  const isBootFragment = getCurrentWindow().label === "fragment-boot";

  return (
    <ModuleSurface module="fragment" className="qj-fragment">
      <header className="qj-frag-header">
        <span className="qj-frag-title">
          <IconSprout size={13} />
          碎片 · {nowHM()}
        </span>
        <span className={`qj-frag-status qj-frag-${saveStatus}`}>
          {saveStatus === "saved" ? "已保存" : saveStatus === "saving" ? "保存中…" : saveStatus === "error" ? "保存失败" : ""}
        </span>
        <button
          type="button"
          className="qj-frag-open-main"
          title={isBootFragment ? "打开主界面（本碎片窗口将关闭）" : "打开主界面"}
          onClick={() => void openMainWindow()}
        >
          <IconHome size={16} />
        </button>
      </header>
      {pasteError && (
        <div className="qj-frag-error-line" onClick={() => setPasteError(null)}>
          {pasteError}（点击关闭）
        </div>
      )}
      <TipTapEditor
        initialContent=""
        compact
        autosaveDelayMs={400}
        placeholder="记录此刻的碎片…（支持粘贴图片）"
        onSave={(md) => api.dailySave(sectionId, md)}
        onSaveStatus={setSaveStatus}
        // 图片：与笔记同一条 data URI 通道；附件按 Daily 基准落盘，md 里为 ../attachments 相对路径
        onInsertImage={(file) => insertImageViaImport({ kind: "daily", day: todayStr() }, file)}
        onPasteError={(msg) => setPasteError(msg)}
        persistImageSrc={(src) => (src.startsWith("data:") ? (relForDataUri(src) ?? src) : src)}
      />
    </ModuleSurface>
  );
}
