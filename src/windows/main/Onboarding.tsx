// 首次启动教程：介绍核心操作与快捷键（仅显示一次，localStorage 记忆）。
import { useState } from "react";
import "./onboarding.css";

const SHORTCUTS: { keys: string[]; desc: string }[] = [
  { keys: ["Ctrl", "N"], desc: "新建笔记" },
  { keys: ["Ctrl", "F"], desc: "新建碎片窗口" },
  { keys: ["Ctrl", "S"], desc: "立即保存全部笔记" },
];

const TIPS = [
  "笔记自动保存，关闭窗口也不怕丢",
  "碎片输入即存，当日内容自动整合为一篇",
  "拖动栏目间的分隔条，可自由调整宽度",
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  const finish = () => {
    setLeaving(true);
    setTimeout(onDone, 320);
  };

  return (
    <div className={`qj-onboarding${leaving ? " is-leaving" : ""}`} onClick={finish}>
      <div className="qj-onboarding-card" onClick={(e) => e.stopPropagation()}>
        <svg className="qj-onboarding-leaf" viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 44 C 24 34 27 26 35 20 C 35 29 32 37 24 44 Z" fill="currentColor" />
          <path
            d="M24 44 C 24 36 21 30 14 26 C 15 34 19 40 24 44 Z"
            fill="currentColor"
            opacity="0.55"
          />
        </svg>
        <h2 className="qj-onboarding-title">欢迎使用轻笺</h2>
        <p className="qj-onboarding-sub">一张纸，记下每一天。</p>

        <div className="qj-onboarding-shortcuts">
          {SHORTCUTS.map((s) => (
            <div key={s.desc} className="qj-onboarding-row">
              <span className="qj-onboarding-desc">{s.desc}</span>
              <span className="qj-onboarding-keys">
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>

        <ul className="qj-onboarding-tips">
          {TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <button type="button" className="qj-btn-primary qj-onboarding-start" onClick={finish}>
          开始书写
        </button>
      </div>
    </div>
  );
}
