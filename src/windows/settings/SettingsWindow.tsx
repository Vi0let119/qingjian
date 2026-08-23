// 设置窗口：主题定制（预设 / 窗口效果 / 每模块背景图·雾化·纯色·文字色 + 对比度读数）。
// 所有改动写入 zustand 预览态（本窗口实时生效），点"应用"才持久化并广播全窗口。
import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type ModuleConfig, type ThemeConfig } from "../../lib/api";
import { filePathToResizedDataUri } from "../../lib/dataUri";
import { useThemeStore } from "../../stores/useThemeStore";
import { ColorPicker } from "../../components/theme/ColorPicker";
import { ModuleSurface } from "../../components/theme/ModuleSurface";
import { contrastRatio } from "../../lib/contrast";
import { confirmAction } from "../../lib/confirm";
import { IconTrash } from "../../components/common/icons";
import { useWheelScroll } from "../../lib/useWheelScroll";
import "./settings.css";

const MODULES = [
  { id: "sidebar", label: "导航栏" },
  { id: "noteList", label: "笔记列表" },
  { id: "tabs", label: "标签栏" },
  { id: "editor", label: "内容区" },
  { id: "fragment", label: "碎片窗口" },
  { id: "settings", label: "设置窗口" },
] as const;

/** 预设 id → 展示名 */
const PRESET_LABELS: Record<string, string> = {
  "botanical-garden": "植物园",
  "bamboo-dew": "竹露",
  "dusk-violet": "暮山紫",
  "warm-sun": "暖阳",
  "ink-night": "墨夜",
  zhuying: "朱樱",
  muxia: "暮霞",
  chenlan: "沉蓝",
  nuanju: "暖橘",
  "ink-black": "墨黑",
};

export default function SettingsWindow() {
  const config = useThemeStore((s) => s.config);
  const preview = useThemeStore((s) => s.preview);
  const startPreview = useThemeStore((s) => s.startPreview);
  const updatePreview = useThemeStore((s) => s.updatePreview);
  const cancelPreview = useThemeStore((s) => s.cancelPreview);
  const applyPreview = useThemeStore((s) => s.applyPreview);
  const resetTheme = useThemeStore((s) => s.resetTheme);

  const [activeModule, setActiveModule] = useState<string>("sidebar");
  const [message, setMessage] = useState<string | null>(null);
  const [presets, setPresets] = useState<{ id: string; cfg: ThemeConfig; builtin: boolean }[]>([]);
  const [savingScheme, setSavingScheme] = useState(false);
  const [schemeName, setSchemeName] = useState("");

  // 加载预设列表（每个预设取完整配置用于色块展示）
  const refreshPresets = useCallback(async () => {
    const list = await api.themeListPresets();
    const loaded = await Promise.all(
      list.map(async (p) => ({ id: p.id, cfg: await api.themeLoadPreset(p.id), builtin: p.builtin }))
    );
    setPresets(loaded);
  }, []);

  useEffect(() => {
    void refreshPresets().catch(console.error);
  }, [refreshPresets]);

  // 打开设置窗口即进入预览态（本窗口内所有 ModuleSurface 实时跟随）。
  // 依赖 config：主题异步加载完成前 startPreview 无法克隆，等 config 就绪再启动，
  // 否则 preview 一直为 null、控件全部失效（竞态 bug）
  useEffect(() => {
    if (!config) return;
    startPreview();
    return () => cancelPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // WebView2 滚轮接管（左列窗口效果区较长，原生滚动不可靠）。
  // 注意：必须在 cfg 提前返回之前声明——Hook 数量不能随渲染分支变化，
  // 否则触发 "Rendered more hooks than during the previous render" 白屏
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);

  const cfg = preview ?? config;
  // deps 传 cfg：列容器在 cfg 加载后才渲染，effect 需在出现后重新挂监听
  useWheelScroll(leftColRef, [cfg]);
  useWheelScroll(rightColRef, [cfg]);
  if (!cfg) {
    return <div className="qj-settings qj-empty">主题加载中…</div>;
  }

  const updateModule = (id: string, patch: Partial<ModuleConfig>) => {
    updatePreview((c) => ({
      ...c,
      modules: {
        ...c.modules,
        [id]: { ...(c.modules[id] ?? {}), ...patch },
      },
    }));
  };

  const pickWindowImage = async () => {
    const selected = await openDialog({
      title: "选择全局背景图片",
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected !== "string") return;
    try {
      // 前端 canvas 缩放到 ≤1600px JPEG，存 data URI（绕开 IPC 大响应限制）
      const dataUri = await filePathToResizedDataUri(selected);
      updatePreview((c) => ({ ...c, window: { ...c.window, backgroundImage: dataUri } }));
    } catch (e) {
      setMessage(`导入全局背景失败: ${String(e)}`);
    }
  };

  const pickBackgroundImage = async (id: string) => {
    const selected = await openDialog({
      title: "选择背景图片",
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof selected !== "string") return;
    try {
      // 存原始绝对路径（数据目录内）——显示时由 ModuleSurface 走 data URI 通道
      // （convertFileSrc 的 http://asset.localhost 形式在 dev 下不可靠）。
      // 同时清除纯色覆盖：模型中纯色优先于背景图，不清的话图片永远不可见
      const saved = await api.themeImportBackground(selected);
      updateModule(id, { backgroundImage: saved, solidColor: null });
    } catch (e) {
      setMessage(`导入背景失败: ${String(e)}`);
    }
  };

  const handleApply = async () => {
    try {
      await applyPreview();
      setMessage("已应用（所有窗口即时生效）");
    } catch (e) {
      setMessage(`应用失败: ${String(e)}`);
    }
  };

  const handleReset = async () => {
    try {
      await resetTheme();
      setMessage("已恢复默认主题");
    } catch (e) {
      setMessage(`重置失败: ${String(e)}`);
    }
  };

  // 保存当前方案（预览态优先）：名称 → sanitize → themes/<id>.json → 出现在画廊
  const handleSaveScheme = async () => {
    const name = schemeName.trim();
    setSchemeName("");
    setSavingScheme(false);
    if (!name) return;
    const cfgToSave = preview ?? config;
    if (!cfgToSave) return;
    try {
      await api.themeSave(name, cfgToSave);
      setMessage(`已保存主题方案「${name}」（覆盖已存在的同名方案）`);
      await refreshPresets();
    } catch (e) {
      setMessage(`保存失败: ${String(e)}`);
    }
  };

  const m = cfg.modules[activeModule] ?? {};

  return (
    <ModuleSurface module="settings" className="qj-settings">
      <header className="qj-settings-header">
        <span className="qj-settings-title">主题设置</span>
        <span className="qj-settings-hint">预览在本窗口生效 · 应用后全局生效</span>
        <div className="qj-settings-actions">
          <button type="button" className="qj-btn" onClick={() => void handleReset()}>
            恢复默认
          </button>
          <button type="button" className="qj-btn-primary" onClick={() => void handleApply()}>
            应用
          </button>
        </div>
      </header>

      {message && (
        <div className="qj-settings-message" onClick={() => setMessage(null)}>
          {message}（点击关闭）
        </div>
      )}

      <div className="qj-settings-body">
        {/* 左列：预设 + 窗口效果 */}
        <div className="qj-settings-col" ref={leftColRef}>
          <section className="qj-settings-section">
            <h3>预设主题</h3>
            <div className="qj-preset-grid">
              {presets.map(({ id, cfg, builtin }) => (
                <div
                  key={id}
                  className={`qj-preset-card${cfg.name === (preview ?? config)?.name ? " is-active" : ""}`}
                  onClick={() => {
                    updatePreview(() => structuredClone(cfg));
                    // 预设内容区带图时，预览面板自动切到内容区，让图片立即可见
                    if (cfg.modules.editor?.backgroundImage) {
                      setActiveModule("editor");
                    }
                    setMessage(`已载入预设：${PRESET_LABELS[id] ?? id}`);
                  }}
                >
                  <span className="qj-preset-name">{PRESET_LABELS[id] ?? id}</span>
                  <span className="qj-preset-colors">
                    <i style={{ background: cfg.tokens.color.bg }} />
                    <i style={{ background: cfg.tokens.color.primary }} />
                    <i style={{ background: cfg.tokens.color.accent }} />
                  </span>
                  {!builtin && (
                    <button
                      type="button"
                      className="qj-preset-del"
                      title="删除此方案"
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmAction(`删除主题方案「${PRESET_LABELS[id] ?? id}」？`, () => {
                          void api.themeDelete(id).then(() => {
                            void refreshPresets();
                            setMessage("已删除");
                          });
                        });
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* 保存当前自定义方案 */}
            {savingScheme ? (
              <div className="qj-scheme-save-row">
                <input
                  className="qj-input"
                  autoFocus
                  placeholder="方案名称（如：我的森林）"
                  value={schemeName}
                  onChange={(e) => setSchemeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveScheme();
                    if (e.key === "Escape") {
                      setSavingScheme(false);
                      setSchemeName("");
                    }
                  }}
                />
                <button type="button" className="qj-btn-primary" onClick={() => void handleSaveScheme()}>
                  保存
                </button>
                <button
                  type="button"
                  className="qj-btn"
                  onClick={() => {
                    setSavingScheme(false);
                    setSchemeName("");
                  }}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="qj-btn qj-scheme-save-btn"
                onClick={() => setSavingScheme(true)}
              >
                保存当前配色方案…
              </button>
            )}

            <p className="qj-settings-note">
              点击预设载入预览，点「应用」全局生效。你可以在右侧任意定制模块颜色/背景图/虚化，
              再保存为自己的方案——包括背景图片会一并存进方案。
            </p>
          </section>

          <section className="qj-settings-section">
            <h3>窗口效果（Windows）</h3>
            <div className="qj-effect-picker">
              {(["none", "acrylic", "mica"] as const).map((effect) => (
                <label key={effect} className="qj-effect-option">
                  <input
                    type="radio"
                    name="window-effect"
                    checked={cfg.window.effect === effect}
                    onChange={() =>
                      updatePreview((c) => ({ ...c, window: { ...c.window, effect } }))
                    }
                  />
                  {effect === "none" ? "无（纯色）" : effect === "acrylic" ? "亚克力" : "云母 Mica"}
                </label>
              ))}
            </div>
            <p className="qj-settings-note">Mica 仅 Win11；系统关闭"透明效果"时自动回退纯色。</p>

            {/* 全局背景图：覆盖整个界面，各面板毛玻璃叠于其上 */}
            <div className="qj-control-row" style={{ marginTop: 14 }}>
              <span className="qj-control-label">全局背景图（覆盖整个界面）</span>
              <div className="qj-control-value">
                {cfg.window.backgroundImage ? (
                  <button
                    type="button"
                    className="qj-btn"
                    onClick={() =>
                      updatePreview((c) => ({
                        ...c,
                        window: { ...c.window, backgroundImage: null },
                      }))
                    }
                  >
                    移除图片
                  </button>
                ) : (
                  <button
                    type="button"
                    className="qj-btn"
                    onClick={() => void pickWindowImage()}
                  >
                    选择图片…
                  </button>
                )}
              </div>
            </div>
            {cfg.window.backgroundImage && (
              <>
                <div className="qj-control-row">
                  <span className="qj-control-label">全局虚化</span>
                  <div className="qj-control-value">
                    <input
                      type="range"
                      min={0}
                      max={30}
                      value={cfg.window.blur ?? 0}
                      onChange={(e) =>
                        updatePreview((c) => ({
                          ...c,
                          window: { ...c.window, blur: Number(e.target.value) },
                        }))
                      }
                    />
                    <span className="qj-control-num">{cfg.window.blur ?? 0}</span>
                  </div>
                </div>
                <div className="qj-control-row">
                  <span className="qj-control-label">填充方式</span>
                  <div className="qj-control-value">
                    {(
                      [
                        ["cover", "裁剪填充"],
                        ["contain", "完整适应"],
                        ["repeat", "平铺"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="qj-check">
                        <input
                          type="radio"
                          name="window-fit"
                          checked={(cfg.window.backgroundFit ?? "cover") === value}
                          onChange={() =>
                            updatePreview((c) => ({
                              ...c,
                              window: { ...c.window, backgroundFit: value },
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <p className="qj-settings-note">开启后各面板呈毛玻璃效果悬浮于壁纸之上。</p>
              </>
            )}
          </section>
        </div>

        {/* 右列：模块定制 */}
        <div className="qj-settings-col qj-settings-modules" ref={rightColRef}>
          <section className="qj-settings-section">
            <h3>模块定制</h3>
            <div className="qj-module-tabs">
              {MODULES.map((mod) => (
                <button
                  key={mod.id}
                  type="button"
                  className={`qj-module-tab${activeModule === mod.id ? " is-active" : ""}`}
                  onClick={() => setActiveModule(mod.id)}
                >
                  {mod.label}
                </button>
              ))}
            </div>

            <div className="qj-module-controls">
              {/* 背景图 */}
              <div className="qj-control-row">
                <span className="qj-control-label">背景图片</span>
                <div className="qj-control-value">
                  {m.backgroundImage ? (
                    <button
                      type="button"
                      className="qj-btn"
                      onClick={() => updateModule(activeModule, { backgroundImage: null })}
                    >
                      移除图片
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="qj-btn"
                      onClick={() => void pickBackgroundImage(activeModule)}
                    >
                      选择图片…
                    </button>
                  )}
                  {m.backgroundImage && m.solidColor && (
                    <span className="qj-settings-note">纯色覆盖开启中，背景图不显示</span>
                  )}
                </div>
              </div>

              {/* 图片虚化 + 填充方式（有背景图时） */}
              {m.backgroundImage ? (
                <>
                  <div className="qj-control-row">
                    <span className="qj-control-label">图片虚化</span>
                    <div className="qj-control-value">
                      <input
                        type="range"
                        min={0}
                        max={30}
                        value={m.blur ?? 0}
                        onChange={(e) => updateModule(activeModule, { blur: Number(e.target.value) })}
                      />
                      <span className="qj-control-num">{m.blur ?? 0}</span>
                      <span className="qj-settings-note">0 = 清晰</span>
                    </div>
                  </div>
                  <div className="qj-control-row">
                    <span className="qj-control-label">图片填充</span>
                    <div className="qj-control-value">
                      {(
                        [
                          ["cover", "裁剪填充"],
                          ["contain", "完整适应"],
                          ["repeat", "平铺"],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className="qj-check">
                          <input
                            type="radio"
                            name="bg-fit"
                            checked={(m.backgroundFit ?? "cover") === value}
                            onChange={() => updateModule(activeModule, { backgroundFit: value })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="qj-settings-note">选择背景图片后，可调节图片虚化与填充方式。</p>
              )}

              {/* 纯色 */}
              <div className="qj-control-row">
                <span className="qj-control-label">纯色覆盖</span>
                <div className="qj-control-value">
                  <label className="qj-check">
                    <input
                      type="checkbox"
                      checked={!!m.solidColor}
                      onChange={(e) =>
                        updateModule(activeModule, {
                          solidColor: e.target.checked ? cfg.tokens.color.surface : null,
                        })
                      }
                    />
                    启用
                  </label>
                  {m.solidColor && (
                    <ColorPicker
                      value={m.solidColor}
                      onChange={(color) => updateModule(activeModule, { solidColor: color })}
                    />
                  )}
                </div>
              </div>

              {/* 文字色 */}
              <div className="qj-control-row">
                <span className="qj-control-label">文字颜色</span>
                <div className="qj-control-value">
                  <label className="qj-check">
                    <input
                      type="checkbox"
                      checked={!!m.textColor}
                      onChange={(e) =>
                        updateModule(activeModule, {
                          textColor: e.target.checked ? cfg.tokens.color.text : null,
                        })
                      }
                    />
                    手动指定（默认自动适配）
                  </label>
                  {m.textColor && (
                    <>
                      <ColorPicker
                        value={m.textColor}
                        onChange={(color) => updateModule(activeModule, { textColor: color })}
                      />
                      <ContrastBadge bg={m.solidColor ?? cfg.tokens.color.surface} text={m.textColor} />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 实时预览：本模块的所有改动在这里即时可见 */}
            <div className="qj-preview-label">实时预览</div>
            <ModuleSurface module={activeModule} className="qj-settings-preview">
              <ModulePreview module={activeModule} />
            </ModuleSurface>
          </section>
        </div>
      </div>
    </ModuleSurface>
  );
}

/** 各模块的示意内容（供设置窗口预览背景/雾化/纯色/文字色效果） */
function ModulePreview({ module }: { module: string }) {
  switch (module) {
    case "sidebar":
      return (
        <div className="qj-preview qj-preview-sidebar">
          <div className="qj-preview-logo">轻笺</div>
          <div className="qj-preview-item is-active">📓 inbox</div>
          <div className="qj-preview-item">📓 日记</div>
          <div className="qj-preview-item">📓 工作</div>
          <div className="qj-preview-frag">✦ 新建碎片</div>
        </div>
      );
    case "noteList":
      return (
        <div className="qj-preview qj-preview-list">
          <div className="qj-preview-note is-active">
            <span>今日要事</span>
            <i>14:23</i>
          </div>
          <div className="qj-preview-note">
            <span>读书摘录</span>
            <i>昨天</i>
          </div>
          <div className="qj-preview-note">
            <span>灵感碎片</span>
            <i>周一</i>
          </div>
        </div>
      );
    case "tabs":
      return (
        <div className="qj-preview qj-preview-tabs">
          <div className="qj-preview-tabstrip">
            <span className="is-active">今日要事</span>
            <span>读书摘录</span>
          </div>
        </div>
      );
    case "editor":
      return (
        <div className="qj-preview qj-preview-editor">
          <h4>今日要事</h4>
          <p>午后三点，去植物园散步。风里有桂花的香气。</p>
          <p>
            <strong>记下此刻</strong>，让文字在纸上<u>慢慢生长</u>。
          </p>
        </div>
      );
    case "fragment":
      return (
        <div className="qj-preview qj-preview-fragment">
          <div className="qj-preview-fraghead">
            碎片 · 14:23
            <i>已保存</i>
          </div>
          <p>会议临时想到的点子：下季度的主题可以围绕「生长」展开。</p>
        </div>
      );
    default:
      return (
        <div className="qj-preview qj-preview-settings">
          <h4>主题设置</h4>
          <p>白色清新，绿意点缀。</p>
        </div>
      );
  }
}

/** 实时对比度读数：正文 ≥4.5 达标；<3 显示警告 */
function ContrastBadge({ bg, text }: { bg: string; text: string }) {
  const ratio = contrastRatio(bg, text);
  if (ratio === null) return null;
  const ok = ratio >= 4.5;
  const bad = ratio < 3;
  return (
    <span className={`qj-contrast-badge${ok ? " is-ok" : ""}${bad ? " is-bad" : ""}`}>
      对比度 {ratio.toFixed(1)}{ok ? " ✓" : bad ? " ⚠ 文字可能看不清" : ""}
    </span>
  );
}
