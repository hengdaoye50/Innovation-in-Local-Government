/**
 * 附件预览：PDF 交给浏览器内嵌翻页，Word（.docx）在浏览器里转成网页排版。
 *
 * 为什么不在服务端转：附件通道只负责原样存取（见 functions/api/works/[[path]].js），
 * 转格式要么接付费服务，要么在 Functions 里跑 LibreOffice，都不划算。
 * docx 本质是 zip + XML，mammoth 本来就在依赖里（导入 Word 稿件用它），这里只换个出口。
 *
 * 旧版 .doc 是 OLE 二进制，浏览器端解不开，只能请人下载——这一点在界面上说清楚，
 * 别让人对着空白框等。
 */
import { esc } from "../lib/dom.js";
import { workFiles } from "../lib/api.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

function kindOf(file) {
  const mime = String(file?.mime || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === DOCX_MIME || name.endsWith(".docx")) return "docx";
  if (mime === DOC_MIME || name.endsWith(".doc")) return "doc";
  return "other";
}

/**
 * @param {HTMLElement} host 预览容器（组件接管其内容）
 * @param {Array<{id: string, name: string, mime: string}>} files 材料附件列表
 * @param {{compact?: boolean, label?: string}} options compact 用于后台批阅的窄面板
 */
export function mountDocPreview(host, files, { compact = false, label = "预览" } = {}) {
  if (!host) return;

  const list = (files || []).filter((f) => f && f.id);
  // PDF 排前面：它是浏览器原生渲染，版式与原文一致，能看就先让人看它
  const previewable = [
    ...list.filter((f) => kindOf(f) === "pdf"),
    ...list.filter((f) => kindOf(f) === "docx"),
  ];

  if (!previewable.length) {
    host.innerHTML = list.some((f) => kindOf(f) === "doc")
      ? `<p class="doc-preview__hint">旧版 .doc 没法在浏览器里排版显示，点上面的文件名下载后用 Word 打开；或者让作者另存为 .docx / PDF 再传一次。</p>`
      : "";
    return;
  }

  host.innerHTML = `
    <div class="doc-preview${compact ? " doc-preview--compact" : ""}">
      ${
        previewable.length > 1
          ? `<div class="doc-preview__tabs">
               ${previewable
                 .map(
                   (f, i) =>
                     `<button class="doc-preview__tab${i === 0 ? " is-on" : ""}" type="button"
                        data-tab="${esc(f.id)}"><span>${esc(f.name)}</span></button>`
                 )
                 .join("")}
             </div>`
          : `<div class="eyebrow">${esc(label)}${previewable[0].name ? ` · ${esc(previewable[0].name)}` : ""}</div>`
      }
      <div class="doc-preview__stage" data-stage></div>
      <p class="doc-preview__note" data-note hidden></p>
    </div>
  `;

  const stage = host.querySelector("[data-stage]");
  const note = host.querySelector("[data-note]");
  const tabs = Array.from(host.querySelectorAll("[data-tab]"));

  // 切换文件时前一次转换可能还在路上，用序号丢掉过期结果
  let seq = 0;
  const isCurrent = (my) => my === seq;

  const draw = (file) => {
    const my = (seq += 1);
    note.hidden = true;
    note.textContent = "";

    if (kindOf(file) === "pdf") {
      stage.innerHTML = `<iframe src="${workFiles.url(file.id)}" title="${esc(
        file.name
      )}" loading="lazy"></iframe>`;
      return;
    }

    void drawDocx(file, my);
  };

  async function drawDocx(file, my) {
    stage.innerHTML = `<p class="doc-preview__msg">正在转换文档，稍等片刻…</p>`;

    let buffer;
    try {
      const res = await fetch(workFiles.url(file.id), { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      buffer = await res.arrayBuffer();
    } catch (err) {
      if (!isCurrent(my)) return;
      const code = err?.message && /^\d{3}$/.test(err.message) ? `（${err.message}）` : "";
      stage.innerHTML = `<p class="doc-preview__msg">附件读取失败${esc(
        code
      )}，点上面的文件名下载后再看。</p>`;
      return;
    }

    let out;
    try {
      // mammoth 与转换器都按需加载：不进主包，批阅页面不因为这次改动变重
      const [{ default: mammoth }, { docxToPreviewHtml }] = await Promise.all([
        import("mammoth"),
        import("../lib/docx.js"),
      ]);
      out = await docxToPreviewHtml(mammoth, buffer);
    } catch {
      if (!isCurrent(my)) return;
      stage.innerHTML = `<p class="doc-preview__msg">这份 Word 解析不了（可能已损坏或不是标准的 .docx），点上面的文件名下载后再看。</p>`;
      return;
    }

    if (!isCurrent(my)) return;

    if (out.empty) {
      stage.innerHTML = `<p class="doc-preview__msg">文档里没有可显示的正文，可能是扫描件或整篇都是图片版式，请下载后查看。</p>`;
      return;
    }

    stage.innerHTML = `<div class="doc-preview__paper md">${out.html}</div>`;
    const bits = ["Word 文档已按网页排版显示，分栏、页码与页眉页脚不会保留；版式要与原文一致请下载后用 Word 打开。"];
    if (out.droppedImages) {
      bits.push(`另有 ${out.droppedImages} 张图片因体积过大未显示。`);
    }
    note.hidden = false;
    note.textContent = bits.join(" ");
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = previewable.find((f) => f.id === tab.dataset.tab);
      if (!target) return;
      tabs.forEach((t) => t.classList.toggle("is-on", t === tab));
      draw(target);
    });
  });

  draw(previewable[0]);
}
