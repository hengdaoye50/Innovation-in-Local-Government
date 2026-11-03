/**
 * 预设头像：家纹式的几何标记，单个编号形如 "m3:2"（第 3 个标记 + 第 2 号配色）。
 * 不存图片，所以顶栏、个人页、列表都能直接内联 SVG，也没有上传与审核的问题。
 * 编号白名单在服务端 functions/lib/auth.js 的 validateAvatar 里，改动要两边一起改。
 */

/** 配色取自现有令牌，不引入新颜色 */
export const AVATAR_TINTS = [
  { id: 1, color: "#7E0C6E", name: "紫" },
  { id: 2, color: "#5C084F", name: "深紫" },
  { id: 3, color: "#A83296", name: "浅紫" },
  { id: 4, color: "#2C2C2C", name: "墨" },
];

/** 24×24 画布上的实心/粗线几何，缩到 16px 仍能分辨轮廓 */
export const AVATAR_MARKS = [
  { id: 1, name: "丸", body: `<circle cx="12" cy="12" r="7"/>` },
  { id: 2, name: "环", body: `<circle cx="12" cy="12" r="6.6" fill="none" stroke-width="3.2"/>` },
  { id: 3, name: "山", body: `<path d="M12 5l7 14H5z"/>` },
  { id: 4, name: "方", body: `<rect x="5" y="5" width="14" height="14" rx="1.5"/>` },
  { id: 5, name: "菱", body: `<path d="M12 4l8 8-8 8-8-8z"/>` },
  {
    id: 6,
    name: "三",
    body: `<rect x="4" y="6" width="16" height="3" rx="1"/><rect x="4" y="10.5" width="16" height="3" rx="1"/><rect x="4" y="15" width="16" height="3" rx="1"/>`,
  },
  {
    id: 7,
    name: "井",
    body: `<rect x="5" y="4" width="3" height="16" rx="1"/><rect x="16" y="4" width="3" height="16" rx="1"/><rect x="4" y="7" width="16" height="3" rx="1"/><rect x="4" y="14" width="16" height="3" rx="1"/>`,
  },
  {
    id: 8,
    name: "波",
    body: `<path d="M4 8.5c2.6-2.4 5.4-2.4 8 0s5.4 2.4 8 0" fill="none" stroke-width="2.6"/><path d="M4 15.5c2.6-2.4 5.4-2.4 8 0s5.4 2.4 8 0" fill="none" stroke-width="2.6"/>`,
  },
];

/** "m3:2" → { mark, tint }；不合法或空值返回 null（表示用首字母章） */
export function parseAvatar(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^m([1-8])(?::([1-4]))?$/);
  if (!match) return null;
  return {
    mark: AVATAR_MARKS[Number(match[1]) - 1],
    tint: AVATAR_TINTS[Number(match[2] || 1) - 1],
  };
}

/**
 * 渲染成内联 SVG。size 是视觉尺寸，颜色由配色决定；
 * 描边类标记统一用 currentColor 思路行不通，这里直接写 fill/stroke。
 */
export function avatarSvg(value, size = 16) {
  const parsed = parseAvatar(value);
  if (!parsed) return "";
  const { mark, tint } = parsed;
  const stroked = /stroke-width/.test(mark.body);
  return `<svg class="avatar-mark" width="${size}" height="${size}" viewBox="0 0 24 24"
    fill="${stroked ? "none" : tint.color}"
    stroke="${stroked ? tint.color : "none"}"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${mark.body}</svg>`;
}
