/** 调研足迹的编写与编辑：Markdown 分栏、插图、草稿 */
import { esc, toast, zhWords, debounce, confirmDialog } from "../lib/dom.js";
import { surveys as surveysApi, surveyImages } from "../lib/api.js";
import { renderProse } from "../lib/markdown.js";
import { compressImage } from "../lib/image.js";

const MAX_IMAGES = 9;
const MIN_CHARS = 80; // 与服务端一致：按原始字符数判，不看 zhWords
const draftKey = (id) => `field:draft:${id || "new"}`;

const IMAGE_REF_RE = /!\[([^\]]*)\]\((\/api\/survey-images\/[A-Za-z0-9_]+)\)/g;

/* ————————— 编辑器 ————————— */

export async function mountSurveyEditor(root, id = "") {
  let survey = null;
  if (id) {
    root.innerHTML = `<div class="shell shell-narrow detail__loading">
      <div class="skeleton" style="height:44px;width:50%"></div>
      <div class="skeleton" style="height:320px;margin-top:20px"></div>
    </div>`;
    try {
      survey = await surveysApi.detail(id);
    } catch {
      survey = null;
    }
    if (!survey) {
      root.innerHTML = `<div class="shell shell-narrow empty">
        <div class="screen-ordinal">打不开</div>
        <h1 class="h2" style="margin:12px 0 16px">这条记录不在了</h1>
        <a class="btn btn--ghost btn--sm" href="#field">回到调研足迹</a>
      </div>`;
      return;
    }
  }

  root.innerHTML = editorHtml(survey);
  const page = root.querySelector("[data-editor]");

  /* —— 地区选择 —— */
  const provinceSel = page.querySelector("[data-province]");
  const citySel = page.querySelector("[data-city]");
  const districtSel = page.querySelector("[data-district]");
  const geo = { provinces: [], cities: [], districts: [] };

  const fillCities = (province, keep) => {
    const list = geo.cities.filter((c) => c.province === province);
    citySel.innerHTML =
      `<option value="">${list.length ? "请选择" : "暂无数据"}</option>` +
      list.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
    citySel.value = keep || "";
    citySel.disabled = !list.length;
  };

  const fillDistricts = (province, city, keep) => {
    const list = geo.districts.filter((d) => d.province === province && d.city === city);
    districtSel.innerHTML =
      `<option value="">${list.length ? "可选" : "暂无区县数据"}</option>` +
      list.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("");
    districtSel.value = keep || "";
  };

  try {
    const data = await (await fetch("/data/cities.json")).json();
    geo.provinces = data.provinces || [];
    geo.cities = data.cities || [];
    geo.districts = data.districts || [];
    provinceSel.innerHTML =
      `<option value="">请选择</option>` +
      geo.provinces.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
    provinceSel.disabled = false;

    if (survey) {
      provinceSel.value = survey.province || "";
      fillCities(survey.province, survey.city);
      fillDistricts(survey.province, survey.city, survey.district);
    }
  } catch {
    provinceSel.innerHTML = `<option value="">地区数据加载失败</option>`;
    toast("地区数据没加载出来，地点可以稍后再补", { type: "error" });
  }

  provinceSel.addEventListener("change", () => {
    fillCities(provinceSel.value, "");
    fillDistricts(provinceSel.value, "", "");
  });
  citySel.addEventListener("change", () => fillDistricts(provinceSel.value, citySel.value, ""));

  /* —— 字段 —— */
  const titleInput = page.querySelector("[data-title]");
  const visitedInput = page.querySelector("[data-visited]");
  const bodyInput = page.querySelector("[data-body]");
  const preview = page.querySelector("[data-preview]");
  const counters = page.querySelector("[data-counters]");
  const gallery = page.querySelector("[data-gallery]");
  const draftBar = page.querySelector("[data-draft-bar]");
  const submitBtn = page.querySelector("[data-submit]");
  const statusEl = page.querySelector("[data-status]");

  const initial = {
    title: survey?.title || "",
    province: survey?.province || "",
    city: survey?.city || "",
    district: survey?.district || "",
    visitedAt: survey?.visitedAt || "",
    body: survey?.body || "",
  };

  titleInput.value = initial.title;
  visitedInput.value = initial.visitedAt;
  bodyInput.value = initial.body;

  let dirty = false;
  const markDirty = () => {
    dirty = true;
    page.dataset.dirty = "1";
  };

  const readFields = () => ({
    title: titleInput.value.trim(),
    province: provinceSel.value,
    city: citySel.value,
    district: districtSel.value,
    visitedAt: visitedInput.value,
    body: bodyInput.value,
  });

  const sameAsInitial = () => {
    const now = readFields();
    return Object.keys(initial).every((k) => (now[k] || "") === (initial[k] || ""));
  };

  /* —— 预览与计数 —— */
  const refreshCounters = () => {
    const text = bodyInput.value;
    const words = zhWords(text);
    const photos = countImages(text);
    counters.innerHTML = `
      <span data-count-words class="${text.trim().length < MIN_CHARS ? "is-short" : ""}">
        正文 ${words} 字${text.trim().length < MIN_CHARS ? `（至少 ${MIN_CHARS} 字符）` : ""}
      </span>
      <span>${photos} / ${MAX_IMAGES} 张照片</span>
    `;
  };

  const refreshPreview = () => {
    const html = renderProse(bodyInput.value);
    preview.innerHTML = html || `<p class="editor__empty">左边写，这里出排版。</p>`;
  };

  const refreshGallery = () => {
    const items = collectImages(bodyInput.value);
    gallery.hidden = !items.length;
    gallery.innerHTML = items.length
      ? `<div class="editor__gallery-head">
           <span class="eyebrow">已插入的照片</span>
           <span class="meta">点一张就能跳到它的图注，改说明或挪到末尾都在这里</span>
         </div>
         <div class="editor__gallery-strip">
           ${items
             .map(
               (item, i) => `
             <figure class="editor__thumb">
               <button class="editor__thumb-jump" type="button" data-thumb-jump="${i}"
                 title="跳到图注位置">
                 <img src="${esc(item.url)}" alt="${esc(item.alt)}" loading="lazy" />
               </button>
               <figcaption>
                 <span class="mono">${String(i + 1).padStart(2, "0")}</span>
                 ${esc(item.alt || "无图注")}
               </figcaption>
               <div class="editor__thumb-actions">
                 <button type="button" data-thumb-move="${i}" title="移到正文末尾">移到末尾</button>
                 <button type="button" data-thumb-remove="${i}" title="从正文移除">移除</button>
               </div>
             </figure>`
             )
             .join("")}
         </div>`
      : "";
  };

  const persistDraft = debounce(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(
        draftKey(id),
        JSON.stringify({ ...readFields(), savedAt: Date.now() })
      );
      const at = new Date();
      page.querySelector("[data-save-state]").textContent = `草稿已存在这台设备 · ${String(
        at.getHours()
      ).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    } catch {
      /* 隐私模式下写不进去，不影响发布 */
    }
  }, 900);

  const onInput = () => {
    markDirty();
    refreshCounters();
    refreshPreview();
    refreshGallery();
    persistDraft();
  };

  bodyInput.addEventListener("input", onInput);
  titleInput.addEventListener("input", () => {
    markDirty();
    persistDraft();
  });
  [provinceSel, citySel, districtSel, visitedInput].forEach((node) =>
    node.addEventListener("change", () => {
      markDirty();
      persistDraft();
    })
  );

  /* —— 工具栏 —— */
  const wrapInline = (before, after, placeholder = "文字") => {
    const { selectionStart: s, selectionEnd: e, value } = bodyInput;
    const picked = value.slice(s, e);
    const text = picked || placeholder;
    bodyInput.value = value.slice(0, s) + before + text + after + value.slice(e);
    bodyInput.focus();
    bodyInput.setSelectionRange(s + before.length, s + before.length + text.length);
    onInput();
  };

  const prefixLines = (prefix) => {
    const { selectionStart: s, selectionEnd: e, value } = bodyInput;
    const start = value.lastIndexOf("\n", Math.max(s - 1, 0)) + 1;
    const endIdx = value.indexOf("\n", e);
    const end = endIdx === -1 ? value.length : endIdx;
    const block = value.slice(start, end);
    const lines = block.split("\n");
    const filled = lines.filter((line) => line.trim());
    // 已经带前缀就取消，省得连点两次变成 "## ##"
    const allPrefixed = filled.length > 0 && filled.every((line) => line.startsWith(prefix));
    const next = lines
      .map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`))
      .join("\n");
    bodyInput.value = value.slice(0, start) + next + value.slice(end);
    bodyInput.focus();
    bodyInput.setSelectionRange(start + next.length, start + next.length);
    onInput();
  };

  const insertBlock = (text, caretOffset = null) => {
    const { selectionStart: s, selectionEnd: e, value } = bodyInput;
    const before = value.slice(0, s);
    const after = value.slice(e);
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const tail = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    const payload = lead + text + tail;
    bodyInput.value = before + payload + after;
    bodyInput.focus();
    const caret = caretOffset === null ? before.length + payload.length : before.length + caretOffset;
    bodyInput.setSelectionRange(caret, caret);
    onInput();
  };

  /**
   * 整理分段：把「只有单换行的一整片文字」拆成按空行分段的段落。
   * 纯文本账本式记录（时间 / 地点 / 对象 一行一条）转进来时最需要这一步。
   * 规则是死的：不碰代码块；同一类结构（连续列表项、连续引用行）之间不插空行，
   * 有序列表与无序列表算两类，免得「2. 组织架构」把下面的项目符号吞进去。
   */
  const tidyParagraphs = () => {
    const source = bodyInput.value.replace(/\r\n/g, "\n");
    if (!source.trim()) return;

    const familyOf = (line) => {
      const text = line.trim();
      if (/^[-*+]\s/.test(text)) return "bullet";
      if (/^\d+[.)]\s/.test(text)) return "ordered";
      if (/^>/.test(text)) return "quote";
      if (/^#{1,6}\s/.test(text)) return "heading";
      if (/^\|/.test(text)) return "table";
      return "";
    };

    const lines = source.split("\n");
    const out = [];
    let inFence = false;

    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      const prev = out.length ? out[out.length - 1] : null;
      const family = familyOf(line);
      const sameFamily = family !== "" && prev !== null && family === familyOf(prev);
      const needBlank =
        i > 0 && !inFence && prev !== null && prev.trim() !== "" && line.trim() !== "" && !sameFamily;
      if (needBlank) out.push("");
      out.push(line);
    });

    const next = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (next === bodyInput.value.trim()) {
      toast("看着已经分好了，不用再整");
      return;
    }
    bodyInput.value = next;
    bodyInput.focus();
    onInput();
    toast("已按空行分段，列表和引用没动");
  };

  page.querySelectorAll("[data-tool]").forEach((btn) => {    btn.addEventListener("click", () => {
      switch (btn.dataset.tool) {
        case "h2":
          prefixLines("## ");
          break;
        case "h3":
          prefixLines("### ");
          break;
        case "quote":
          prefixLines("> ");
          break;
        case "ul":
          prefixLines("- ");
          break;
        case "ol":
          prefixLines("1. ");
          break;
        case "bold":
          wrapInline("**", "**");
          break;
        case "italic":
          wrapInline("*", "*");
          break;
        case "link":
          wrapInline("[", "](https://)", "链接文字");
          break;
        case "hr":
          insertBlock("---");
          break;
        case "tidy":
          tidyParagraphs();
          break;
        case "image":
          filePicker.click();
          break;
        default:
          break;
      }
    });
  });

  /* —— 插图 —— */
  const filePicker = page.querySelector("[data-file]");
  const uploadNote = page.querySelector("[data-upload-note]");
  filePicker.addEventListener("change", () => {
    const files = Array.from(filePicker.files || []);
    filePicker.value = "";
    handleFiles(files);
  });

  const handleFiles = async (files) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      if (files.length) toast("只收照片，文档请直接粘贴文字", { type: "error" });
      return;
    }
    const room = MAX_IMAGES - countImages(bodyInput.value);
    if (room <= 0) {
      toast(`一篇里最多 ${MAX_IMAGES} 张照片`, { type: "error" });
      return;
    }
    const batch = images.slice(0, room);
    if (images.length > room) toast(`最多再放 ${room} 张，先传这些`, { type: "error" });

    for (let i = 0; i < batch.length; i += 1) {
      uploadNote.hidden = false;
      uploadNote.textContent =
        batch.length > 1 ? `正在处理第 ${i + 1} / ${batch.length} 张…` : "正在处理照片…";
      try {
        const { blob, width, height } = await compressImage(batch[i]);
        const result = await surveyImages.upload(blob, { width, height });
        insertImage(result.url);
      } catch (err) {
        toast(err.message || "这张图没传上去", { type: "error" });
      }
    }
    uploadNote.hidden = true;
  };

  /** 把图插在光标处，并把光标停在图注位置——直接打字就成图注 */
  const insertImage = (url) => {
    const alt = "照片说明";
    const { selectionStart: s, selectionEnd: e, value } = bodyInput;
    const before = value.slice(0, s);
    const after = value.slice(e);
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const tail = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    const payload = `${lead}![${alt}](${url})${tail}`;
    bodyInput.value = before + payload + after;
    bodyInput.focus();
    const altStart = before.length + lead.length + 2;
    bodyInput.setSelectionRange(altStart, altStart + alt.length);
    onInput();
  };

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
    handleFiles(Array.from(event.dataTransfer.files));
  });

  // 截图直接粘
  bodyInput.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.some((f) => f.type.startsWith("image/"))) return;
    event.preventDefault();
    handleFiles(files);
  });

  /* —— 照片条：移除与挪位 —— */
  gallery.addEventListener("click", (event) => {
    const jumpBtn = event.target.closest("[data-thumb-jump]");
    const removeBtn = event.target.closest("[data-thumb-remove]");
    const moveBtn = event.target.closest("[data-thumb-move]");
    if (jumpBtn) {
      const items = collectImages(bodyInput.value);
      const index = Number(jumpBtn.dataset.thumbJump);
      const item = items[index];
      if (!item) return;
      const start = bodyInput.value.indexOf(item.raw);
      if (start < 0) return;
      bodyInput.focus();
      // 图注就是方括号里那段，选中它，直接打字就替换了
      const altStart = start + 2;
      bodyInput.setSelectionRange(altStart, altStart + item.alt.length);
      bodyInput.scrollIntoView({ block: "center" });
    }
    if (removeBtn) {
      const items = collectImages(bodyInput.value);
      const item = items[Number(removeBtn.dataset.thumbRemove)];
      if (!item) return;
      const next = bodyInput.value.replace(item.raw, "").replace(/\n{3,}/g, "\n\n");
      bodyInput.value = next;
      toast("已从正文移除，保存后一并删掉");
      onInput();
    }
    if (moveBtn) {
      const items = collectImages(bodyInput.value);
      const item = items[Number(moveBtn.dataset.thumbMove)];
      if (!item) return;
      const rest = bodyInput.value.replace(item.raw, "").replace(/\n{3,}/g, "\n\n").trimEnd();
      bodyInput.value = `${rest}${rest ? "\n\n" : ""}${item.raw}\n`;
      toast("已挪到末尾");
      onInput();
    }
  });

  /* —— 预览/写作切换（窄屏） —— */
  page.querySelectorAll("[data-view-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      page.dataset.view = btn.dataset.viewBtn;
      page.querySelectorAll("[data-view-btn]").forEach((node) => {
        node.classList.toggle("is-on", node === btn);
      });
    });
  });

  /* —— 草稿恢复 —— */
  const saved = readDraft(id);
  if (saved && (saved.body || saved.title) && (saved.body !== initial.body || saved.title !== initial.title)) {
    const when = new Date(saved.savedAt || Date.now());
    draftBar.hidden = false;
    draftBar.innerHTML = `
      <span>这台设备上存着 ${String(when.getMonth() + 1)} 月 ${when.getDate()} 日的一份草稿，还没发布。</span>
      <span class="editor__draft-actions">
        <button class="btn btn--quiet btn--sm" type="button" data-draft-restore>接着写这份</button>
        <button class="btn btn--quiet btn--sm" type="button" data-draft-drop>丢掉</button>
      </span>
    `;
    draftBar.querySelector("[data-draft-restore]").addEventListener("click", () => {
      titleInput.value = saved.title || titleInput.value;
      visitedInput.value = saved.visitedAt || visitedInput.value;
      bodyInput.value = saved.body || bodyInput.value;
      if (saved.province) {
        provinceSel.value = saved.province;
        fillCities(saved.province, saved.city);
        fillDistricts(saved.province, saved.city, saved.district);
      }
      draftBar.hidden = true;
      markDirty();
      refreshCounters();
      refreshPreview();
      refreshGallery();
      toast("已接着上次的草稿");
    });
    draftBar.querySelector("[data-draft-drop]").addEventListener("click", () => {
      clearDraft(id);
      draftBar.hidden = true;
    });
  }

  /* —— 离开提醒 —— */
  const beforeUnload = (event) => {
    if (!dirty || !document.body.contains(page)) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", beforeUnload);

  /* —— 提交 —— */
  const submit = async () => {
    const fields = readFields();
    if (!fields.title) {
      toast("先给这次调研起个标题", { type: "error" });
      titleInput.focus();
      return;
    }
    if (!fields.province) {
      toast("选一下调研地点", { type: "error" });
      provinceSel.focus();
      return;
    }
    if (fields.body.trim().length < MIN_CHARS) {
      toast(`正文还差一点，至少写 ${MIN_CHARS} 个字符`, { type: "error" });
      bodyInput.focus();
      return;
    }

    const point =
      geo.districts.find(
        (d) =>
          d.province === fields.province && d.city === fields.city && d.name === fields.district
      ) ||
      geo.cities.find((c) => c.province === fields.province && c.name === fields.city) ||
      geo.provinces.find((p) => p.name === fields.province);

    submitBtn.disabled = true;
    statusEl.textContent = survey ? "保存中…" : "发布中…";
    statusEl.dataset.state = "";
    try {
      const payload = { ...fields, lng: point?.lng, lat: point?.lat };
      const result = survey
        ? await surveysApi.update(survey.id, payload)
        : await surveysApi.create(payload);
      dirty = false;
      clearDraft(id);
      toast(survey ? "改好了" : "已记录，谢谢你把这段路留下来");
      window.location.hash = `/field/${result.id || survey?.id}`;
    } catch (err) {
      statusEl.textContent = err.message || "没能保存";
      statusEl.dataset.state = "err";
    } finally {
      submitBtn.disabled = false;
    }
  };

  submitBtn.addEventListener("click", submit);
  page.querySelector("[data-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  page.querySelector("[data-cancel]")?.addEventListener("click", async () => {
    if (dirty && !sameAsInitial()) {
      const yes = await confirmDialog({
        title: "放弃这次的改动",
        html: `<p>还没保存的内容会留在本机草稿里，下次打开可以接着写。</p>`,
        confirmText: "离开",
      });
      if (!yes) return;
    }
    window.location.hash = survey ? `/field/${survey.id}` : "/field";
  });

  refreshCounters();
  refreshPreview();
  refreshGallery();
  bodyInput.focus({ preventScroll: true });

  document.title = survey ? `编辑 · ${survey.title}` : "记录一次调研";
}

/* ————————— 模板 ————————— */

function editorHtml(survey) {
  const editing = Boolean(survey);
  const stamp = survey ? (survey.updatedAt || survey.createdAt || "").slice(0, 10) : "";
  return `
    <form class="shell field-editor" data-editor data-view="write" novalidate data-form>
      <div class="field-editor__top">
        <a class="detail__back" href="${editing ? `#/field/${esc(survey.id)}` : "#field"}">
          ${editing ? "回到这条记录" : "回到调研足迹"}
        </a>
        <span class="field-editor__state mono" data-save-state>
          ${editing && stamp ? `上次保存于 ${esc(stamp)}` : "还没保存"}
        </span>
      </div>

      <div class="field-editor__draft" data-draft-bar hidden></div>

      <header class="field-editor__head">
        <input
          class="field-editor__title"
          data-title
          maxlength="80"
          placeholder="给这次调研起个标题"
          value="${esc(survey?.title || "")}"
          aria-label="标题"
        />

        <div class="field-editor__places">
          <label class="field field--tight">
            <span class="field__label">省 / 自治区</span>
            <select class="select" data-province disabled><option value="">加载中…</option></select>
          </label>
          <label class="field field--tight">
            <span class="field__label">市 / 地区</span>
            <select class="select" data-city disabled><option value="">先选省</option></select>
          </label>
          <label class="field field--tight">
            <span class="field__label">区 / 县</span>
            <select class="select" data-district disabled><option value="">先选市</option></select>
          </label>
          <label class="field field--tight">
            <span class="field__label">调研时间</span>
            <input class="input" data-visited type="month" value="${esc(survey?.visitedAt || "")}" />
          </label>
        </div>
      </header>

      <div class="field-editor__toolbar" role="toolbar" aria-label="排版工具">
        <div class="field-editor__toolgroup">
          <button class="tool" type="button" data-tool="h2" title="小标题">H2</button>
          <button class="tool" type="button" data-tool="h3" title="次级标题">H3</button>
          <button class="tool" type="button" data-tool="bold" title="加粗"><b>B</b></button>
          <button class="tool" type="button" data-tool="italic" title="斜体"><i>I</i></button>
          <button class="tool" type="button" data-tool="quote" title="引用">”</button>
          <button class="tool" type="button" data-tool="ul" title="无序列表">•</button>
          <button class="tool" type="button" data-tool="ol" title="有序列表">1.</button>
          <button class="tool" type="button" data-tool="link" title="链接">链</button>
          <button class="tool" type="button" data-tool="hr" title="分隔线">—</button>
          <button class="tool" type="button" data-tool="tidy"
            title="整理分段：把只有单换行的一整片文字按段落拆开">整理</button>
        </div>
        <div class="field-editor__toolgroup">
          <button class="tool tool--accent" type="button" data-tool="image" title="插入照片（也可以直接粘贴或拖进来）">
            ＋ 照片
          </button>
          <input type="file" accept="image/*" multiple hidden data-file />
        </div>
        <div class="field-editor__views">
          <button class="tool is-on" type="button" data-view-btn="write">写作</button>
          <button class="tool" type="button" data-view-btn="preview">预览</button>
        </div>
      </div>

      <div class="field-editor__panes">
        <div class="field-editor__pane field-editor__pane--write">
          <textarea
            class="field-editor__input"
            data-body
            spellcheck="false"
            placeholder="到那儿之后先看到什么，谁带你走的，问了谁、他怎么说，哪件事和你预想的不一样。

空一行分段。写完一段可以按「＋ 照片」插一张图，图的说明写在方括号里，会变成图注。"
          >${esc(survey?.body || "")}</textarea>
          <div class="field-editor__drop-note" aria-hidden="true">
            <span>把照片拖进来，或直接 Ctrl+V 粘贴截图</span>
          </div>
        </div>
        <div class="field-editor__pane field-editor__pane--preview">
          <div class="field-editor__preview-label eyebrow">预览</div>
          <div class="md field-editor__preview" data-preview></div>
        </div>
      </div>

      <div class="field-editor__gallery" data-gallery hidden></div>

      <footer class="field-editor__foot">
        <div class="field-editor__counters" data-counters></div>
        <div class="field-editor__status" data-status></div>
        <div class="field-editor__foot-actions">
          <button class="btn btn--quiet btn--sm" type="button" data-cancel>取消</button>
          <button class="btn btn--primary" type="button" data-submit>
            ${editing ? "保存修改" : "发布"}
          </button>
        </div>
      </footer>
      <div class="field-editor__upload mono" data-upload-note hidden></div>
    </form>
  `;
}

/* ————————— 小工具 ————————— */

function collectImages(text) {
  return Array.from(String(text || "").matchAll(IMAGE_REF_RE)).map((m) => ({
    raw: m[0],
    alt: m[1] || "",
    url: m[2],
  }));
}

function countImages(text) {
  return collectImages(text).length;
}

function readDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft(id) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* 忽略 */
  }
}
