/**
 * 带登录态截取教师后台。
 * 用法：node scripts/adminshot.mjs <baseUrl> <out.png> [tab] [user] [pass] [w] [h]
 * tab 取 cases / slides / posts / invites
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [
  baseUrl = "http://127.0.0.1:8791",
  out = "screenshots/admin.png",
  tab = "cases",
  user = "teacher01",
  pass = "Teach2026a",
  w = "1440",
  h = "1000",
] = process.argv.slice(2);

const width = Number(w);
const height = Number(h);

// 1. 先用 node 登录，拿会话 cookie
const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: user, password: pass }),
});
if (!loginRes.ok) {
  console.error("登录失败：", loginRes.status, (await loginRes.text()).slice(0, 200));
  process.exit(1);
}
const rawCookie = (loginRes.headers.getSetCookie?.() || [])[0] || "";
const cookiePair = rawCookie.split(";")[0];
const [cookieName, cookieValue] = cookiePair.split("=");
if (!cookieName || !cookieValue) {
  console.error("没有拿到会话 cookie");
  process.exit(1);
}

// 2. 启动浏览器
const port = 9880;
const profile = path.join(process.env.TEMP || "/tmp", `admin-${Date.now()}`);
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => existsSync(p));

const child = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
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

  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const host = new URL(baseUrl).hostname;
  await send("Network.setCookie", {
    name: cookieName,
    value: cookieValue,
    domain: host,
    path: "/",
    httpOnly: true,
  });

  await send("Page.navigate", { url: `${baseUrl}/#/admin` });
  await sleep(3000);

  if (tab && tab !== "cases") {
    await send("Runtime.evaluate", {
      expression: `document.querySelector('[data-tab="${tab}"]')?.click()`,
    });
    await sleep(1600);
  }

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, Buffer.from(data, "base64"));
  console.log(`saved ${out}`);
  ws.close();
} finally {
  child.kill();
}
