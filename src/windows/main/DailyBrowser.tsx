// 每日碎片历史浏览：左侧日期列表 + 右侧只读渲染当日整合文件。
// 坑：TipTapEditor 的 initialContent 只在创建时生效——若在内容异步到达前挂载，
// 后续内容更新会被忽略（永远空白）。用 loaded 门控：内容到达后才挂载编辑器。
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../lib/api";
import { fmtDay } from "../../lib/dates";
import { TipTapEditor } from "../../components/editor/TipTapEditor";
import { useFragmentStore } from "../../stores/useFragmentStore";
import { absToDataUri } from "../../lib/dataUri";
import { relToAbs } from "../../lib/paths";
import { confirmAction } from "../../lib/confirm";
import { useWheelScroll } from "../../lib/useWheelScroll";

interface LoadedDay {
  day: string;
  content: string;
  absPath: string;
}

export function DailyBrowser() {
  const closeDailyBrowser = useFragmentStore((s) => s.closeDailyBrowser);
  const [days, setDays] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedDay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // WebView2 滚轮接管
  const daysRef = useRef<HTMLElement>(null);
  useWheelScroll(daysRef);

  useEffect(() => {
    api
      .dailyListDays()
      .then((list) => {
        setDays(list);
        // 自动选中最近一天（列表按时间倒序）
        setSelected((cur) => cur ?? list[0] ?? null);
      })
      .catch(console.error);
  }, []);

  // 碎片保存/窗口关闭时 Rust 广播 daily://changed → 实时刷新（否则显示旧内容）
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen("daily://changed", () => {
      void api.dailyListDays().then((list) => {
        if (disposed) return;
        setDays(list);
        setSelected((cur) => cur ?? list[0] ?? null);
        setReloadTick((t) => t + 1); // 触发当前选中日的重新加载
      });
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoaded(null);
    setLoadError(null);
    api
      .dailyRead(selected)
      .then((r) => {
        if (alive) setLoaded({ day: selected, content: r.content, absPath: r.absPath });
      })
      .catch((e) => {
        if (alive) setLoadError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [selected, reloadTick]);

  return (
    <div className="qj-daily">
      <header className="qj-daily-header">
        <button type="button" className="qj-daily-back" onClick={closeDailyBrowser}>
          ← 返回笔记
        </button>
        <span className="qj-daily-title">每日碎片</span>
        <button type="button" className="qj-tab-close" title="关闭" onClick={closeDailyBrowser}>
          ×
        </button>
      </header>
      <div className="qj-daily-body">
        <nav className="qj-daily-days" ref={daysRef}>
          {days.length === 0 && <div className="qj-empty qj-empty-small">还没有碎片记录</div>}
          {days.map((day) => (
            <div
              key={day}
              className={`qj-daily-day${selected === day ? " is-active" : ""}`}
              onClick={() => setSelected(day)}
            >
              <span className="qj-daily-day-main">
                {fmtDay(day)}
                <span className="qj-daily-day-date">{day}</span>
              </span>
              <button
                type="button"
                className="qj-daily-day-del"
                title="删除这一天的全部碎片"
                onClick={(e) => {
                  e.stopPropagation();
                  confirmAction(`删除 ${day} 的全部碎片记录？此操作不可恢复。`, () => {
                    void api.dailyDeleteDay(day).then(() => {
                      if (selected === day) {
                        setSelected(null);
                        setLoaded(null);
                      }
                    });
                  });
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </nav>
        <div className="qj-daily-content">
          {!selected ? (
            <div className="qj-empty">
              <p className="qj-empty-hint">选择左侧日期查看当日碎片</p>
            </div>
          ) : loadError ? (
            <div className="qj-empty">读取失败：{loadError}</div>
          ) : !loaded ? (
            <div className="qj-empty">加载中…</div>
          ) : (
            <TipTapEditor
              // key 含 reloadTick：刷新时强制重挂载，否则 initialContent 不生效、
              // 编辑器永远显示首次加载的旧内容
              key={`${loaded.day}-${reloadTick}`}
              initialContent={loaded.content}
              readonly
              onSave={async () => {}}
              resolveImageSrc={async (rel) => absToDataUri(relToAbs(loaded.absPath, rel))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
