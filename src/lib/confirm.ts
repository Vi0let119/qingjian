// Tauri WebView2 不支持 window.confirm/alert/prompt，用轻量 DOM 确认框替代。
// 用法：confirmAction("删除？", () => { ... })
// 单例：已有确认框打开时忽略后续调用（多次点击删除按钮不叠加窗口）

let activeOverlay: HTMLDivElement | null = null;

export function confirmAction(message: string, onConfirm: () => void): void {
  if (activeOverlay) return; // 已打开一个确认框，忽略重复触发

  const overlay = document.createElement("div");
  overlay.className = "qj-confirm-overlay";
  activeOverlay = overlay;

  const box = document.createElement("div");
  box.className = "qj-confirm-box";
  box.innerHTML = `<p class="qj-confirm-msg"></p>`;
  (box.querySelector(".qj-confirm-msg") as HTMLElement).textContent = message;

  const buttons = document.createElement("div");
  buttons.className = "qj-confirm-buttons";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "qj-btn";
  cancelBtn.textContent = "取消";

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "qj-btn qj-btn-danger";
  okBtn.textContent = "确定";

  const close = (confirmed: boolean) => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    activeOverlay = null;
    if (confirmed) onConfirm();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close(false);
    if (e.key === "Enter") close(true);
  };

  cancelBtn.addEventListener("click", () => close(false));
  okBtn.addEventListener("click", () => close(true));
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close(false);
  });
  document.addEventListener("keydown", onKey);

  buttons.append(cancelBtn, okBtn);
  box.append(buttons);
  overlay.append(box);
  document.body.append(overlay);
  okBtn.focus();
}
