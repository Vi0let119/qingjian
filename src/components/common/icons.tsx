// 轻笺自定义图标集：统一 1.6px 圆头线条风格（currentColor），
// 替代通用 emoji（📅📓🗑⚙🖼…）——与"植物园·纸张"主题一致，带少量植物细节。
import type { SVGProps } from "react";

export interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
}

/** 日历（每日碎片）——左下角一片小叶芽 */
export function IconCalendar({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path
        d="M8.5 15.5c0-1.8 1.1-3.1 2.7-3.6 0 2.2-1.2 3.6-2.7 3.6z"
        fill="currentColor"
        stroke="none"
        opacity="0.55"
      />
    </svg>
  );
}

/** 笔记本（侧栏笔记本列表） */
export function IconNotebook({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17.5H7.5A2.5 2.5 0 0 0 5 22V4.5z" />
      <path d="M20 19.5H7.5a2.5 2.5 0 0 0 0 5" />
      <path d="M9 7h7" opacity="0.5" />
    </svg>
  );
}

/** 铅笔（重命名） */
export function IconPencil({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20l1.2-4L16.7 4.5a2 2 0 0 1 2.8 2.8L7.8 19z" />
      <path d="M13.8 7.4l2.8 2.8" />
    </svg>
  );
}

/** 垃圾桶（删除） */
export function IconTrash({ size = 12, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V7" />
      <path d="M6.5 7l1 13.5h9l1-13.5" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** 齿轮（设置） */
export function IconGear({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </svg>
  );
}

/** 图片（插入图片） */
export function IconImage({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="M3.5 17l5-4.5 4 3.5 4.5-4 3.5 3" />
    </svg>
  );
}

/** 加粗：替代字形 B（字形在不同系统里渲染不一致，显廉价） */
export function IconBold({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7.5 4.5h6a4 4 0 0 1 0 8h-6z" />
      <path d="M7.5 12.5h6.8a4 4 0 0 1 0 8H7.5z" />
    </svg>
  );
}

/** 斜体 */
export function IconItalic({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15" />
    </svg>
  );
}

/** 下划线 */
export function IconUnderline({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 4.5v7a5 5 0 0 0 10 0v-7" />
      <path d="M5.5 20h13" />
    </svg>
  );
}

/** 左尖角（返回上层） */
export function IconChevronLeft({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

/** 加号（新建） */
export function IconPlus({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 叶芽（新建碎片）——与 logo 蕨叶呼应 */
export function IconSprout({ size = 13, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 21c0-6 2.5-10.5 8-12.5C20 14.5 17.5 19 12 21z" />
      <path d="M12 21c0-5-1.8-8.8-6.2-10.6C6.5 14.8 8.8 17.8 12 21z" opacity="0.55" />
    </svg>
  );
}

/** 小屋（碎片窗口 → 打开主界面） */
export function IconHome({ size = 13, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 10.5 12 4l7.5 6.5" />
      <path d="M6.5 9v11h11V9" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}
