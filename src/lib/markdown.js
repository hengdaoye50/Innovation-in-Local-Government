/** Markdown 渲染（净化后输出） */
import { Marked } from "marked";
import DOMPurify from "dompurify";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "a",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
  ],
  ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt", "class"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
};

export function renderMarkdown(src) {
  if (!src) return "";
  const html = marked.parse(String(src));
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

/** 文件名式的 alt（IMG_2041.jpg 之类）和编辑器里的占位文字都当不了图注，宁可空着 */
const MEANINGLESS_ALT =
  /^(img|dsc|image|photo|截图|照片|照片说明)[-_ 0-9]*$|\.(jpe?g|png|webp|gif|heic|avif)$/i;

/**
 * 图文正文：在 renderMarkdown 之上把「独占一段的图片」包成 figure，
 * alt 当图注。游记里照片和文字是交替出现的，图注比落单的图片更像版面。
 */
export function renderProse(src) {
  const html = renderMarkdown(src);
  if (!html || !html.includes("<img")) return html;

  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  tpl.content.querySelectorAll("img").forEach((img) => {
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    img.setAttribute("referrerpolicy", "no-referrer");
  });

  tpl.content.querySelectorAll("p > img").forEach((img) => {
    const para = img.parentElement;
    // 只有图片前后没有别的文字时才立成图版；行内小图标留在段中
    if (para.textContent.trim()) return;

    const figure = document.createElement("figure");
    figure.className = "figure";
    para.replaceWith(figure);
    figure.append(img);

    const caption = (img.getAttribute("alt") || "").trim();
    if (caption && !MEANINGLESS_ALT.test(caption)) {
      const figcaption = document.createElement("figcaption");
      figcaption.textContent = caption;
      figure.append(figcaption);
    }
  });

  return tpl.innerHTML;
}

/** 纯文本摘要：剥离 markdown 标记 */
export function stripMarkdown(src, limit = 160) {
  const text = String(src || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
