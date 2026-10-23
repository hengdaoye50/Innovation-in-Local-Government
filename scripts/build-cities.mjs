/**
 * 生成 public/data/cities.json（省 / 地级市 / 区县 三级坐标索引）
 * 数据源：阿里 DataV 行政区划边界
 * 一次性工具，站点运行时不依赖此脚本。
 *
 * 用法：node scripts/build-cities.mjs
 *
 * 说明：区县重名极多（朝阳区北京和长春都有），所以每条都带 province/city
 * 上下文，匹配时必须逐级校验，不能只按名字查。
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const CACHE_DIR = path.join(ROOT, "scripts", ".cache", "datav");
const SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound";

// 直辖市与特别行政区：本身即为地级，下辖直接是区县
const MUNICIPALITIES = new Set(["110000", "120000", "310000", "500000", "710000", "810000", "820000"]);

const SHORT_NAMES = {
  北京市: "北京", 天津市: "天津", 河北省: "河北", 山西省: "山西",
  内蒙古自治区: "内蒙古", 辽宁省: "辽宁", 吉林省: "吉林", 黑龙江省: "黑龙江",
  上海市: "上海", 江苏省: "江苏", 浙江省: "浙江", 安徽省: "安徽",
  福建省: "福建", 江西省: "江西", 山东省: "山东", 河南省: "河南",
  湖北省: "湖北", 湖南省: "湖南", 广东省: "广东", 广西壮族自治区: "广西",
  海南省: "海南", 重庆市: "重庆", 四川省: "四川", 贵州省: "贵州",
  云南省: "云南", 西藏自治区: "西藏", 陕西省: "陕西", 甘肃省: "甘肃",
  青海省: "青海", 宁夏回族自治区: "宁夏", 新疆维吾尔自治区: "新疆",
  台湾省: "台湾", 香港特别行政区: "香港", 澳门特别行政区: "澳门",
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
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

/** 带本地缓存，重复跑不会重复下载 */
async function cached(adcode) {
  const file = path.join(CACHE_DIR, `${adcode}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const data = await fetchJson(`${SOURCE}/${adcode}_full.json`);
    await writeFile(file, JSON.stringify(data), "utf8");
    return data;
  }
}

const round = (n) => Math.round(n * 10000) / 10000;

function centerOf(props) {
  const c = props.center || props.centroid;
  if (!Array.isArray(c) || c.length < 2) return null;
  const [lng, lat] = c;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng: round(lng), lat: round(lat) };
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  const national = JSON.parse(await readFile(path.join(DATA_DIR, "china.json"), "utf8"));

  const provinces = [];
  for (const feature of national.features) {
    const p = feature.properties || {};
    if (!p.name || !SHORT_NAMES[p.name]) continue;
    const c = centerOf(p);
    if (!c) continue;
    provinces.push({ name: p.name, short: SHORT_NAMES[p.name], adcode: String(p.adcode), ...c });
  }
  console.log(`省级单位 ${provinces.length} 个`);

  const cities = [];
  const districts = [];
  const queue = [...provinces];

  let done = 0;
  const concurrency = 6;

  async function worker() {
    while (queue.length) {
      const prov = queue.shift();
      if (!prov) break;

      let data;
      try {
        data = await cached(prov.adcode);
      } catch (err) {
        console.warn(`  ${prov.name} 抓取失败：${err.message}`);
        continue;
      }

      const children = (data.features || [])
        .map((f) => ({ props: f.properties || {} }))
        .filter((x) => x.props.name && x.props.adcode);

      if (MUNICIPALITIES.has(prov.adcode)) {
        // 直辖市：自身记为一个「市」，下辖直接作为区县
        cities.push({ name: prov.name, province: prov.name, adcode: prov.adcode, lng: prov.lng, lat: prov.lat });
        for (const { props } of children) {
          if (props.level !== "district") continue;
          const c = centerOf(props);
          if (!c) continue;
          districts.push({ name: props.name, city: prov.name, province: prov.name, adcode: String(props.adcode), ...c });
        }
        done += 1;
        if (done % 5 === 0) process.stdout.write(`  ${done}/${provinces.length}\n`);
        continue;
      }

      const cityList = [];
      for (const { props } of children) {
        if (props.level !== "city") continue;
        const c = centerOf(props);
        if (!c) continue;
        const city = { name: props.name, province: prov.name, adcode: String(props.adcode), ...c };
        cities.push(city);
        cityList.push(city);
      }

      // 逐个地级市取区县
      for (const city of cityList) {
        try {
          const cityData = await cached(city.adcode);
          for (const f of cityData.features || []) {
            const p = f.properties || {};
            if (p.level !== "district" || !p.name) continue;
            const c = centerOf(p);
            if (!c) continue;
            districts.push({
              name: p.name,
              city: city.name,
              province: prov.name,
              adcode: String(p.adcode),
              ...c,
            });
          }
        } catch {
          /* 单个市失败不影响整体 */
        }
      }

      done += 1;
      if (done % 5 === 0) process.stdout.write(`  ${done}/${provinces.length}\n`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  cities.sort((a, b) => (a.province + a.name).localeCompare(b.province + b.name, "zh"));
  districts.sort((a, b) =>
    (a.province + a.city + a.name).localeCompare(b.province + b.city + b.name, "zh")
  );

  const out = {
    generatedAt: new Date().toISOString(),
    source: "Aliyun DataV areas_v3",
    provinces,
    cities,
    districts,
  };

  await writeFile(path.join(DATA_DIR, "cities.json"), JSON.stringify(out), "utf8");
  const kb = Math.round(JSON.stringify(out).length / 1024);
  console.log(`完成：${provinces.length} 省 / ${cities.length} 市 / ${districts.length} 区县，约 ${kb} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
