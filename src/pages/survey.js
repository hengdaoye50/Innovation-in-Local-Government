/** 调研足迹：详情页与提交表单 */
import { esc, toast } from "../lib/dom.js";
import { surveys as surveysApi } from "../lib/api.js";
import { getState } from "../lib/store.js";

const placeOf = (s) =>
  [s.province, s.city, s.district].filter((p, i, arr) => p && arr.indexOf(p) === i).join(" · ");

/* ————————— 详情 ————————— */

export async function mountSurveyDetail(root, id) {
  root.innerHTML = `<div class="shell shell-narrow"><div class="skeleton" style="height:40px;width:50%"></div></div>`;

  let survey = null;
  try {
    survey = await surveysApi.detail(id);
  } catch {
    survey = null;
  }
  if (!survey) {
    root.innerHTML = `<div class="shell shell-narrow empty">
      <div class="screen-ordinal">未找到</div>
      <h1 class="h2" style="margin:12px 0 16px">这条调研记录不在了</h1>
      <a class="btn btn--ghost btn--sm" href="#field">回到调研足迹</a>
    </div>`;
    return;
  }

  const viewer = getState().user;
  const canRemove =
    viewer && (viewer.id === survey.authorId || viewer.role === "teacher" || viewer.role === "admin");

  // 游记体：正文按空行分段，排版比案例松，不给段落编号
  const paragraphs = String(survey.body || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  root.innerHTML = `
    <article class="detail detail--field">
      <div class="shell shell-narrow">
        <a class="detail__back" href="#field">回到调研足迹</a>
        <header class="detail__head">
          <div class="detail__place">
            <span class="detail__place-dot"></span>
            ${esc(placeOf(survey))}
          </div>
          <h1 class="detail__title">${esc(survey.title)}</h1>
          <div class="detail__meta">
            <span class="meta">${esc(survey.author)}</span>
            ${
              survey.visitedAt
                ? `<span class="meta mono">调研于 ${esc(survey.visitedAt)}</span>`
                : ""
            }
            ${
              canRemove
                ? `<button class="btn btn--quiet btn--sm" type="button" data-remove>删除这条记录</button>`
                : ""
            }
          </div>
        </header>

        <div class="field__prose">
          ${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
        </div>
      </div>
    </article>
  `;

  root.querySelector("[data-remove]")?.addEventListener("click", async () => {
    if (!window.confirm("删除这条调研记录？删除后不再出现在调研足迹里。")) return;
    try {
      await surveysApi.remove(survey.id);
      toast("已删除");
      window.location.hash = "/field";
    } catch (err) {
      toast(err.message || "删除失败", { type: "error" });
    }
  });

  document.title = `${survey.title} · 调研足迹`;
}

/* ————————— 提交表单 ————————— */

export async function mountSurveyForm(root) {
  root.innerHTML = `
    <div class="shell shell-narrow">
      <a class="detail__back" href="#field">回到调研足迹</a>
      <header class="detail__head">
        <div class="detail__place"><span class="detail__place-dot"></span>田野</div>
        <h1 class="detail__title">记录一次调研</h1>
        <p class="field__hint" style="max-width:40em;line-height:1.8">
          不必写成案例，也不用提炼「创新点」。你看到的、听到的、觉得奇怪的，都可以记下来；
          写清在哪儿、什么时候去的就够了。
        </p>
      </header>

      <form class="field-form" data-survey-form>
        <label class="field">
          <span class="field__label">标题</span>
          <input class="input" name="title" maxlength="80" placeholder="例如：在政务大厅待了一上午" />
        </label>

        <div class="field-row3">
          <label class="field">
            <span class="field__label">省 / 自治区</span>
            <select class="select" data-province><option value="">请选择</option></select>
          </label>
          <label class="field">
            <span class="field__label">市 / 地区</span>
            <select class="select" data-city><option value="">请选择</option></select>
          </label>
          <label class="field">
            <span class="field__label">区 / 县</span>
            <select class="select" data-district><option value="">请选择</option></select>
          </label>
        </div>

        <label class="field">
          <span class="field__label">调研时间（可选）</span>
          <input class="input" name="visitedAt" type="month" />
        </label>

        <label class="field">
          <span class="field__label">见闻</span>
          <textarea class="textarea field-form__body" name="body" rows="14"
            placeholder="到那儿之后先看到什么，谁带你走的，问了谁、他怎么说，哪件事和你预想的不一样。空一行分段。"></textarea>
        </label>

        <div class="field-form__actions">
          <span class="field__hint" data-form-status></span>
          <button class="btn btn--primary" type="submit">发布</button>
        </div>
      </form>
    </div>
  `;

  const provinceSel = root.querySelector("[data-province]");
  const citySel = root.querySelector("[data-city]");
  const districtSel = root.querySelector("[data-district]");
  const form = root.querySelector("[data-survey-form]");
  const status = root.querySelector("[data-form-status]");

  const geo = { provinces: [], cities: [], districts: [] };
  try {
    const data = await (await fetch("/data/cities.json")).json();
    geo.provinces = data.provinces || [];
    geo.cities = data.cities || [];
    geo.districts = data.districts || [];
    provinceSel.innerHTML =
      `<option value="">请选择</option>` +
      geo.provinces.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  } catch {
    provinceSel.innerHTML = `<option value="">数据加载失败</option>`;
  }

  provinceSel.addEventListener("change", () => {
    const list = geo.cities.filter((c) => c.province === provinceSel.value);
    citySel.innerHTML =
      `<option value="">请选择</option>` +
      list.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
    districtSel.innerHTML = `<option value="">请先选市</option>`;
  });

  citySel.addEventListener("change", () => {
    const list = geo.districts.filter(
      (d) => d.province === provinceSel.value && d.city === citySel.value
    );
    districtSel.innerHTML =
      `<option value="">${list.length ? "可选" : "暂无区县数据"}</option>` +
      list.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const province = provinceSel.value;
    const city = citySel.value;
    const district = districtSel.value;
    // 坐标精度按 区县 > 市 > 省 依次退让
    const point =
      geo.districts.find((d) => d.province === province && d.city === city && d.name === district) ||
      geo.cities.find((c) => c.province === province && c.name === city) ||
      geo.provinces.find((p) => p.name === province);

    const payload = {
      title: String(fd.get("title") || "").trim(),
      province,
      city,
      district,
      visitedAt: String(fd.get("visitedAt") || "").trim(),
      body: String(fd.get("body") || "").trim(),
      lng: point?.lng,
      lat: point?.lat,
    };

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    status.textContent = "发布中…";
    status.dataset.state = "";
    try {
      const result = await surveysApi.create(payload);
      toast("已记录，谢谢你把这段路留下来");
      window.location.hash = `/field/${result.id}`;
    } catch (err) {
      status.textContent = err.message || "发布失败";
      status.dataset.state = "err";
    } finally {
      btn.disabled = false;
    }
  });

  document.title = "记录一次调研 · 调研足迹";
}
