/**
 * 检查 functions/ 下所有相对 import 是否指向真实文件。
 * Pages Functions 的目录层级深，路径少退一层要等 CI 构建才报错，
 * 本地先扫一遍能省一次部署。
 * 用法：node scripts/check-fn-imports.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = "functions";
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".js")) files.push(full);
  }
}

walk(ROOT);

let bad = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const re = /from\s+"(\.{1,2}\/[^"]+)"/g;
  let match;
  while ((match = re.exec(source))) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (!existsSync(target)) {
      bad += 1;
      console.error(`✗ ${file} → ${match[1]}`);
    }
  }
}

console.log(`检查 ${files.length} 个文件，${bad ? `${bad} 处路径错误` : "全部导入可解析"}`);
process.exit(bad ? 1 : 0);
