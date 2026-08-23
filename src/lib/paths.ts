// 图片 src 的双向转换（纯函数，vitest 覆盖）：
// - md 文件内：相对路径（`../../attachments/2026-08/x.png`）
// - 编辑器内存：asset:// 协议 URL（convertFileSrc(绝对路径)）
//
// Tauri 2 的 convertFileSrc 生成 `asset://localhost/<encodeURIComponent(绝对路径)>`。

const ASSET_PREFIXES = ["asset://localhost/", "http://asset.localhost/"] as const;

/**
 * 绝对路径 → asset:// URL。
 * 坑：Windows 上 @tauri-apps/api 的 convertFileSrc 产出 `http://asset.localhost/...`
 * （依赖 dev 代理，链路不稳、显示失败）；而应用二进制实际注册的是 `asset://` scheme
 * （tauri manager/webview.rs register_uri_scheme_protocol("asset")），
 * 故直接构造 asset://localhost/<encodeURIComponent(路径)>，dev/prod 一致可靠。
 */
export function absToAssetSrc(absPath: string): string {
  return `asset://localhost/${encodeURIComponent(absPath)}`;
}

/** asset:// URL → 绝对路径（还原 URL 编码） */
export function assetSrcToAbs(src: string): string | null {
  let rest: string | null = null;
  for (const prefix of ASSET_PREFIXES) {
    if (src.startsWith(prefix)) {
      rest = src.slice(prefix.length);
      break;
    }
  }
  if (rest === null) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/** 取文件所在目录（保留原分隔符风格） */
export function dirOf(absFilePath: string, sep: string): string {
  const idx = Math.max(absFilePath.lastIndexOf(sep), 0);
  return absFilePath.slice(0, idx);
}

function detectSep(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

/** 按分隔符拆分并去除空段/`.` */
function splitPath(p: string, sep: string): string[] {
  return p.split(sep).filter((s) => s !== "" && s !== ".");
}

/** 去掉 Windows verbatim 前缀 `\\?\`（canonicalize 会返回这种路径） */
function stripVerbatim(p: string): string {
  if (/^\\\\\?\\/.test(p)) {
    return p.slice(4);
  }
  return p;
}

/** 相对路径 + 基准文件绝对路径 → 目标绝对路径（处理 ..，不越过盘符根） */
export function relToAbs(absReferrerFile: string, rel: string): string {
  const clean = stripVerbatim(absReferrerFile);
  const sep = detectSep(clean);
  const stack = splitPath(dirOf(clean, sep), sep);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      // 盘符根（如 C:）不可弹出
      if (stack.length > 0 && !/^[a-zA-Z]:$/.test(stack[stack.length - 1])) stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return stack.join(sep);
}

/** 目标绝对路径 → 相对于基准目录的相对路径（`/` 分隔，md 惯用；公共前缀大小写不敏感） */
export function absToRel(absBaseDir: string, absTarget: string): string {
  const cleanBase = stripVerbatim(absBaseDir);
  const cleanTarget = stripVerbatim(absTarget);
  const sep = detectSep(cleanBase + cleanTarget);
  const base = splitPath(cleanBase, sep).map((s) => s.toLowerCase());
  const target = splitPath(cleanTarget, sep);
  let common = 0;
  while (
    common < base.length &&
    common < target.length &&
    base[common] === target[common].toLowerCase()
  ) {
    common++;
  }
  const ups = base.length - common;
  const rest = target.slice(common);
  return [...Array(ups).fill(".."), ...rest].join("/");
}

/** 判断 src 是否为 asset:// 协议（编辑器内存态） */
export function isAssetSrc(src: string): boolean {
  return ASSET_PREFIXES.some((p) => src.startsWith(p));
}
