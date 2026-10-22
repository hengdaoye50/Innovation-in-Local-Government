/**
 * 真实鼠标事件测试：走 pointerdown → pointerup → click 完整序列。
 * 只派发 click 会漏掉 pointerdown 里的状态切换，验证点击行为务必用这个脚本。
 *
 * 用法：node scripts/clicktest.mjs [url]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const url = process.argv[2] || "https://innovation-localgov.pages.dev/";
const width = 1440;
const height = 900;
const port = 9800;
const profile = path.join(process.env.TEMP || "/tmp", `click-${Date.now()}`);

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("未找到 Chrome");
  process.exit(1);
}

const child = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" }
);

async function wsUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {
      /* 等待 */
    }
    await sleep(150);
  }
  throw new Error("DevTools 未就绪");
}

try {
  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return r.result?.value;
  };

  const clickAt = async (x, y) => {
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await sleep(50);
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(450);
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url });
  await sleep(3200);

  // 注入事件日志，确认点击到底落在哪个元素上
  await evaluate(`(() => {
    window.__log = [];
    ['pointerdown','pointerup','click'].forEach(t => {
      document.addEventListener(t, (e) => {
        const el = e.target;
        window.__log.push({
          t,
          tag: el.tagName,
          cls: typeof el.getAttribute === 'function' ? (el.getAttribute('class') || '') : '',
          inNode: !!(el.closest && el.closest('.node')),
          x: Math.round(e.clientX),
          y: Math.round(e.clientY)
        });
      }, true);
    });
    return true;
  })()`);

  // 取一个单案例节点的屏幕坐标（把视口滚到地图屏）
  const target = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.node')];
    const pick = nodes.find(n => n.getAttribute('data-key').endsWith('|1')) || nodes[0];
    if (!pick) return null;
    const r = pick.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, key: pick.getAttribute('data-key'), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);

  console.log("target:", JSON.stringify(target));
  if (!target) throw new Error("页面上没有节点");

  // 第一次点击 → 应进入分析态
  await clickAt(target.x, target.y);
  const step1 = await evaluate(`({
    atlas: document.querySelector('.map-svg')?.classList.contains('is-atlas'),
    card: document.querySelector('[data-focus-card]')?.classList.contains('is-open'),
    links: document.querySelectorAll('.atlas-link').length,
    log: window.__log
  })`);
  console.log("after 1st click:", JSON.stringify(step1));

  // 第二次点击同一位置 → 应进入案例详情
  await clickAt(target.x, target.y);
  const step2 = await evaluate(`({
    hash: location.hash,
    atlas: document.querySelector('.map-svg')?.classList.contains('is-atlas'),
    hasDetail: !!document.querySelector('.detail'),
    title: document.querySelector('.detail__title')?.textContent?.slice(0, 24) || '',
    log2: window.__log.slice(3)
  })`);
  console.log("after 2nd click:", JSON.stringify(step2));

  ws.close();
} catch (err) {
  console.error("FAIL:", err.message);
} finally {
  child.kill();
}
