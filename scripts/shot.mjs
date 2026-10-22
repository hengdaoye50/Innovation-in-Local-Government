/**
 * 页面截图工具（开发期视觉检查用）
 * 用法：node scripts/shot.mjs <url> <out.png> [width] [height] [scrollY]
 * 依赖本机 Chrome 的 DevTools 协议，不进入生产代码。
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const [url, out, w = "1440", h = "900", scrollY = "0"] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [w] [h] [scrollY]");
  process.exit(1);
}

const width = Number(w);
const height = Number(h);
const port = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(process.env.TEMP || "/tmp", `shot-${Date.now()}`);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));

if (!chromePath) {
  console.error("未找到 Chrome/Edge");
  process.exit(1);
}

const child = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore", detached: false }
);

async function getWsUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 尚未就绪 */
    }
    await sleep(150);
  }
  throw new Error("DevTools 未就绪");
}

function createClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

try {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const send = createClient(ws);
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send("Page.navigate", { url });
  await sleep(2600);

  const y = Number(scrollY);
  if (y) {
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` });
    await sleep(1200);
  }

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, Buffer.from(data, "base64"));
  console.log(`saved ${out} (${width}x${height} @y=${y})`);
  ws.close();
} finally {
  child.kill();
}
