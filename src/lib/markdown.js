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
