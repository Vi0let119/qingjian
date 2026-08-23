import { describe, it, expect } from "vitest";
import { relToAbs, absToRel, isAssetSrc, dirOf, absToAssetSrc } from "./paths";

// Windows 风格路径（应用实际运行环境）
const NOTE = "C:\\Users\\user\\AppData\\Roaming\\轻笺\\notes\\日记\\我的笔记.md";

describe("relToAbs（相对→绝对）", () => {
  it("笔记 2 层深 → ../../attachments", () => {
    expect(relToAbs(NOTE, "../../attachments/2026-08/a.png")).toBe(
      "C:\\Users\\user\\AppData\\Roaming\\轻笺\\attachments\\2026-08\\a.png"
    );
  });

  it("处理多余 .. 不越过盘符根", () => {
    expect(relToAbs("C:\\a\\b.md", "../../../../evil.png")).toBe("C:\\evil.png");
  });

  it("忽略空段与 .", () => {
    expect(relToAbs(NOTE, "./../attachments/x.png")).toBe(
      "C:\\Users\\user\\AppData\\Roaming\\轻笺\\notes\\attachments\\x.png"
    );
  });
});

describe("absToRel（绝对→相对）", () => {
  it("笔记目录 → attachments", () => {
    expect(
      absToRel(
        "C:\\Users\\user\\AppData\\Roaming\\轻笺\\notes\\日记",
        "C:\\Users\\user\\AppData\\Roaming\\轻笺\\attachments\\2026-08\\a.png"
      )
    ).toBe("../../attachments/2026-08/a.png");
  });

  it("大小写不敏感比较公共前缀", () => {
    expect(
      absToRel("c:\\data\\notes\\inbox", "C:\\Data\\attachments\\x.png")
    ).toBe("../../attachments/x.png");
  });

  it("正向斜杠路径同样工作", () => {
    expect(absToRel("/home/u/data/notes/inbox", "/home/u/data/attachments/x.png")).toBe(
      "../../attachments/x.png"
    );
  });

  it("Windows verbatim 前缀 \\\\?\\ 被正确剥离", () => {
    // 回归：Rust canonicalize 返回 \\?\C:\...，曾导致拼接出 ?\C:\... 非法路径
    const verbatim = "\\\\?\\C:\\Users\\user\\AppData\\Roaming\\轻笺\\notes\\3232\\笔记.md";
    expect(relToAbs(verbatim, "../../attachments/2026-08/x.png")).toBe(
      "C:\\Users\\user\\AppData\\Roaming\\轻笺\\attachments\\2026-08\\x.png"
    );
    const verbatimDir = "\\\\?\\C:\\Users\\user\\AppData\\Roaming\\轻笺\\notes\\3232";
    expect(
      absToRel(verbatimDir, "\\\\?\\C:\\Users\\user\\AppData\\Roaming\\轻笺\\attachments\\x.png")
    ).toBe("../../attachments/x.png");
  });
});

describe("absToAssetSrc", () => {
  it("生成 asset:// 形式并编码特殊字符", () => {
    expect(absToAssetSrc("C:\\数据\\轻笺\\a b.png")).toBe(
      "asset://localhost/C%3A%5C%E6%95%B0%E6%8D%AE%5C%E8%BD%BB%E7%AC%BA%5Ca%20b.png"
    );
  });

  it("产物可被 isAssetSrc 识别", () => {
    expect(isAssetSrc(absToAssetSrc("C:\\x\\y.png"))).toBe(true);
  });
});

describe("isAssetSrc / dirOf", () => {
  it("识别 asset 协议前缀", () => {
    expect(isAssetSrc("asset://localhost/C%3A%5Cx.png")).toBe(true);
    expect(isAssetSrc("http://asset.localhost/C%3A%5Cx.png")).toBe(true);
    expect(isAssetSrc("../attachments/x.png")).toBe(false);
    expect(isAssetSrc("https://example.com/x.png")).toBe(false);
  });

  it("dirOf 取目录", () => {
    expect(dirOf("C:\\a\\b.md", "\\")).toBe("C:\\a");
    expect(dirOf("/a/b.md", "/")).toBe("/a");
  });
});
