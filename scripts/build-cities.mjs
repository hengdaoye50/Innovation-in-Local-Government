/**
 * 生成 public/data/cities.json
 * 数据源：阿里 DataV 行政区划边界（省级 + 地级市中心点）
 * 一次性工具，站点运行时不依赖此脚本。
 *
 * 用法：node scripts/build-cities.mjs
 */
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound";

// 直辖市与特别行政区：只有区级划分，不生成「市」条目
const MUNICIPALITIES = new Set([
  "110000",
  "120000",
  "310000",
  "500000",
  "710000",
  "810000",
  "820000",
]);

const SHORT_NAMES = {
  北京市: "北京",
  天津市: "天津",
  河北省: "河北",
  山西省: "山西",
  内蒙古自治区: "内蒙古",
  辽宁省: "辽宁",
  吉林省: "吉林",
  黑龙江省: "黑龙江",
  上海市: "上海",
  江苏省: "江苏",
  浙江省: "浙江",
  安徽省: "安徽",
  福建省: "福建",
  江西省: "江西",
  山东省: "山东",
  河南省: "河南",
  湖北省: "湖北",
  湖南省: "湖南",
  广东省: "广东",
  广西壮族自治区: "广西",
  海南省: "海南",
  重庆市: "重庆",
  四川省: "四川",
  贵州省: "贵州",
  云南省: "云南",
  西藏自治区: "西藏",
  陕西省: "陕西",
  甘肃省: "甘肃",
  青海省: "青海",
  宁夏回族自治区: "宁夏",
  新疆维吾尔自治区: "新疆",
  台湾省: "台湾",
  香港特别行政区: "香港",
  澳门特别行政区: "澳门",
};

async function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 innovation-localgov/0.1" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

async function main() {
  console.log("读取省级边界…");
  const nationalPath = path.join(DATA_DIR, "china.json");
  let national;
  try {
    national = JSON.parse(await readFile(nationalPath, "utf8"));
  } catch {
    national = await fetchJson(`${SOURCE}/100000_full.json`);
    await writeFile(nationalPath, JSON.stringify(national), "utf8");
  }

  const provinces = [];
  const citySources = [];

  for (const feature of national.features) {
    const p = feature.properties || {};
    if (!p.name || !p.adcode) continue;
    // 跳过南海诸岛等无实际行政区的要素
    if (!SHORT_NAMES[p.name]) continue;
    const center = p.center || p.centroid;
    if (!center) continue;
    provinces.push({
      name: p.name,
      short: SHORT_NAMES[p.name],
      adcode: String(p.adcode),
      lng: round(center[0]),
      lat: round(center[1]),
    });
    if (!MUNICIPALITIES.has(String(p.adcode))) citySources.push(String(p.adcode));
  }

  console.log(`省级单位 ${provinces.length} 个，开始抓取地级市…`);

  const cities = [];
  let done = 0;
  const concurrency = 6;

  async function worker(queue) {
    while (queue.length) {
      const adcode = queue.shift();
      if (!adcode) break;
      const province = provinces.find((x) => x.adcode === adcode);
      try {
        const data = await fetchJson(`${SOURCE}/${adcode}_full.json`);
        for (const feature of data.features || []) {
          const p = feature.properties || {};
          if (p.level !== "city") continue;
          const center = p.center || p.centroid;
          if (!center || !p.name) continue;
          cities.push({
            name: p.name,
            province: province.name,
            lng: round(center[0]),
            lat: round(center[1]),
          });
        }
      } catch (err) {
        console.warn(`  ${province?.name || adcode} 抓取失败：${err.message}`);
      }
      done += 1;
      if (done % 5 === 0) process.stdout.write(`  ${done}/${citySources.length}\n`);
    }
  }

  const queue = [...citySources];
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));

  cities.sort((a, b) => (a.province + a.name).localeCompare(b.province + b.name, "zh"));

  const out = {
    generatedAt: new Date().toISOString(),
    source: "Aliyun DataV areas_v3",
    provinces,
    cities,
  };

  await writeFile(path.join(DATA_DIR, "cities.json"), JSON.stringify(out), "utf8");
  console.log(`完成：${provinces.length} 省 / ${cities.length} 市`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
