/**
 * Word（.docx）→ Markdown。
 *
 * mammoth 的 markdown 输出不认表格，会把单元格拍平成竖排段落；它的 HTML 输出是完整的，
 * 所以这里先取 HTML，再用一个只服务 mammoth 输出的小转换器落到 Markdown。
 * 只处理它真会吐的那套标签（p / h1-h6 / strong / em / a / ul / ol / li / blockquote / table / br / pre / code），
 * 不追求通用 HTML→Markdown。图片一律丢弃并计数——案例只收文字，base64 会撑爆提交上限。
 */

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
