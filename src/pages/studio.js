/** 协作工作台 —— 对话检索 + 梗概撰写 + 提交 */
import { esc, el, qs, toast, zhLength, debounce, mountReveal } from "../lib/dom.js";
import { streamChat, cases as casesApi } from "../lib/api.js";
import { getState } from "../lib/store.js";

const DOMAINS = [
  "数字治理",
  "营商环境",
  "基层治理",
  "公共服务",
  "生态治理",
  "乡村振兴",
  "社会组织",
  "政务公开",
  "应急管理",
  "城市更新",
];

const WORD_MIN = 1000;
const WORD_MAX = 1500;
const LINK_LIMIT = 15;

/** 把上传的文件读成纯文本：docx 走 mammoth，其余按文本读 */
async function readFileAsText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) {
    // 按需加载，只有真的导入 Word 时才把这部分代码取下来
    const mammoth = (await import("mammoth")).default;
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToMarkdown({ arrayBuffer: buffer });
    return (result.value || "").replace(/\r\n/g, "\n").trim();
  }
  if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")) {
    return (await file.text()).replace(/\r\n/g, "\n").trim();
  }
  throw new Error("只支持 .md / .markdown / .txt / .docx");
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function studioSection() {
  return `
    <section id="studio" class="screen studio" aria-labelledby="studio-title">
      <div class="shell">
        <div class="screen-head reveal">
          <div class="screen-head__text">
            <div class="screen-ordinal">02 / 协作</div>
            <h2 id="studio-title">与模型协作，梳理地方创新案例</h2>
            <p class="lede">
              从身边新闻中挖掘灵感，与模型一起检索、追问、核对；最终一起打磨一份案例梗概；
              润色到你满意后再行提交。
            </p>
          </div>
          <ol class="studio__steps">
            <li><span class="mono">01</span> 贴上来源</li>
            <li><span class="mono">02</span> 追问细节</li>
            <li><span class="mono">03</span> 定稿提交</li>
          </ol>
        </div>

        <div class="studio__grid">
          <div class="studio__chat card card--flush reveal">
            <header class="chat__head">
              <div class="chat__head-left">
                <span class="dot-live" aria-hidden="true"></span>
                <span class="chat__title">检索与对话</span>
              </div>
              <span class="chat__limit mono" data-link-counter>0 / ${LINK_LIMIT} 链接</span>
            </header>

            <div class="chat__log" data-chat-log role="log" aria-live="polite"></div>

            <div class="chat__composer">
              <div class="chat__attachments" data-attachments hidden></div>
              <textarea
                class="textarea chat__input"
                data-chat-input
                rows="3"
                placeholder="例如：https://www.zj.gov.cn/… 这是我们课上讲的浙江「最多跑一次」，帮我查一下最新的推进情况和具体做法。"
              ></textarea>
              <div class="chat__composer-bar">
                <div class="flex items-center gap-2">
                  <label class="chat__attach" title="上传图片或文档">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,.md,.markdown,.txt,.docx"
                      multiple
                      hidden
                      data-chat-file
                    />
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M9.5 4.5L5 9a2.1 2.1 0 003 3l4.8-4.8a3.2 3.2 0 00-4.5-4.5L3.5 7.5a4.3 4.3 0 006 6l3.6-3.6"
                        fill="none" stroke="currentColor" stroke-width="1.2"
                        stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </label>
                  <span class="field__hint" data-chat-hint>可粘贴链接，或上传图片与文档</span>
                </div>
                <div class="flex items-center gap-2">
                  <button class="btn btn--quiet btn--sm" data-chat-reset type="button">重开</button>
                  <button class="btn btn--primary btn--sm" data-chat-send type="button">
                    发送
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside class="studio__draft card reveal" aria-label="案例梗概编辑器">
            <header class="draft__head">
              <div>
                <div class="eyebrow">Draft</div>
                <h3 class="h3">案例梗概</h3>
              </div>
              <div class="draft__head-actions">
                <label class="btn btn--quiet btn--sm" for="draft-file">
                  导入文件
                  <input
                    id="draft-file"
                    type="file"
                    accept=".md,.markdown,.txt,.docx"
                    data-file-input
                    hidden
                  />
                </label>
                <button class="btn btn--gold btn--sm" data-draft-generate type="button">
                  从对话生成
                </button>
              </div>
            </header>

            <div class="draft__body">
              <label class="field">
                <span class="field__label">标题</span>
                <input class="input" data-draft-title maxlength="60" placeholder="一句话说清这个创新做了什么" />
              </label>

              <div class="draft__row draft__row--3">
                <label class="field">
                  <span class="field__label">省 / 自治区</span>
                  <select class="select" data-draft-province>
                    <option value="">请选择</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">市 / 地区</span>
                  <select class="select" data-draft-city>
                    <option value="">请选择</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">区 / 县</span>
                  <select class="select" data-draft-district>
                    <option value="">请选择</option>
                  </select>
                </label>
              </div>
              <p class="field__hint" data-geo-hint>
                选到区县后，光点会落在该区县中心；案例积累多时这一级决定能否在地图上分清。
              </p>

              <div class="field">
                <span class="field__label">创新领域</span>
                <div class="draft__tags" data-draft-tags>
                  ${DOMAINS.map(
                    (d) =>
                      `<button type="button" class="chip" data-domain="${esc(d)}">${esc(d)}</button>`
                  ).join("")}
                </div>
              </div>

              <label class="field">
                <span class="field__label">正文</span>
                <textarea
                  class="textarea draft__text"
                  data-draft-body
                  rows="12"
                  placeholder="从改革的起因、具体动作、推进方式写到效果与争议。"
                ></textarea>
              </label>

              <div class="draft__meter">
                <div class="draft__meter-bar"><span data-word-bar></span></div>
                <span class="draft__meter-text mono" data-word-count>0 字</span>
              </div>

              <div class="field">
                <span class="field__label">来源链接</span>
                <div class="draft__sources" data-draft-sources></div>
                <button class="btn btn--quiet btn--sm" data-add-source type="button">
                  + 添加来源
                </button>
              </div>

              <div class="draft__actions">
                <span class="field__hint" data-draft-status></span>
                <button class="btn btn--primary" data-draft-submit type="button">提交作品</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `;
}

export function mountStudio(root) {
  const section = qs("#studio", root);
  if (!section) return;

  const log = qs("[data-chat-log]", section);
  const input = qs("[data-chat-input]", section);
  const sendBtn = qs("[data-chat-send]", section);
  const hint = qs("[data-chat-hint]", section);
  const linkCounter = qs("[data-link-counter]", section);

  /** @type {{role:string, content:string, sources?:any[]}[]} */
  let history = [];
  let busy = false;
  let abort = null;

  /* —————— 对话区的附件 —————— */

  const filePicker = qs("[data-chat-file]", section);
  const attachBar = qs("[data-attachments]", section);
  const IMAGE_LIMIT = 3;
  /** @type {{type:'image'|'doc', name:string, url?:string}[]} */
  const attachments = [];

  function renderAttachments() {
    if (!attachments.length) {
      attachBar.hidden = true;
      attachBar.replaceChildren();
      return;
    }
    attachBar.hidden = false;
    attachBar.innerHTML = attachments
      .map((a, i) =>
        a.type === "image"
          ? `<div class="attachment">
               <img src="${a.url}" alt="${esc(a.name)}" />
               <button type="button" data-del="${i}" aria-label="移除">×</button>
             </div>`
          : `<div class="attachment attachment--doc">
               <span>${esc(a.name)}</span>
               <button type="button" data-del="${i}" aria-label="移除">×</button>
             </div>`
      )
      .join("");
    attachBar.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        attachments.splice(Number(btn.dataset.del), 1);
        renderAttachments();
      });
    });
  }

  function clearAttachments() {
    attachments.length = 0;
    renderAttachments();
  }

  filePicker.addEventListener("change", async () => {
    const files = Array.from(filePicker.files || []);
    filePicker.value = "";
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        if (attachments.filter((a) => a.type === "image").length >= IMAGE_LIMIT) {
          toast(`最多 ${IMAGE_LIMIT} 张图片`, { type: "error" });
          break;
        }
        if (file.size > 3 * 1024 * 1024) {
          toast("单张图片不超过 3MB", { type: "error" });
          continue;
        }
        try {
          attachments.push({ type: "image", name: file.name, url: await readFileAsDataURL(file) });
        } catch {
          toast("图片读取失败", { type: "error" });
        }
      } else {
        // 文档内容直接接到输入框，学生看得见、改得动
        try {
          const text = await readFileAsText(file);
          if (!text) {
            toast("文件里没有可读取的文字", { type: "error" });
            continue;
          }
          input.value = (input.value ? `${input.value}\n\n` : "") + text;
          updateLinkCounter();
        } catch (err) {
          toast(err.message || "文件读取失败", { type: "error" });
        }
      }
    }
    renderAttachments();
  });

  const extractLinks = (text) =>
    Array.from(new Set((text.match(/https?:\/\/[^\s)）"'，。]+/g) || []))).slice(0, LINK_LIMIT);

  function updateLinkCounter() {
    const n = extractLinks(input.value).length;
    linkCounter.textContent = `${n} / ${LINK_LIMIT} 链接`;
    linkCounter.classList.toggle("is-over", n >= LINK_LIMIT);
  }
  input.addEventListener("input", updateLinkCounter);

  // marked + DOMPurify 只在对话区用得到，按需加载，不进主包
  let renderMd = null;
  import("../lib/markdown.js")
    .then((m) => {
      renderMd = m.renderMarkdown;
    })
    .catch(() => {
      /* 加载失败就退回纯文本 */
    });

  /** 渲染消息正文：模型输出是 Markdown，必须渲染，否则 **加粗** 会原样显示 */
  function paintMessage(node, text) {
    if (!node) return;
    if (renderMd) {
      node.innerHTML = renderMd(text);
      node.classList.add("msg__text--md");
    } else {
      node.textContent = text;
    }
  }

  function addMessage(role, content = "", sources = null) {
    const node = el("div", { class: `msg msg--${role}` });
    node.innerHTML = `
      ${role === "assistant" ? `<div class="msg__avatar" aria-hidden="true">模</div>` : ""}
      <div class="msg__bubble">
        <div class="msg__text"></div>
        ${
          sources
            ? `<div class="msg__sources">${sources
                .map(
                  (s) =>
                    `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(
                      s.title
                    )}</a>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
    `;
    const textNode = node.querySelector(".msg__text");
    paintMessage(textNode, content);
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return textNode;
  }

  function addTyping() {
    const node = el("div", { class: "msg msg--assistant" });
    node.innerHTML = `
      <div class="msg__avatar" aria-hidden="true">模</div>
      <div class="msg__bubble msg__bubble--typing"><span></span><span></span><span></span></div>
    `;
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function welcome() {
    log.innerHTML = "";
    addMessage(
      "assistant",
      "把新闻链接贴进来，或者直接说你想写的创新点。我会先核对这件事的基本事实——谁在做、从什么时候开始、具体动作是什么——再帮你补上背景与争议。\n\n准备得差不多了，点右上角「从对话生成」，我会整理成一份 1000–1500 字的梗概初稿。"
    );
  }

  async function send() {
    const value = input.value.trim();
    // 允许只发图片不带文字
    if ((!value && !attachments.length) || busy) return;
    const links = extractLinks(value);
    if (links.length > LINK_LIMIT) {
      toast(`链接最多 ${LINK_LIMIT} 个`, { type: "error" });
      return;
    }

    const images = attachments.map((a) => a.url);
    const userTextNode = addMessage("user", value || "（见附图）");
    if (images.length) {
      const bubble = userTextNode.closest(".msg__bubble");
      images.forEach((url) => bubble.append(el("img", { src: url, class: "msg__image" })));
    }

    history.push({
      role: "user",
      content: value || "（见附图）",
      ...(images.length ? { images } : {}),
    });
    input.value = "";
    clearAttachments();
    updateLinkCounter();
    busy = true;
    sendBtn.disabled = true;
    const typing = addTyping();

    let textNode = null;
    let thinkingNode = null;
    let acc = "";
    abort = new AbortController();

    const dropThinking = () => {
      thinkingNode?.closest(".msg")?.remove();
      thinkingNode = null;
    };

    try {
      await streamChat({
        messages: history,
        signal: abort.signal,
        onMeta: (meta) => {
          // 思考模式：模型先思考十几秒才吐正文，先给个状态提示
          if (meta?.thinking && !textNode && !thinkingNode) {
            typing.remove();
            thinkingNode = addMessage("assistant", "正在梳理思路…");
            thinkingNode.closest(".msg__bubble")?.classList.add("msg__bubble--thinking");
            log.scrollTop = log.scrollHeight;
          }
          if (meta?.sources?.length) {
            const host = textNode || thinkingNode;
            if (host) {
              const box = el("div", {
                class: "msg__sources",
                html: meta.sources
                  .map(
                    (s) =>
                      `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(
                        s.title
                      )}</a>`
                  )
                  .join(""),
              });
              host.closest(".msg__bubble")?.append(box);
            }
          }
        },
        onDelta: (_, full) => {
          acc = full;
          if (!textNode) {
            typing.remove();
            dropThinking();
            textNode = addMessage("assistant", "");
          }
          paintMessage(textNode, full);
          log.scrollTop = log.scrollHeight;
        },
      });
      history.push({ role: "assistant", content: acc });
      if (!acc) {
        typing.remove();
        textNode = addMessage(
          "assistant",
          "模型没有返回内容。请稍后重试，或把新闻正文直接粘贴进来。"
        );
      }
    } catch (err) {
      typing.remove();
      dropThinking();
      if (err.name !== "AbortError") {
        const node = addMessage(
          "assistant",
          `对话服务暂时不可用：${err.message || "未知错误"}。\n\n你仍然可以自己在右侧撰写梗概并提交。`
        );
        node.parentElement.classList.add("msg__bubble--warn");
      }
    } finally {
      busy = false;
      sendBtn.disabled = false;
      abort = null;
      hint.textContent = `支持粘贴新闻链接，最多 ${LINK_LIMIT} 个`;
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  });
  qs("[data-chat-reset]", section).addEventListener("click", () => {
    abort?.abort();
    history = [];
    busy = false;
    sendBtn.disabled = false;
    welcome();
  });

  welcome();

  /* —————————— 编辑器 —————————— */

  const titleInput = qs("[data-draft-title]", section);
  const provinceSel = qs("[data-draft-province]", section);
  const citySel = qs("[data-draft-city]", section);
  const districtSel = qs("[data-draft-district]", section);
  const bodyInput = qs("[data-draft-body]", section);
  const wordCount = qs("[data-word-count]", section);
  const wordBar = qs("[data-word-bar]", section);
  const tagBox = qs("[data-draft-tags]", section);
  const sourceBox = qs("[data-draft-sources]", section);
  const statusText = qs("[data-draft-status]", section);

  const draft = { tags: new Set(), sources: [] };

  const geo = { provinces: [], cities: [], districts: [] };
  fetch("/data/cities.json")
    .then((r) => r.json())
    .then((data) => {
      geo.provinces = data.provinces || [];
      geo.cities = data.cities || [];
      geo.districts = data.districts || [];
      provinceSel.innerHTML =
        `<option value="">请选择</option>` +
        geo.provinces
          .map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`)
          .join("");
    })
    .catch(() => {
      provinceSel.innerHTML = `<option value="">数据加载失败</option>`;
    });

  /** 重置某个下拉为「请选择」占位 */
  function resetSelect(select, placeholder = "请选择") {
    select.innerHTML = `<option value="">${placeholder}</option>`;
    select.value = "";
  }

  provinceSel.addEventListener("change", () => {
    const name = provinceSel.value;
    if (!name) {
      resetSelect(citySel);
      resetSelect(districtSel);
      return;
    }
    const list = geo.cities.filter((c) => c.province === name);
    citySel.innerHTML =
      `<option value="">请选择</option>` +
      list.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
    resetSelect(districtSel);
    districtSel.innerHTML = `<option value="">请先选市</option>`;
  });

  citySel.addEventListener("change", () => {
    const province = provinceSel.value;
    const city = citySel.value;
    if (!city) {
      resetSelect(districtSel);
      return;
    }
    const list = geo.districts.filter((d) => d.province === province && d.city === city);
    districtSel.innerHTML =
      `<option value="">${list.length ? "可选" : "暂无区县数据"}</option>` +
      list.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("");
    districtSel.value = "";
  });

  function updateWords() {
    const n = zhLength(bodyInput.value);
    wordCount.textContent = `${n} 字`;
    const ratio = Math.min(1, n / WORD_MAX);
    wordBar.style.width = `${ratio * 100}%`;
    const ok = n >= WORD_MIN && n <= WORD_MAX;
    wordBar.dataset.state = ok ? "ok" : n > WORD_MAX ? "over" : "under";
    wordCount.dataset.state = wordBar.dataset.state;
  }
  bodyInput.addEventListener("input", updateWords);
  updateWords();

  tagBox.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-domain]");
    if (!chip) return;
    const value = chip.dataset.domain;
    if (draft.tags.has(value)) {
      draft.tags.delete(value);
      chip.classList.remove("is-on");
    } else {
      if (draft.tags.size >= 3) {
        toast("最多选择 3 个领域标签", { type: "error" });
        return;
      }
      draft.tags.add(value);
      chip.classList.add("is-on");
    }
  });

  function renderSources() {
    if (!draft.sources.length) {
      sourceBox.innerHTML = `<div class="field__hint">尚未添加来源。建议至少 1 条可验证的公开报道。</div>`;
      return;
    }
    sourceBox.innerHTML = draft.sources
      .map(
        (s, i) => `
      <div class="source-row">
        <input class="input" value="${esc(s.url)}" data-source-url="${i}" placeholder="https://" />
        <button class="btn btn--quiet btn--sm" data-source-del="${i}" type="button" aria-label="移除">×</button>
      </div>
    `
      )
      .join("");
    sourceBox.querySelectorAll("[data-source-url]").forEach((node) => {
      node.addEventListener("input", () => {
        draft.sources[Number(node.dataset.sourceUrl)].url = node.value.trim();
      });
    });
    sourceBox.querySelectorAll("[data-source-del]").forEach((node) => {
      node.addEventListener("click", () => {
        draft.sources.splice(Number(node.dataset.sourceDel), 1);
        renderSources();
      });
    });
  }
  renderSources();

  qs("[data-add-source]", section).addEventListener("click", () => {
    if (draft.sources.length >= LINK_LIMIT) {
      toast(`来源最多 ${LINK_LIMIT} 条`, { type: "error" });
      return;
    }
    draft.sources.push({ url: "" });
    renderSources();
  });

  /* —————————— 文件导入 —————————— */

  const fileInput = qs("[data-file-input]", section);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast("文件超过 5MB，请先在本地精简", { type: "error" });
      return;
    }

    const name = file.name.toLowerCase();
    const stem = file.name.replace(/\.[^.]+$/, "");
    statusText.textContent = "正在读取文件…";
    statusText.dataset.state = "";

    try {
      const text = await readFileAsText(file);
      if (!text) throw new Error("文件里没有可读取的文字");

      // 正文已有内容时追问，避免默默覆盖
      if (zhLength(bodyInput.value) > 60) {
        const ok = window.confirm("编辑器里已有正文，导入会覆盖它。继续吗？");
        if (!ok) {
          statusText.textContent = "";
          return;
        }
      }

      bodyInput.value = text;
      if (!titleInput.value.trim() && stem) titleInput.value = stem.slice(0, 60);

      // 文首若是 Markdown 一级标题，顺手提为标题
      const heading = text.match(/^#\s+(.+)$/m);
      if (heading && !titleInput.value.trim()) titleInput.value = heading[1].slice(0, 60);

      updateWords();
      statusText.textContent = `已导入 ${zhLength(text)} 字，请检查段落与来源`;
      statusText.dataset.state = zhLength(text) >= WORD_MIN ? "ok" : "";
      toast("文件已导入");
    } catch (err) {
      statusText.textContent = err.message || "读取失败";
      statusText.dataset.state = "err";
      toast(err.message || "文件读取失败", { type: "error" });
    }
  });

  // 从对话里提取链接，自动补进来源
  function harvestLinks() {
    const all = history.map((m) => m.content).join("\n");
    const found = extractLinks(all);
    let added = 0;
    for (const url of found) {
      if (draft.sources.length >= LINK_LIMIT) break;
      if (draft.sources.some((s) => s.url === url)) continue;
      draft.sources.push({ url });
      added += 1;
    }
    if (added) {
      renderSources();
      toast(`从对话中提取了 ${added} 条来源`);
    }
    return added;
  }

  qs("[data-draft-generate]", section).addEventListener("click", async () => {
    harvestLinks();
    if (!history.length) {
      toast("先和模型聊几句，再生成初稿", { type: "error" });
      return;
    }
    const btn = qs("[data-draft-generate]", section);
    btn.disabled = true;
    statusText.textContent = "正在整理…";
    try {
      const res = await fetch("/api/chat/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: history }),
      });
      if (!res.ok) throw new Error("提取服务不可用");
      const data = await res.json();
      const d = data?.data || data;
      if (d?.title) titleInput.value = d.title;
      if (d?.body) bodyInput.value = d.body;
      if (d?.province) {
        provinceSel.value = d.province;
        provinceSel.dispatchEvent(new Event("change"));
        if (d.city) {
          citySel.value = d.city;
          citySel.dispatchEvent(new Event("change"));
          if (d.district) districtSel.value = d.district;
        }
      }
      for (const t of d?.domains || []) {
        const chip = tagBox.querySelector(`[data-domain="${CSS.escape(t)}"]`);
        if (chip && !draft.tags.has(t)) {
          draft.tags.add(t);
          chip.classList.add("is-on");
        }
      }
      updateWords();
      statusText.textContent = "已生成初稿，请据此修改";
      toast("初稿已生成，记得逐句核对事实");
    } catch (err) {
      statusText.textContent = "";
      toast(err.message || "生成失败", { type: "error" });
    } finally {
      btn.disabled = false;
    }
  });

  const validate = () => {
    const problems = [];
    if (!titleInput.value.trim()) problems.push("标题");
    if (!provinceSel.value) problems.push("省份");
    const n = zhLength(bodyInput.value);
    if (n < WORD_MIN) problems.push(`正文需满 ${WORD_MIN} 字（当前 ${n}）`);
    // 上限只作提示不阻断：字数条会转色提醒，但不拦提交
    if (!draft.tags.size) problems.push("至少 1 个领域标签");
    const validSources = draft.sources.filter((s) => /^https?:\/\//.test(s.url));
    if (!validSources.length) problems.push("至少 1 条有效来源链接");
    if (validSources.length > LINK_LIMIT) problems.push(`来源不超过 ${LINK_LIMIT} 条`);
    return { problems, validSources };
  };

  qs("[data-draft-submit]", section).addEventListener("click", async () => {
    const { problems, validSources } = validate();
    if (problems.length) {
      statusText.textContent = problems[0];
      statusText.dataset.state = "err";
      toast(`还差：${problems[0]}`, { type: "error" });
      return;
    }

    // 区县决定光点落点精度，没选就提醒一次，学生可以坚持提交
    if (!districtSel.value && districtSel.options.length > 1) {
      statusText.textContent = "建议先选到区县，光点才能落准位置";
      statusText.dataset.state = "err";
      districtSel.focus();
      const proceed = window.confirm(
        "还没有选择区县，光点会落到市中心位置，同城多个案例容易叠在一起。\n\n确定就这样提交吗？"
      );
      if (!proceed) return;
    }
    const user = getState().user;
    if (!user) {
      toast("请先登录再提交");
      window.location.hash = "/login";
      return;
    }

    const submitBtn = qs("[data-draft-submit]", section);
    submitBtn.disabled = true;
    statusText.textContent = "提交中…";
    statusText.dataset.state = "";

    const province = geo.provinces.find((p) => p.name === provinceSel.value);
    const city = geo.cities.find(
      (c) => c.province === provinceSel.value && c.name === citySel.value
    );
    const district = geo.districts.find(
      (d) =>
        d.province === provinceSel.value &&
        d.city === citySel.value &&
        d.name === districtSel.value
    );
    // 精度优先：区县 > 地级市 > 省
    const point = district || city || province;

    try {
      const result = await casesApi.create({
        title: titleInput.value.trim(),
        province: provinceSel.value,
        city: citySel.value || "",
        district: districtSel.value || "",
        lng: point?.lng,
        lat: point?.lat,
        domains: [...draft.tags],
        body: bodyInput.value,
        sources: validSources.map((s) => ({ url: s.url })),
      });

      const published = result?.status === "published";

      if (published) {
        statusText.textContent = result.warnings?.length
          ? `已发布。提示：${result.warnings[0]}`
          : "已通过质检，已发布到地图";
        statusText.dataset.state = "ok";
        toast(result.warnings?.length ? "已发布，但篇幅偏长" : "案例已发布，地图上可以看到它了");
        titleInput.value = "";
        bodyInput.value = "";
        draft.tags.clear();
        tagBox.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-on"));
        draft.sources = [];
        renderSources();
        updateWords();
      } else {
        // 未通过时保留内容，方便学生按提示就地修改
        const reason =
          (result?.problems && result.problems[0]) || result?.review || "未通过自动质检";
        statusText.textContent = `未通过质检：${reason}`;
        statusText.dataset.state = "err";
        toast("质检未通过，按提示修改后可重新提交", { type: "error" });
      }
    } catch (err) {
      statusText.textContent = err.message || "提交失败";
      statusText.dataset.state = "err";
    } finally {
      submitBtn.disabled = false;
    }
  });

  const revalidate = debounce(() => {
    if (statusText.dataset.state === "err" && !validate().problems.length) {
      statusText.textContent = "";
      statusText.dataset.state = "";
    }
  }, 400);
  [titleInput, bodyInput, provinceSel, citySel, districtSel].forEach((n) =>
    n.addEventListener("input", revalidate)
  );
  tagBox.addEventListener("click", revalidate);

  mountReveal(section);
}
