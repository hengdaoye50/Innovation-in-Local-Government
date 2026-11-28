/**
 * 师生互联 —— 学生端。
 *
 * 两件事放在一页：一对一提问（私信往返），以及 office hour 预约申请。
 * 预约的日期与时段是服务端下发的固定档位（只在周三、周四），学生只填期望；
 * 具体时间由老师在后台批复时给出，所以这里只显示「待批复 / 已确认 + 老师给的时间」。
 */
import { esc, qs, qsa, toast, confirmDialog, timeAgo, mountReveal } from "../lib/dom.js";
import { questions as qaApi, officeHours as ohApi } from "../lib/api.js";
import { createCalendar, createSlotPicker } from "../components/calendar.js";
import { getState } from "../lib/store.js";

const THREAD_TAG = {
  open: { text: "待老师回复", cls: "tag--warn" },
  replied: { text: "老师已回复", cls: "tag--ok" },
};

const REQUEST_TAG = {
  pending: { text: "待批复", cls: "tag--warn" },
  confirmed: { text: "已确认", cls: "tag--ok" },
  declined: { text: "已婉拒", cls: "tag--quiet" },
  cancelled: { text: "已撤回", cls: "tag--quiet" },
  done: { text: "已完成", cls: "tag--quiet" },
};

/** 与服务端同一套展示口径：09:00 → 09:00–10:00 */
function slotLabel(slot) {
  const hour = Number(String(slot || "").slice(0, 2));
  if (!Number.isFinite(hour)) return String(slot || "");
  return `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`;
}

function dayLabelOf(days, value) {
  const hit = (days || []).find((d) => d.value === value);
  return hit ? hit.label : value;
}

export function mountConnect(root) {
  const user = getState().user;
  const readOnly = user?.role === "observer";

  root.innerHTML = `
    <main class="detail-page connect-page">
      <div class="shell connect">
        <header class="connect__head">
          <div class="screen-ordinal">06 / 互联</div>
          <h1 class="h2">师生互联</h1>
          <p class="lede">
            有问题直接写信给老师；想当面聊，就提交一次 office hour 申请，
            时间由老师批复后给出。
          </p>
        </header>

        ${
          readOnly
            ? `<div class="card connect__notice">观察员账号只能浏览，不能提问或预约。</div>`
            : ""
        }

        <section class="connect__block">
          <div class="connect__block-head">
            <div>
              <h2 class="h3">向老师提问</h2>
            </div>
            <span class="meta mono" data-thread-count></span>
          </div>

          ${
            readOnly
              ? ""
              : `<form class="card connect__form" data-ask-form>
                   <label class="field">
                     <span class="field__label">标题</span>
                     <input class="input" name="subject" maxlength="80" required
                       placeholder="例如：案例的「创新点」该怎么界定" />
                   </label>
                   <label class="field">
                     <span class="field__label">问题</span>
                     <textarea class="textarea" name="body" rows="5" maxlength="2000" required
                       placeholder="把背景、已经查到的、卡住的地方写清楚，老师回得更准"></textarea>
                   </label>
                   <div class="connect__form-foot">
                     <span class="meta">老师回复后会出现在下方，仍可继续追问。</span>
                     <button class="btn btn--primary" type="submit">提交问题</button>
                   </div>
                 </form>`
          }

          <div class="connect__list" data-thread-list>
            <div class="skeleton" style="height:96px"></div>
          </div>
        </section>

        <section class="connect__block">
          <div class="connect__block-head">
            <div>
              <h2 class="h3">预约 office hour</h2>
              <p class="field__hint">office hour 只在周三、周四；这里只提交期望，具体时间由老师批复。</p>
            </div>
            <span class="meta mono" data-request-count></span>
          </div>

          ${
            readOnly
              ? ""
              : `<form class="card connect__form" data-book-form>
                   <label class="field">
                     <span class="field__label">想聊什么</span>
                     <input class="input" name="topic" maxlength="80" required
                       placeholder="例如：案例选题是否站得住、材料提交的格式问题" />
                   </label>
                   <div class="connect__book-grid">
                     <div class="field">
                       <span class="field__label">期望日期</span>
                       <div data-day-cal></div>
                     </div>
                     <div class="field">
                       <span class="field__label">期望时段</span>
                       <div data-slot-pick></div>
                     </div>
                   </div>
                   <label class="field">
                     <span class="field__label">补充说明（可选）</span>
                     <textarea class="textarea" name="note" rows="3" maxlength="600"
                       placeholder="想让老师提前看哪一段、有没有需要带的材料"></textarea>
                   </label>
                   <div class="connect__form-foot">
                     <span class="meta">提交后等老师批复；老师会给出一段具体时间与地点。</span>
                     <button class="btn btn--primary" type="submit">提交预约申请</button>
                   </div>
                 </form>`
          }

          <div class="connect__list" data-request-list>
            <div class="skeleton" style="height:96px"></div>
          </div>
        </section>
      </div>
    </main>
  `;

  const threadListEl = qs("[data-thread-list]", root);
  const requestListEl = qs("[data-request-list]", root);
  const threadCountEl = qs("[data-thread-count]", root);
  const requestCountEl = qs("[data-request-count]", root);
  const dayCalHost = qs("[data-day-cal]", root);
  const slotPickHost = qs("[data-slot-pick]", root);

  let days = [];
  let slots = [];
  let dateCal = null;
  let slotPick = null;
  let openThread = "";

  /* —————————————— 提问 —————————————— */

  async function loadThreads() {
    try {
      const res = await qaApi.mine();
      const items = Array.isArray(res?.items) ? res.items : [];
      threadCountEl.textContent = items.length ? `${items.length} 条` : "";
      if (!items.length) {
        threadListEl.innerHTML = `<div class="empty">还没有提过问题。</div>`;
        return;
      }
      threadListEl.innerHTML = items.map(threadRow).join("");
      if (openThread) await openThreadDetail(openThread);
    } catch (err) {
      threadListEl.innerHTML = `<div class="empty" data-tone="err">${esc(
        err?.message || "读取失败，请稍后重试"
      )}</div>`;
    }
  }

  function threadRow(thread) {
    const tag = THREAD_TAG[thread.status] || THREAD_TAG.open;
    return `
      <article class="connect-thread" data-thread="${esc(thread.id)}">
        <button class="connect-thread__head" type="button" data-open="${esc(thread.id)}"
          aria-expanded="false">
          <span class="connect-thread__subject">${esc(thread.subject)}</span>
          <span class="tag ${tag.cls}">${tag.text}</span>
          <span class="meta mono">${esc(timeAgo(thread.updatedAt))}</span>
        </button>
        <p class="connect-thread__last">${esc(thread.lastBody)}</p>
        <div class="connect-thread__body" data-thread-body hidden></div>
      </article>
    `;
  }

  async function openThreadDetail(id) {
    const host = qs(`[data-thread="${id}"]`, threadListEl);
    if (!host) return;
    const body = qs("[data-thread-body]", host);
    const head = qs("[data-open]", host);
    const expanded = head.getAttribute("aria-expanded") === "true";

    if (expanded && openThread === id) {
      head.setAttribute("aria-expanded", "false");
      body.hidden = true;
      openThread = "";
      return;
    }

    head.setAttribute("aria-expanded", "true");
    body.hidden = false;
    body.innerHTML = `<div class="skeleton" style="height:72px"></div>`;
    openThread = id;

    try {
      const data = await qaApi.detail(id);
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      body.innerHTML = `
        <div class="connect-msgs">
          ${messages.map(messageHtml).join("")}
        </div>
        ${
          readOnly
            ? ""
            : `<form class="connect-reply" data-reply-form="${esc(id)}">
                 <textarea class="textarea" name="body" rows="3" maxlength="2000"
                   placeholder="继续追问，或补充老师需要的信息" required></textarea>
                 <button class="btn btn--quiet btn--sm" type="submit">发送</button>
               </form>`
        }
      `;
      const form = qs("[data-reply-form]", body);
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = String(new FormData(form).get("body") || "").trim();
        if (!text) return;
        const btn = qs("button[type=submit]", form);
        btn.disabled = true;
        try {
          await qaApi.reply(id, text);
          await loadThreads();
        } catch (err) {
          toast(err?.message || "发送失败", { type: "warn" });
        } finally {
          btn.disabled = false;
        }
      });
    } catch (err) {
      body.innerHTML = `<div class="empty" data-tone="err">${esc(err?.message || "读取失败")}</div>`;
    }
  }

  function messageHtml(message) {
    const staff = message.authorRole === "teacher" || message.authorRole === "admin";
    return `
      <div class="connect-msg${staff ? " connect-msg--staff" : ""}">
        <div class="connect-msg__meta">
          <span class="connect-msg__who">${esc(message.authorName)}</span>
          ${staff ? `<span class="tag tag--quiet">老师</span>` : ""}
          <span class="meta mono">${esc(timeAgo(message.createdAt))}</span>
        </div>
        <p class="connect-msg__body">${esc(message.body)}</p>
      </div>
    `;
  }

  threadListEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-open]");
    if (!btn) return;
    openThreadDetail(btn.dataset.open);
  });

  qs("[data-ask-form]", root)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const subject = String(data.get("subject") || "").trim();
    const body = String(data.get("body") || "").trim();
    if (!subject || !body) return;
    const btn = qs("button[type=submit]", form);
    btn.disabled = true;
    try {
      await qaApi.create(subject, body);
      form.reset();
      toast("问题已提交，等老师回复");
      await loadThreads();
    } catch (err) {
      toast(err?.message || "提交失败", { type: "warn" });
    } finally {
      btn.disabled = false;
    }
  });

  /* —————————————— office hour —————————————— */

  /** 日期与时段用月历 + 按钮组，服务端下发的可约日期就是唯一可点的格子 */
  function mountPickers() {
    if (dateCal || !dayCalHost || !slotPickHost) return;
    dateCal = createCalendar({ days });
    slotPick = createSlotPicker({
      options: slots.map((slot) => ({ value: slot, label: slotLabel(slot) })),
    });
    dayCalHost.append(dateCal.el);
    slotPickHost.append(slotPick.el);
  }

  async function loadRequests() {
    try {
      const res = await ohApi.mine();
      const items = Array.isArray(res?.items) ? res.items : [];
      days = Array.isArray(res?.days) ? res.days : [];
      slots = Array.isArray(res?.slots) ? res.slots : [];
      mountPickers();
      requestCountEl.textContent = items.length ? `${items.length} 条` : "";
      if (!items.length) {
        requestListEl.innerHTML = `<div class="empty">还没有提交过预约。</div>`;
        return;
      }
      requestListEl.innerHTML = items.map(requestRow).join("");
    } catch (err) {
      requestListEl.innerHTML = `<div class="empty" data-tone="err">${esc(
        err?.message || "读取失败，请稍后重试"
      )}</div>`;
    }
  }

  function requestRow(item) {
    const tag = REQUEST_TAG[item.status] || REQUEST_TAG.pending;
    const cancelable = item.status === "pending" || item.status === "confirmed";
    const decided = item.status === "confirmed" || item.status === "done";
    const prefer = `${dayLabelOf(days, item.preferDate)} · ${slotLabel(item.preferSlot)}`;
    const scheduled = decided && item.scheduledDate
      ? `${dayLabelOf(days, item.scheduledDate)} · ${slotLabel(item.scheduledSlot)}`
      : "";

    return `
      <article class="connect-req" data-req="${esc(item.id)}">
        <div class="connect-req__main">
          <div class="connect-req__meta">
            <span class="tag ${tag.cls}">${tag.text}</span>
            <span class="meta">期望 ${esc(prefer)}</span>
            <span class="meta mono">${esc(timeAgo(item.createdAt))}</span>
          </div>
          <h3 class="connect-req__topic">${esc(item.topic)}</h3>
          ${item.note ? `<p class="connect-req__note">${esc(item.note)}</p>` : ""}
          ${
            scheduled
              ? `<p class="connect-req__decided">
                   <b>老师定的时间</b>${esc(scheduled)}${
                     item.location ? ` · ${esc(item.location)}` : ""
                   }
                 </p>`
              : ""
          }
          ${item.reply ? `<p class="connect-req__reply"><b>老师留言</b>${esc(item.reply)}</p>` : ""}
        </div>
        ${
          cancelable
            ? `<div class="connect-req__side">
                 <button class="btn btn--quiet btn--sm" type="button" data-cancel="${esc(item.id)}">
                   撤回申请
                 </button>
               </div>`
            : ""
        }
      </article>
    `;
  }

  requestListEl.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-cancel]");
    if (!btn) return;
    const okToCancel = await confirmDialog({
      title: "撤回这次预约？",
      html: "<p>撤回后这个时段会放回给其他同学，需要的话可以重新提交。</p>",
      confirmText: "撤回",
      danger: true,
    });
    if (!okToCancel) return;
    btn.disabled = true;
    try {
      await ohApi.cancel(btn.dataset.cancel);
      toast("已撤回");
      await loadRequests();
    } catch (err) {
      toast(err?.message || "撤回失败", { type: "warn" });
    } finally {
      btn.disabled = false;
    }
  });

  qs("[data-book-form]", root)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      topic: String(data.get("topic") || "").trim(),
      preferDate: dateCal?.getValue() || "",
      preferSlot: slotPick?.getValue() || "",
      note: String(data.get("note") || "").trim(),
    };
    if (!payload.topic) return;
    if (!payload.preferDate) {
      toast("先在月历里选一个周三或周四", { type: "warn" });
      return;
    }
    if (!payload.preferSlot) {
      toast("再选一个期望时段", { type: "warn" });
      return;
    }
    const btn = qs("button[type=submit]", form);
    btn.disabled = true;
    try {
      await ohApi.create(payload);
      form.reset();
      dateCal?.setValue("");
      slotPick?.setValue("");
      toast("预约申请已提交，等老师批复");
      await loadRequests();
    } catch (err) {
      toast(err?.message || "提交失败", { type: "warn" });
    } finally {
      btn.disabled = false;
    }
  });

  loadThreads();
  loadRequests();
  mountReveal(root);
}
