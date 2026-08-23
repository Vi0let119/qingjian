// 单个标签页的编辑器容器：挂载时读取笔记内容，保持实例存活（切标签不丢 undo 栈）。
// 同时负责图片附件：编辑器内存中一律 data URI 显示，落盘映射回 md 相对路径。
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { TipTapEditor } from "../../components/editor/TipTapEditor";
import { useNoteStore, type NoteTab } from "../../stores/useNoteStore";
import { absToRel, assetSrcToAbs, dirOf, relToAbs } from "../../lib/paths";
import { absToDataUri, insertImageViaImport, registerDataUri, relForDataUri } from "../../lib/dataUri";

interface NoteData {
  content: string;
  absPath: string;
}

export function NoteEditorPane({ tab }: { tab: NoteTab }) {
  const [data, setData] = useState<NoteData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const registerFlush = useNoteStore((s) => s.registerFlush);
  const pendingReveal = useNoteStore((s) => s.pendingReveal);
  const setPendingReveal = useNoteStore((s) => s.setPendingReveal);

  // 检索跳转：本标签匹配请求时传给编辑器定位；由编辑器定位完成后回调清除
  // （不能在本组件挂载时清除——编辑器尚未挂载，请求会丢失）
  const reveal =
    pendingReveal && pendingReveal.notebook === tab.notebook && pendingReveal.fileName === tab.fileName
      ? { query: pendingReveal.query }
      : null;

  useEffect(() => {
    let alive = true;
    setData(null);
    setLoadError(null);
    api
      .readNote(tab.notebook, tab.fileName)
      .then((r) => {
        if (alive) setData({ content: r.content, absPath: r.absPath });
      })
      .catch((e) => {
        if (alive) setLoadError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [tab.id, tab.notebook, tab.fileName]);

  const base = { kind: "note" as const, notebook: tab.notebook, fileName: tab.fileName };

  // 插入图片：剪贴板粘贴（本地读字节 → data URI 即时显示）/ 工具栏点击（dialog 选文件）
  const handleInsertImage = useCallback(
    async (file?: File): Promise<string | null> => {
      try {
        return await insertImageViaImport(base, file);
      } catch (e) {
        console.error("[qj] 图片导入失败:", e);
        useNoteStore.setState({ error: `图片导入失败: ${String(e)}` });
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab.id]
  );

  if (loadError) {
    return <div className="qj-empty">读取失败：{loadError}</div>;
  }
  if (data === null) {
    return <div className="qj-empty">加载中…</div>;
  }

  return (
    <TipTapEditor
      key={tab.id}
      initialContent={data.content}
      onSave={(md) => api.saveNote(tab.notebook, tab.fileName, md)}
      onInsertImage={handleInsertImage}
      onPasteError={(msg) => useNoteStore.setState({ error: msg })}
      reveal={reveal}
      onRevealApplied={() => setPendingReveal(null)}
      // 载入：md 相对路径 → 绝对路径 → data URI（异步，TipTapEditor 内部等待完成后重写）
      resolveImageSrc={async (rel) => {
        const abs = relToAbs(data.absPath, rel);
        const uri = await absToDataUri(abs);
        registerDataUri(uri, rel);
        return uri;
      }}
      // 保存：data URI → 相对路径；外链/asset 形式保留或换算
      persistImageSrc={(src) => {
        if (src.startsWith("data:")) {
          return relForDataUri(src) ?? src;
        }
        const abs = assetSrcToAbs(src);
        if (!abs) return src;
        return absToRel(dirOf(data.absPath, data.absPath.includes("\\") ? "\\" : "/"), abs);
      }}
      registerFlush={(flush) => registerFlush(tab.id, flush)}
    />
  );
}
