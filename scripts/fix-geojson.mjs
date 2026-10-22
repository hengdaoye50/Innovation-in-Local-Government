/**
 * 修正 public/data/china.json 的环方向。
 * DataV 导出的多边形绕向与 GeoJSON 右手法则相反，d3-geo 会把它理解成
 * 「整个球面减去该省」，导致投影 Bounds 覆盖全球、路径绕地球一圈。
 * 判据：单个多边形球面面积超过 2π 即为绕向反了，反转其所有环。
 *
 * 用法：node scripts/fix-geojson.mjs
 */
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { geoArea } from "d3-geo";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "public", "data", "china.json");
// 备份放在 scripts 内的缓存目录，避免被 Vite 复制进 dist
const BACKUP = path.join(ROOT, "scripts", ".cache", "china.raw.json");

const HALF_SPHERE = 2 * Math.PI;

/** 用单个多边形构造临时 Feature 来计算面积 */
function polygonArea(rings) {
  return geoArea({ type: "Polygon", coordinates: rings });
}

async function main() {
  const rawText = await readFile(FILE, "utf8");
  const geo = JSON.parse(rawText);

  let reversed = 0;
  let kept = 0;

  for (const feature of geo.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === "Polygon") {
      if (polygonArea(geom.coordinates) > HALF_SPHERE) {
        geom.coordinates = geom.coordinates.map((ring) => ring.slice().reverse());
        reversed += 1;
      } else kept += 1;
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates = geom.coordinates.map((poly) => {
        if (polygonArea(poly) > HALF_SPHERE) {
          reversed += 1;
          return poly.map((ring) => ring.slice().reverse());
        }
        kept += 1;
        return poly;
      });
    }
  }

  // 复核：整体面积应远小于半个球面
  const total = geoArea(geo);
  console.log(`反转多边形 ${reversed} 个，保留 ${kept} 个`);
  console.log(`全图球面面积 ${total.toFixed(6)} sr（应远小于 ${HALF_SPHERE.toFixed(3)}）`);

  if (total > HALF_SPHERE) {
    console.error("修正失败：面积仍然异常，检查数据来源。");
    process.exit(1);
  }

  // 备份原始数据，便于回溯
  try {
    await readFile(BACKUP);
  } catch {
    await mkdir(path.dirname(BACKUP), { recursive: true });
    await copyFile(FILE, BACKUP);
    console.log(`已备份原始数据至 ${path.relative(ROOT, BACKUP)}`);
  }

  await writeFile(FILE, JSON.stringify(geo), "utf8");
  console.log("已写入 public/data/china.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
