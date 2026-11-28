/**
 * 月历与时段选择。
 *
 * 只画服务端下发的可约日期（周三、周四，未来 8 周）：其它日子照常显示但不可点，
 * 这样学生一眼能看出「这一周只有两天能约」，比一个只列 16 项的下拉清楚得多。
 * 学生页与教师后台共用这一份，两边的可选范围与选中态才不会走样。
 */
import { esc } from "../lib/dom.js";

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function parseDate(value) {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d, weekday: date.getUTCDay() };
}

function todayValue() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * @param {{ days: {value: string, label: string}[], value?: string, onChange?: (v: string) => void }} opts
 * @returns {{ el: HTMLElement, getValue: () => string, setValue: (v: string) => void }}
 */
export function createCalendar({ days = [], value = "", onChange = null } = {}) {
  const allowed = new Map(days.map((day) => [day.value, day]));
  const labelOf = (v) => allowed.get(v)?.label || v;
  let current = allowed.has(value) ? value : "";
  const seed = parseDate(current) || parseDate(days[0]?.value) || parseDate(todayValue());
  let cursor = { y: seed.y, m: seed.m };

  const el = document.createElement("div");
  el.className = "cal";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "选择日期：只在周三与周四开放");

  function monthHasDays(y, m) {
    return days.some((day) => {
      const parts = parseDate(day.value);
      return parts && parts.y === y && parts.m === m;
    });
  }

  function shiftMonth(delta) {
    const next = new Date(Date.UTC(cursor.y, cursor.m - 1 + delta, 1));
    cursor = { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1 };
    render();
  }

  function pick(v) {
    current = v;
    render();
    onChange?.(v);
  }

  function render() {
    const today = todayValue();
    const firstWeekday = new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).getUTCDay();
    // 周一开头：getUTCDay 的 0 是周日，换算成 Monday-first 的列号
    const lead = (firstWeekday + 6) % 7;
    const total = daysInMonth(cursor.y, cursor.m);

    const cells = [];
    for (let i = 0; i < lead; i += 1) {
      cells.push(`<span class="cal__day is-blank" aria-hidden="true"></span>`);
    }
    for (let d = 1; d <= total; d += 1) {
      const value = `${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!allowed.has(value)) {
        cells.push(`<span class="cal__day is-off" aria-hidden="true">${d}</span>`);
        continue;
      }
      const on = value === current ? " is-on" : "";
      const isToday = value === today ? " is-today" : "";
      cells.push(
        `<button class="cal__day${on}${isToday}" type="button" data-date="${value}"
           aria-pressed="${value === current}" aria-label="${esc(labelOf(value))}">${d}</button>`
      );
    }

    el.innerHTML = `
      <div class="cal__head">
        <button class="cal__nav" type="button" data-prev="1"
          ${monthHasDays(...prevMonth(cursor)) ? "" : "disabled"} aria-label="上个月">‹</button>
        <span class="cal__month">${cursor.y} 年 ${cursor.m} 月</span>
        <button class="cal__nav" type="button" data-next="1"
          ${monthHasDays(...nextMonth(cursor)) ? "" : "disabled"} aria-label="下个月">›</button>
      </div>
      <div class="cal__week" aria-hidden="true">
        ${WEEK_LABELS.map((w) => `<span>${w}</span>`).join("")}
      </div>
      <div class="cal__grid">${cells.join("")}</div>
      <p class="cal__note">
        ${current ? `已选 ${esc(labelOf(current))}` : "只在周三、周四开放预约"}
      </p>
    `;

    el.querySelector("[data-prev]")?.addEventListener("click", () => shiftMonth(-1));
    el.querySelector("[data-next]")?.addEventListener("click", () => shiftMonth(1));
    el.querySelectorAll("[data-date]").forEach((btn) => {
      btn.addEventListener("click", () => pick(btn.dataset.date));
    });
  }

  function prevMonth({ y, m }) {
    const d = new Date(Date.UTC(y, m - 2, 1));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1];
  }

  function nextMonth({ y, m }) {
    const d = new Date(Date.UTC(y, m, 1));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1];
  }

  render();

  return {
    el,
    getValue: () => current,
    setValue(v) {
      current = allowed.has(v) ? v : "";
      const parts = parseDate(current);
      if (parts) cursor = { y: parts.y, m: parts.m };
      render();
    },
  };
}

/**
 * 时段按钮组。教师端要按「这个时段是否已被占用」实时改选项，
 * 所以选项由外部传进来，变更时再 setOptions 一次。
 * @param {{ options: {value: string, label: string, disabled?: boolean, note?: string}[], value?: string, onChange?: Function }} opts
 */
export function createSlotPicker({ options = [], value = "", onChange = null } = {}) {
  let current = value;
  const el = document.createElement("div");
  el.className = "slots";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "选择时段");

  function render() {
    el.innerHTML = options
      .map((option) => {
        const on = option.value === current ? " is-on" : "";
        return `<button class="slot-chip${on}" type="button" data-slot="${esc(option.value)}"
          ${option.disabled ? "disabled" : ""} aria-pressed="${option.value === current}"
          >${esc(option.label)}${option.note ? `<i>${esc(option.note)}</i>` : ""}</button>`;
      })
      .join("");
    el.querySelectorAll("[data-slot]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        current = btn.dataset.slot;
        render();
        onChange?.(current);
      });
    });
  }

  render();

  return {
    el,
    getValue: () => current,
    setValue(v) {
      current = v;
      render();
    },
    setOptions(list) {
      options = list;
      // 选中的那一档若变成不可用，就取消选中，避免把冲突的组合带进提交
      const still = options.find((option) => option.value === current && !option.disabled);
      if (!still) current = "";
      render();
    },
  };
}
