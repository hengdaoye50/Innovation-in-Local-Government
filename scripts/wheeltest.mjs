/**
 * 滚轮行为测试：确认鼠标停在地图区域时，页面仍能正常滚动。
 * 只在按住 Ctrl 时才应拦截滚轮去缩放地图。
 *
 * 用法：node scripts/wheeltest.mjs [url]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const url = process.argv[2] || "https://innovation-localgov.pages.dev/";
const port = 9850;
const profile = path.join(process.env.TEMP || "/tmp", `wheel-${Date.now()}`);

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
    "--window-size=1440,900",
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

  const wheel = async (x, y, { ctrl = false, deltaY = 240 } = {}) => {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY,
      modifiers: ctrl ? 2 : 0, // 2 = Ctrl
    });
    await sleep(320);
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url });
  await sleep(3200);

  const center = await evaluate(`(() => {
    const r = document.querySelector('.map-canvas').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  const before = await evaluate("({ y: Math.round(window.scrollY), k: document.querySelector('.map-root').getAttribute('transform') })");

  // 1. 普通滚轮：应滚动页面
  await wheel(center.x, center.y);
  const afterPlain = await evaluate("({ y: Math.round(window.scrollY), k: document.querySelector('.map-root').getAttribute('transform') })");

  // 回到顶部
  await evaluate("window.scrollTo(0,0)");
  await sleep(400);

  // 2. Ctrl + 滚轮：应缩放地图、页面不动
  await wheel(center.x, center.y, { ctrl: true });
  const afterCtrl = await evaluate("({ y: Math.round(window.scrollY), k: document.querySelector('.map-root').getAttribute('transform') })");

  console.log("before      :", JSON.stringify(before));
  console.log("plain wheel :", JSON.stringify(afterPlain), afterPlain.y > before.y ? "→ 页面滚动了 ✓" : "→ 页面没动 ✗");
  console.log("ctrl+wheel  :", JSON.stringify(afterCtrl), afterCtrl.y === 0 && afterCtrl.k !== before.k ? "→ 缩放了地图且页面未动 ✓" : "→ 行为异常 ✗");

  ws.close();
} catch (err) {
  console.error("FAIL:", err.message);
} finally {
  child.kill();
}
