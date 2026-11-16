/** 材料提交：我的材料列表 + 材料详情 */
import { esc, toast, confirmDialog, mountReveal } from "../lib/dom.js";
import { works as worksApi, workFiles } from "../lib/api.js";
import { renderMarkdown } from "../lib/markdown.js";
import { createCommentBlock } from "../components/comments.js";
import { getState } from "../lib/store.js";
import { SITE } from "../components/chrome.js";

const STATUS = {
  submitted: { text: "待批阅", cls: "tag--quiet" },
  returned: { text: "已退回", cls: "tag--err" },
  reviewed: { text: "已批阅", cls: "tag--ok" },
  archived: { text: "已归档", cls: "tag--quiet" },
};

const VERDICT = {
  excellent: { text: "优秀", cls: "tag--ok" },
  pass: { text: "通过", cls: "tag--ok" },
  return: { text: "退回修改", cls: "tag--err" },
};

const isStaff = () => ["teacher", "admin"].includes(getState().user?.role);
const kindLabel = (w) => w.kindLabel || "其他材料";

function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/* ————————— 列表 ————————— */

export async function mountWorks(root) {
  root.innerHTML = `<main class="detail-page"><div class="shell works"><div class="skeleton" style="height:220px"></div></div></main>`;
  const shell = root.querySelector(".works");

  let items = [];
  try {
    const res = await worksApi.mine();
    items = Array.isArray(res?.items) ? res.items : [];
  } catch (err) {
    shell.innerHTML = `<div class="empty">材料列表没读出来：${esc(err.message || "请稍后再试")}</div>`;
    return;
  }

  const counts = items.reduce((acc, w) => {
    acc[w.status] = (acc[w.status] || 0) + 1;
    return acc;
  }, {});
  const pendingReview = counts.submitted || 0;
  const returned = counts.returned || 0;

  shell.innerHTML = `
    <header class="works__head">
      <div>
        <div class="screen-ordinal">材料提交</div>
        <h1 class="works__title">我的材料</h1>
        <p class="works__lede">
          案例分析报告、课堂展示课件、读书报告与文献评析的统一提交入口。文件按原样保存，
          教师在此批阅并给出结论。
        </p>
      </div>
      <div class="works__head-actions">
        <a class="btn btn--primary" href="#/works/new">提交材料</a>
      </div>
    </header>

    <div class="works__stats">
      <span class="works__stat"><b>${items.length}</b> 份已提交</span>
      <span class="works__stat"><b>${pendingReview}</b> 份待批阅</span>
      ${
        returned
          ? `<span class="works__stat is-warn"><b>${returned}</b> 份需要改</span>`
          : ""
      }
      ${isStaff() ? `<a class="works__stat-link" href="#/admin">去批阅队列 →</a>` : ""}
    </div>

    ${
      items.length
        ? `<div class="works__list">
            ${items.map(rowHtml).join("")}
          </div>`
        : `<div class="works__empty">
            <div class="eyebrow">尚无提交记录</div>
            <p>一次提交可包含 PDF 或 Word 文件，最多 3 个。课件建议另存为 PDF 后一并提交。</p>
            <a class="btn btn--primary btn--sm" href="#/works/new">提交材料</a>
          </div>`
    }
  `;

  mountReveal(shell);
  document.title = `材料提交 · ${SITE.name}`;
}

function rowHtml(work) {
  const status = STATUS[work.status] || STATUS.submitted;
  const verdict = VERDICT[work.verdict];
  const files = work.files || [];
  return `
    <article class="works__row reveal" data-work="${esc(work.id)}">
      <div class="works__row-main">
        <div class="works__row-meta">
          <span class="tag tag--quiet">${esc(kindLabel(work))}</span>
          ${work.course ? `<span class="meta">${esc(work.course)}</span>` : ""}
          ${work.term ? `<span class="meta mono">${esc(work.term)}</span>` : ""}
          <span class="tag ${status.cls}">${status.text}</span>
          ${verdict ? `<span class="tag ${verdict.cls}">${verdict.text}</span>` : ""}
          ${work.featured ? `<span class="tag tag--warn">已展出</span>` : ""}
        </div>
        <a class="works__row-title" href="#/works/${esc(work.id)}">${esc(work.title)}</a>
        <div class="works__row-files mono">
          ${
            files.length
              ? files
                  .map((f) => `${esc(f.name)} · ${fileSize(f.size)}`)
                  .join("　")
              : work.links.length
                ? `${work.links.length} 个在线文档链接`
                : "没有附件"
          }
        </div>
        ${
          work.comment && work.status === "returned"
            ? `<p class="works__row-note"><b>教师评语</b>${esc(work.comment)}</p>`
            : ""
        }
      </div>
      <div class="works__row-side">
        <span class="meta mono">${esc((work.createdAt || "").slice(0, 10))}</span>
        ${
          work.canEdit
            ? `<a class="btn btn--quiet btn--sm" href="#/works/${esc(work.id)}/edit">${
                work.status === "returned" ? "改后重交" : "改一改"
              }</a>`
            : ""
        }
      </div>
    </article>
  `;
}

/* ————————— 详情 ————————— */

export async function mountWorkDetail(root, id) {
  root.innerHTML = `<main class="detail-page"><div class="shell shell-narrow detail__loading">
    <div class="skeleton" style="height:40px;width:55%"></div>
    <div class="skeleton" style="height:240px;margin-top:20px"></div>
  </div></main>`;

  let work = null;
  try {
    work = await worksApi.detail(id);
  } catch {
    work = null;
  }
  if (!work) {
    root.innerHTML = `<main class="detail-page"><div class="shell shell-narrow empty">
      <div class="screen-ordinal">打不开</div>
      <h1 class="h2" style="margin:12px 0 16px">材料不存在</h1>
      <p class="lede">可能已被作者撤回，或尚未被放上展示板。</p>
      <a class="btn btn--ghost btn--sm" href="#/works">回到材料提交</a>
    </div></main>`;
    return;
  }

  const status = STATUS[work.status] || STATUS.submitted;
  const verdict = VERDICT[work.verdict];
  const files = work.files || [];
  const own = work.canEdit;
  const preview = files.find((f) => /^application\/pdf$/i.test(f.mime));

  root.innerHTML = `
    <main class="detail-page">
      <article class="detail works-detail">
        <div class="shell shell-narrow">
          <a class="detail__back" href="#/works">回到我的材料</a>
          <header class="detail__head">
            <div class="detail__place">
              <span class="detail__place-dot"></span>
              ${esc(kindLabel(work))}${work.course ? ` · ${esc(work.course)}` : ""}${
                work.term ? ` · ${esc(work.term)}` : ""
              }
            </div>
            <h1 class="detail__title">${esc(work.title)}</h1>
            <div class="detail__meta">
              <span class="tag ${status.cls}">${status.text}</span>
              ${verdict ? `<span class="tag ${verdict.cls}">${esc(verdict.text)}</span>` : ""}
              ${work.featured ? `<span class="tag tag--warn">已展出</span>` : ""}
              <span class="meta">${esc(work.author)}</span>
              ${work.groupName ? `<span class="meta">${esc(work.groupName)}</span>` : ""}
              <span class="meta mono">${esc((work.createdAt || "").slice(0, 10))} 交</span>
              ${work.updatedAt ? `<span class="meta mono">${esc(work.updatedAt.slice(0, 10))} 改</span>` : ""}
            </div>
            ${
              own
                ? `<div class="works-detail__actions">
                    <a class="btn btn--ghost btn--sm" href="#/works/${esc(work.id)}/edit">改一改</a>
                    <button class="btn btn--quiet btn--sm" type="button" data-withdraw>撤回</button>
                  </div>`
                : ""
            }
          </header>

          ${
            work.commentVisible && work.comment
              ? `<section class="works-review">
                  <div class="eyebrow">教师批阅${work.reviewer ? ` · ${esc(work.reviewer)}` : ""}</div>
                  <div class="works-review__body">${renderMarkdown(work.comment)}</div>
                  ${work.reviewedAt ? `<div class="meta mono">${esc(work.reviewedAt.slice(0, 10))}</div>` : ""}
                </section>`
              : ""
          }

          ${
            work.summary
              ? `<div class="detail__body md works-detail__summary">${renderMarkdown(work.summary)}</div>`
              : ""
          }

          <section class="works-files">
            <div class="eyebrow">附件 ${files.length ? `· ${files.length}` : ""}</div>
            ${
              files.length
                ? `<ul class="works-files__list">
                    ${files
                      .map(
                        (f) => `
                      <li>
                        <a href="${workFiles.url(f.id)}" target="_blank" rel="noopener noreferrer">
                          <span class="works-files__name">${esc(f.name)}</span>
                          <span class="works-files__meta mono">${fileSize(f.size)}</span>
                        </a>
                      </li>`
                      )
                      .join("")}
                  </ul>`
                : `<p class="meta">没有附件。</p>`
            }
            ${
              work.links.length
                ? `<div class="works-files__links">
                    ${work.links
                      .map(
                        (l) =>
                          `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${
                            esc(l.title || l.url)
                          }</a>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </section>

          ${
            preview
              ? `<div class="works-preview">
                  <div class="eyebrow">预览 · ${esc(preview.name)}</div>
                  <iframe src="${workFiles.url(preview.id)}" title="${esc(preview.name)}" loading="lazy"></iframe>
                </div>`
              : ""
          }
        </div>

        ${
          work.featured && work.status !== "archived"
            ? `<div class="shell shell-narrow"><div data-comments-slot></div></div>`
            : ""
        }
      </article>
    </main>
  `;

  if (work.featured && work.status !== "archived") {
    root.querySelector("[data-comments-slot]")?.append(
      createCommentBlock({ targetType: "work", targetId: work.id, aiReview: "", aiScore: null })
    );
  }

  root.querySelector("[data-withdraw]")?.addEventListener("click", async () => {
    const yes = await confirmDialog({
      title: "撤回这份材料",
      html: `<p>撤回后教师那边会显示为已归档，不再出现在待批阅里。文件仍留存，重新提交请新建一份。</p>`,
      confirmText: "撤回",
      danger: true,
    });
    if (!yes) return;
    try {
      await worksApi.remove(work.id);
      toast("已撤回");
      window.location.hash = "/works";
    } catch (err) {
      toast(err.message || "撤回失败", { type: "error" });
    }
  });

  document.title = `${work.title} · 材料提交`;
  mountReveal(root);
}
