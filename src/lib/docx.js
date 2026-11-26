/**
 * Word（.docx）→ Markdown。
 *
 * mammoth 的 markdown 输出不认表格，会把单元格拍平成竖排段落；它的 HTML 输出是完整的，
 * 所以这里先取 HTML，再用一个只服务 mammoth 输出的小转换器落到 Markdown。
 * 只处理它真会吐的那套标签（p / h1-h6 / strong / em / a / ul / ol / li / blockquote / table / br / pre / code），
 * 不追求通用 HTML→Markdown。图片一律丢弃并计数——案例只收文字，base64 会撑爆提交上限。
 *
 * 文件末尾另有一条相反的路：docxToPreviewHtml，把 Word 转成网页排版用来预览（保留图片）。
 */
import DOMPurify from "dompurify";

const COUNTED_IMAGES = { count: 0 };

function inlineToMarkdown(node) {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += child.nodeValue.replace(/\s+/g, " ");
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    const inner = inlineToMarkdown(child);
    switch (tag) {
      case "strong":
      case "b":
        out += inner.trim() ? `**${inner.trim()}**` : "";
        break;
      case "em":
      case "i":
        out += inner.trim() ? `*${inner.trim()}*` : "";
        break;
      case "s":
      case "strike":
      case "del":
        out += inner.trim() ? `~~${inner.trim()}~~` : "";
        break;
      case "code":
        out += inner.trim() ? `\`${inner.trim()}\`` : "";
        break;
      case "a": {
        const href = child.getAttribute("href") || "";
        const text = inner.trim();
        out += /^https?:\/\//i.test(href) && text ? `[${text}](${href})` : inner;
        break;
      }
      case "br":
        out += "  \n";
        break;
      case "img":
        COUNTED_IMAGES.count += 1;
        break;
      case "sup":
      case "sub":
      case "u":
      case "span":
        out += inner;
        break;
      default:
        out += inner;
    }
  });
  return out;
}

function cellText(cell) {
  return inlineToMarkdown(cell)
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children)
      .filter((cell) => /^(td|th)$/i.test(cell.tagName))
      .map(cellText)
  );
  const useful = rows.filter((cells) => cells.some((text) => text !== ""));
  if (!useful.length) return "";

  const width = Math.max(...useful.map((cells) => cells.length));
  const pad = (cells) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")];
  const [head, ...body] = useful.map(pad);
  const line = (cells) => `| ${cells.join(" | ")} |`;
  const divider = `| ${Array(width).fill("---").join(" | ")} |`;
  return [line(head), divider, ...body.map(line)].join("\n") + "\n\n";
}

function listToMarkdown(list, depth) {
  const ordered = list.tagName.toLowerCase() === "ol";
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === "li");
  const lines = items.map((item, index) => {
    // 列表项里嵌套的列表要单独成行，且不能混进本行的文字
    const nested = Array.from(item.children).filter((child) =>
      ["ul", "ol"].includes(child.tagName.toLowerCase())
    );
    const clone = item.cloneNode(true);
    Array.from(clone.children)
      .filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase()))
      .forEach((child) => child.remove());
    const text = inlineToMarkdown(clone).replace(/\s*\n\s*/g, " ").trim();
    const marker = ordered ? `${index + 1}. ` : "- ";
    const pad = "  ".repeat(depth);
    const own = `${pad}${marker}${text}`;
    const kids = nested
      .map((child) => listToMarkdown(child, depth + 1))
      .join("");
    return `${own}\n${kids}`;
  });
  return lines.join("");
}

function blockToMarkdown(node) {
  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const text = inlineToMarkdown(node).replace(/\s+/g, " ").trim();
    return text ? `${"#".repeat(level)} ${text}\n\n` : "";
  }
  if (tag === "p" || tag === "div") {
    const text = inlineToMarkdown(node).trim();
    return text ? `${text}\n\n` : "";
  }
  if (tag === "ul" || tag === "ol") return `${listToMarkdown(node, 0)}\n`;
  if (tag === "blockquote") {
    const inner = Array.from(node.children)
      .map(blockToMarkdown)
      .join("")
      .trim();
    if (!inner) return "";
    return `${inner
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n")}\n\n`;
  }
  if (tag === "table") return tableToMarkdown(node);
  if (tag === "pre") {
    const text = node.textContent.replace(/\s+$/, "");
    return text ? `\`\`\`\n${text}\n\`\`\`\n\n` : "";
  }
  if (tag === "hr") return "---\n\n";
  if (tag === "img") {
    COUNTED_IMAGES.count += 1;
    return "";
  }
  // 其余容器（body / section / 未知块）就地展开
  const inner = Array.from(node.childNodes)
    .map((child) => {
      if (child.nodeType === 3) {
        const text = child.nodeValue.trim();
        return text ? `${text}\n\n` : "";
      }
      return child.nodeType === 1 ? blockToMarkdown(child) : "";
    })
    .join("");
  return inner;
}

/**
 * @param {object} mammoth 已加载的 mammoth 模块
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{markdown: string, droppedImages: number, otherWarnings: number}>}
 */
export async function docxToMarkdown(mammoth, arrayBuffer) {
  COUNTED_IMAGES.count = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      // 从源头不生成 data URI：图片不该以 base64 的形式进正文。
      // 计数统一放在下面遍历 HTML 时做，这里只负责让它落空，免得同一张图数两遍。
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
    }
  );

  const doc = new DOMParser().parseFromString(`<div id="docx-root">${result.value || ""}</div>`, "text/html");
  const root = doc.getElementById("docx-root");
  const markdown = Array.from(root.childNodes)
    .map((child) => {
      if (child.nodeType === 3) {
        const text = child.nodeValue.trim();
        return text ? `${text}\n\n` : "";
      }
      return child.nodeType === 1 ? blockToMarkdown(child) : "";
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const otherWarnings = (result.messages || []).filter(
    (m) => m.type === "warning" && !/image/i.test(m.message || "")
  ).length;

  return { markdown, droppedImages: COUNTED_IMAGES.count, otherWarnings };
}

/* ——————————— 预览：Word → 网页排版 ——————————— */

/**
 * 与上面的导入路径方向相反：导入只收文字（图片全丢，案例提交有体积上限），
 * 预览要正文 + 表格 + 图片一起看。所以图片保留，但要设预算——
 * mammoth 默认把图转成 base64，一篇带二十张照片的报告能到几十 MB，
 * 直接塞进 DOM 会让批阅页面卡死。超预算的图整张丢掉并计数，由界面提示。
 */
const PREVIEW_IMAGE_LIMIT = 30;
const PREVIEW_IMAGE_BUDGET = 8 * 1024 * 1024;

const PREVIEW_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "del", "u", "s", "sub", "sup", "code", "pre",
    "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "a", "hr", "table", "thead", "tbody", "tr", "th", "td", "img",
  ],
  ALLOWED_ATTR: ["href", "title", "src", "alt"],
  // 预览要把图片以 data URI 内嵌，但仍只放行图片类型的数据，别的一概不认
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/|data:image\/)/i,
};

/**
 * @param {object} mammoth 已加载的 mammoth 模块
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{html: string, droppedImages: number, empty: boolean}>}
 */
export async function docxToPreviewHtml(mammoth, arrayBuffer) {
  let used = 0;
  let kept = 0;
  let droppedImages = 0;

  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      // Word 的「标题」样式默认被 mammoth 当成普通段落，落到网页里就是一坨正文。
      // 预览要看清结构，把这两档认成标题与副标题。
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => p:fresh",
      ],
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read("base64");
        if (kept >= PREVIEW_IMAGE_LIMIT || used + base64.length > PREVIEW_IMAGE_BUDGET) {
          droppedImages += 1;
          return { src: "" };
        }
        kept += 1;
        used += base64.length;
        return { src: `data:${image.contentType};base64,${base64}` };
      }),
    }
  );

  const doc = new DOMParser().parseFromString(
    `<div id="docx-root">${result.value || ""}</div>`,
    "text/html"
  );
  const root = doc.getElementById("docx-root");

  // 超预算的图在转换时就返回了空 src，这里摘掉，别在版面上留下碎图标
  root.querySelectorAll("img").forEach((img) => {
    if (!img.getAttribute("src")) img.remove();
  });

  // Word 的标题放进半屏高的预览窗里偏大，统一降一级
  root.querySelectorAll("h1").forEach((h1) => {
    const h2 = doc.createElement("h2");
    while (h1.firstChild) h2.appendChild(h1.firstChild);
    h1.replaceWith(h2);
  });

  const text = (root.textContent || "").replace(/\s+/g, "");
  return {
    html: DOMPurify.sanitize(root.innerHTML, PREVIEW_PURIFY_CONFIG),
    droppedImages,
    empty: text.length === 0 && !root.querySelector("img"),
  };
}