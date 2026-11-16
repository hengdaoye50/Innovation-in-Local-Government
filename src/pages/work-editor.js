/** 材料提交表单：新交与改稿共用 */
import { esc, toast, confirmDialog } from "../lib/dom.js";
import { works as worksApi, workFiles } from "../lib/api.js";
import { COURSES, TERMS, WORK_KINDS } from "../lib/courses.js";

const MAX_FILES = 3;
const MAX_FILE_MB = 20;
const MAX_LINKS = 5;
const ACCEPT = ".pdf,.docx,.doc";

const fileSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};

export async function mountWorkEditor(root, id = "") {
  let work = null;
  if (id) {
    root.innerHTML = `<main class="detail-page"><div class="shell shell-narrow detail__loading">
      <div class="skeleton" style="height:40px;width:50%"></div>
      <div class="skeleton" style="height:300px;margin-top:20px"></div>
    </div></main>`;
    try {
      work = await worksApi.detail(id);
    } catch {
      work = null;
    }
    if (!work) {
      root.innerHTML = `<main class="detail-page"><div class="shell shell-narrow empty">
        <div class="screen-ordinal">打不开</div>
        <h1 class="h2" style="margin:12px 0 16px">这份材料不在了</h1>
        <a class="btn btn--ghost btn--sm" href="#/works">回到材料提交</a>
      </div></main>`;
      return;
    }
    if (!work.canEdit) {
      root.innerHTML = `<main class="detail-page"><div class="shell shell-narrow empty">
        <div class="screen-ordinal">不能改</div>
        <h1 class="h2" style="margin:12px 0 16px">教师已经批阅过了</h1>
        <p class="lede">要改稿请先请教师退回，退回后这里会重新打开。</p>
        <a class="btn btn--ghost btn--sm" href="#/works/${esc(work.id)}">回到这份材料</a>
      </div></main>`;
      return;
    }
  }

  root.innerHTML = editorHtml(work);
  const page = root.querySelector("[data-work-form]");
  const kindSel = page.querySelector("[data-kind]");
  const titleInput = page.querySelector("[data-title]");
  const courseSel = page.querySelector("[data-course]");
  const termSel = page.querySelector("[data-term]");
  const groupInput = page.querySelector("[data-group]");
  const membersInput = page.querySelector("[data-members]");
  const summaryInput = page.querySelector("[data-summary]");
  const fileList = page.querySelector("[data-file-list]");
  const fileInput = page.querySelector("[data-file]");
  const linkList = page.querySelector("[data-link-list]");
  const statusEl = page.querySelector("[data-status]");
  const submitBtn = page.querySelector("[data-submit]");

  /** @type {{id:string,name:string,size:number,mime:string}[]} */
  let files = (work?.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    mime: f.mime,
  }));
  /** @type {{title:string,url:string}[]} */
  let links = (work?.links || []).map((l) => ({ title: l.title || "", url: l.url || "" }));
  if (!links.length) links = [{ title: "", url: "" }];

  const renderFiles = () => {
    fileList.innerHTML = files.length
      ? files
          .map(
            (f, i) => `
        <li class="work-file">
          <span class="work-file__name">${esc(f.name)}</span>
          <span class="work-file__meta mono">${fileSize(f.size)}</span>
          <button class="work-file__del" type="button" data-file-del="${i}" aria-label="移除">×</button>
        </li>`
          )
          .join("")
      : `<li class="work-file work-file--empty">还没有附件</li>`;
    page.querySelector("[data-file-count]").textContent = `${files.length} / ${MAX_FILES}`;
  };

  const renderLinks = () => {
    linkList.innerHTML = links
      .map(
        (l, i) => `
      <div class="work-link">
        <input class="input" data-link-title="${i}" maxlength="80" placeholder="链接标题（可选）"
          value="${esc(l.title)}" />
        <input class="input" data-link-url="${i}" maxlength="500" placeholder="https://…"
          value="${esc(l.url)}" />
        <button class="btn btn--quiet btn--sm" type="button" data-link-del="${i}">删</button>
      </div>`
      )
      .join("");
    page.querySelector("[data-link-count]").textContent = `${links.length} / ${MAX_LINKS}`;
  };

  fileList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-file-del]");
    if (!btn) return;
    files.splice(Number(btn.dataset.fileDel), 1);
    renderFiles();
  });

  linkList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-link-del]");
    if (!btn) return;
    links.splice(Number(btn.dataset.linkDel), 1);
    if (!links.length) links = [{ title: "", url: "" }];
    renderLinks();
  });

  linkList.addEventListener("input", () => {
    linkList.querySelectorAll("[data-link-title]").forEach((node) => {
      const i = Number(node.dataset.linkTitle);
      if (links[i]) links[i].title = node.value;
    });
    linkList.querySelectorAll("[data-link-url]").forEach((node) => {
      const i = Number(node.dataset.linkUrl);
      if (links[i]) links[i].url = node.value;
    });
  });

  const uploadFiles = async (picked) => {
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      toast(`最多 ${MAX_FILES} 个附件`, { type: "error" });
      return;
    }
    const batch = picked.slice(0, room);
    if (picked.length > room) toast(`最多再传 ${room} 个`, { type: "error" });

    for (const file of batch) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast(`${file.name} 超过 ${MAX_FILE_MB}MB`, { type: "error" });
        continue;
      }
      statusEl.textContent = `正在上传 ${file.name}…`;
      statusEl.dataset.state = "";
      try {
        const res = await workFiles.upload(file);
        files.push({ id: res.id, name: res.name || file.name, size: res.size || file.size, mime: file.type });
        renderFiles();
      } catch (err) {
        toast(err.message || `${file.name} 没传上去`, { type: "error" });
      }
    }
    statusEl.textContent = "";
  };

  fileInput.addEventListener("change", () => {
    const picked = Array.from(fileInput.files || []);
    fileInput.value = "";
    uploadFiles(picked);
  });

  // 拖进来就传
  page.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    page.classList.add("is-dragging");
  });
  page.addEventListener("dragleave", (event) => {
    if (event.target !== page) return;
    page.classList.remove("is-dragging");
  });
  page.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    page.classList.remove("is-dragging");
    uploadFiles(Array.from(event.dataTransfer.files));
  });

  page.querySelector("[data-add-link]").addEventListener("click", () => {
    if (links.length >= MAX_LINKS) {
      toast(`最多 ${MAX_LINKS} 个链接`, { type: "error" });
      return;
    }
    links.push({ title: "", url: "" });
    renderLinks();
  });

  // 类型切换时更新提示
  const updateKindHint = () => {
    const kind = WORK_KINDS.find((k) => k.value === kindSel.value);
    page.querySelector("[data-kind-hint]").textContent = kind ? kind.hint : "";
  };
  kindSel.addEventListener("change", updateKindHint);

  page.querySelector("[data-cancel]").addEventListener("click", async () => {
    const dirty =
      titleInput.value.trim() !== (work?.title || "") ||
      summaryInput.value.trim() !== (work?.summary || "") ||
      files.length !== (work?.files || []).length;
    if (dirty) {
      const yes = await confirmDialog({
        title: "放弃这次填写",
        html: `<p>已经上传的附件会留在服务器上，一天内没提交会被自动清理。</p>`,
        confirmText: "离开",
      });
      if (!yes) return;
    }
    window.location.hash = work ? `/works/${work.id}` : "/works";
  });

  const submit = async () => {
    const payload = {
      kind: kindSel.value,
      title: titleInput.value.trim(),
      course: courseSel.value,
      term: termSel.value,
      groupName: groupInput.value.trim(),
      members: membersInput.value.trim(),
      summary: summaryInput.value.trim(),
      links: links.filter((l) => /^https?:\/\//i.test(l.url.trim())),
      files: files.map((f) => f.id),
    };

    if (!payload.title) {
      toast("给这份材料起个标题", { type: "error" });
      titleInput.focus();
      return;
    }
    if (!payload.files.length && !payload.links.length) {
      toast("至少交一个文件，或者填一个在线文档链接", { type: "error" });
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = work ? "保存中…" : "提交中…";
    statusEl.dataset.state = "";
    try {
      const res = work
        ? await worksApi.update(work.id, payload)
        : await worksApi.create(payload);
      toast(work ? "改好了，等教师再看一遍" : "已提交，等教师批阅");
      window.location.hash = `/works/${res.id || work?.id}`;
    } catch (err) {
      statusEl.textContent = err.message || "没能提交";
      statusEl.dataset.state = "err";
    } finally {
      submitBtn.disabled = false;
    }
  };

  submitBtn.addEventListener("click", submit);
  page.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  renderFiles();
  renderLinks();
  updateKindHint();

  document.title = work ? `改稿 · ${work.title}` : "提交材料";
}

function editorHtml(work) {
  const editing = Boolean(work);
  return `
    <main class="detail-page">
      <form class="shell shell-narrow work-form" data-work-form novalidate>
        <div class="work-form__top">
          <a class="detail__back" href="${editing ? `#/works/${esc(work.id)}` : "#/works"}">
            ${editing ? "回到这份材料" : "回到我的材料"}
          </a>
          <span class="meta">${editing ? "改完重交会重新进入待批阅" : "交上之后教师会看到批阅队列里"}</span>
        </div>

        <header class="work-form__head">
          <div class="screen-ordinal">${editing ? "改稿" : "提交材料"}</div>
          <h1 class="work-form__title">${editing ? esc(work.title) : "交一份材料"}</h1>
          <p class="work-files__hint">
            站点不改你的文件：PDF 能直接内嵌预览，Word 只提供下载。
            课件建议在 PowerPoint 里另存一份 PDF 一起交。
          </p>
        </header>

        <div class="work-form__grid">
          <label class="field">
            <span class="field__label">材料类型</span>
            <select class="select" data-kind>
              ${WORK_KINDS.map(
                (k) =>
                  `<option value="${k.value}" ${work?.kind === k.value ? "selected" : ""}>${k.label}</option>`
              ).join("")}
            </select>
            <span class="field__hint" data-kind-hint></span>
          </label>

          <label class="field">
            <span class="field__label">课程</span>
            <select class="select" data-course>
              <option value="">不指定</option>
              ${COURSES.map(
                (c) => `<option value="${esc(c)}" ${work?.course === c ? "selected" : ""}>${esc(c)}</option>`
              ).join("")}
            </select>
          </label>

          <label class="field">
            <span class="field__label">学期</span>
            <select class="select" data-term>
              <option value="">不指定</option>
              ${TERMS.map(
                (t) => `<option value="${esc(t)}" ${work?.term === t ? "selected" : ""}>${esc(t)}</option>`
              ).join("")}
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field__label">标题</span>
          <input class="input" data-title maxlength="80" placeholder="例如：『接诉即办』中的注意力分配"
            value="${esc(work?.title || "")}" />
        </label>

        <div class="work-form__grid work-form__grid--2">
          <label class="field">
            <span class="field__label">小组名称（可选）</span>
            <input class="input" data-group maxlength="40" placeholder="第 3 组"
              value="${esc(work?.groupName || "")}" />
          </label>
          <label class="field">
            <span class="field__label">组员（可选）</span>
            <input class="input" data-members maxlength="300" placeholder="张三、李四、王五"
              value="${esc(work?.members || "")}" />
          </label>
        </div>

        <label class="field">
          <span class="field__label">说明（可选）</span>
          <textarea class="textarea" data-summary rows="4"
            placeholder="这份材料想回答什么问题、用了什么材料、有没有要特别说明的地方。支持简单的 Markdown。">${esc(work?.summary || "")}</textarea>
        </label>

        <section class="work-form__section">
          <div class="work-form__section-head">
            <span class="field__label">附件</span>
            <span class="meta mono" data-file-count>0 / ${MAX_FILES}</span>
          </div>
          <ul class="work-file-list" data-file-list></ul>
          <label class="btn btn--quiet btn--sm work-form__pick">
            ＋ 选择文件
            <input type="file" accept="${ACCEPT}" multiple hidden data-file />
          </label>
          <p class="field__hint">
            只收 <b>Word（.docx / .doc）</b>与 <b>PDF（.pdf）</b>，单个不超过 ${MAX_FILE_MB}MB，最多 ${MAX_FILES} 个。
            课件请先在 PowerPoint 里另存为 PDF——站点不转格式，PDF 才能直接翻页看。
            也可以直接把文件拖到这个页面里。
          </p>
        </section>

        <section class="work-form__section">
          <div class="work-form__section-head">
            <span class="field__label">在线文档链接（可选）</span>
            <span class="meta mono" data-link-count></span>
          </div>
          <div class="work-link-list" data-link-list></div>
          <button class="btn btn--quiet btn--sm" type="button" data-add-link>＋ 添加链接</button>
          <p class="field__hint">飞书、腾讯文档、网盘都行。链接只登记不抓取，教师点开自己看。</p>
        </section>

        <footer class="work-form__foot">
          <span class="field__hint" data-status></span>
          <div class="work-form__actions">
            <button class="btn btn--quiet btn--sm" type="button" data-cancel>取消</button>
            <button class="btn btn--primary" type="button" data-submit>
              ${editing ? "保存并重交" : "提交"}
            </button>
          </div>
        </footer>
      </form>
    </main>
  `;
}
