"""
把 examples/ 里的示例稿灌进线上案例库（一次性工具，用于课程前期铺几条真实案例）。
产物是一条 INSERT 语句的 SQL 文件，交给 wrangler d1 execute --file 执行。

用法：
  python scripts/seed-case.py > .wrangler/seed.sql
  npx wrangler d1 execute innovation-localgov --remote --file .wrangler/seed.sql
"""
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 每条案例的元数据；正文从 markdown 读，标题取一级标题
CASES = [
    {
        "id": "case_shenzhen_minyi",
        "file": "examples/sample-case.md",
        "province": "广东省",
        "city": "深圳市",
        "district": "福田区",
        "lng": 114.051,
        "lat": 22.541,
        # 一标签一篇：基层治理归北京吹哨报到，这条只留数字治理
        "domains": ["数字治理"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2024",
        # 数字口径以国家数据局的典型案例为准（537 个渠道 / 4177 项清单 / 98% 一次分拨），
        # 人民日报另有一篇写 557 个渠道，正文统一采用一条口径，来源也给这一条
        "sources": [
            {
                "title": "深圳：推进民生诉求综合服务改革 探索城市治理现代化新路（国家数据局·城市全域数字化转型典型案例）",
                "url": "https://www.nda.gov.cn/sjj/ywpd/szsh/0110/20250110160028970541877_pc.html",
            },
            {
                "title": "「一键下单」，民生诉求速办（人民日报，2024-08-27）",
                "url": "http://politics.people.com.cn/n1/2024/0827/c1001-40306567.html",
            },
        ],
    },
    {
        "id": "case_beijing_chuishao",
        "file": "examples/case-beijing-chuishao.md",
        "province": "北京市",
        "city": "北京市",
        "district": "平谷区",
        "lng": 117.1123,
        "lat": 40.1448,
        "domains": ["基层治理"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2018",
        "sources": [
            {
                "title": "街乡吹哨 部门报到——北京市推进党建引领基层治理体制机制创新（人民网，2018-12-10）",
                "url": "http://dangjian.people.com.cn/n1/2018/1210/c117092-30453404.html",
            },
            {
                "title": "吹哨报到（北京市人民政府·首都之窗政策问答）",
                "url": "https://www.beijing.gov.cn/zhengce/zcjd/zcwd/csbd/index.html",
            },
            {
                "title": "「十四五」规划《纲要》名词解释之 139：街乡吹哨、部门报到（国家发改委）",
                "url": "https://www.ndrc.gov.cn/fggz/fzzlgh/gjfzgh/202112/t20211224_1309403.html",
            },
        ],
    },
    {
        "id": "case_jiande_duibao",
        "file": "examples/case-jiande-bancheng.md",
        "province": "浙江省",
        "city": "杭州市",
        "district": "建德市",
        "lng": 119.2791,
        "lat": 29.4723,
        "domains": ["公共服务"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2025",
        # 起源、国标时间线均取自新华网转浙江在线的报道；受理范围参照地方公开的受理须知
        "sources": [
            {
                "title": "「办不成事」窗口迎来国家标准（新华网转浙江在线，2026-06-26）",
                "url": "http://zj.news.cn/20260626/2de36ac34efb4bc882e26160f749be21/c.html",
            },
            {
                "title": "「办不成事」反映窗口受理须知（常德市人民政府）",
                "url": "https://www.changde.gov.cn/petition/notice?petitionletterboxid=10",
            },
        ],
    },
]


def sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def build(case: dict) -> str:
    raw = (ROOT / case["file"]).read_text(encoding="utf-8").strip()
    lines = raw.split("\n")
    title = lines[0].lstrip("# ").strip()
    body = "\n".join(lines[1:]).strip()
    summary = " ".join(body.split())[:160]
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    columns = [
        "id", "title", "province", "city", "district", "lng", "lat",
        "domains", "summary", "body", "sources_json",
        "author_id", "author_name", "status", "year", "created_at", "updated_at",
    ]
    values = [
        sql_quote(case["id"]),
        sql_quote(title),
        sql_quote(case["province"]),
        sql_quote(case["city"]),
        sql_quote(case["district"]),
        str(case["lng"]),
        str(case["lat"]),
        sql_quote(json.dumps(case["domains"], ensure_ascii=False)),
        sql_quote(summary),
        sql_quote(body),
        sql_quote(json.dumps(case["sources"], ensure_ascii=False)),
        str(case["author_id"]),
        sql_quote(case["author_name"]),
        sql_quote("published"),
        sql_quote(case["year"]),
        sql_quote(now),
        sql_quote(now),
    ]

    # 重复执行不报错，也顺便把内容更新成最新的一版
    updates = ", ".join(
        f"{c} = excluded.{c}" for c in columns if c not in ("id", "created_at")
    )
    return (
        f"INSERT INTO cases ({', '.join(columns)})\n"
        f"VALUES ({', '.join(values)})\n"
        f"ON CONFLICT(id) DO UPDATE SET {updates};\n"
    )


def main() -> None:
    out = "".join(build(c) for c in CASES)
    out_file = ROOT / ".wrangler" / "seed-cases.sql"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(out, encoding="utf-8")
    print(f"wrote {out_file} ({len(CASES)} case(s))", file=sys.stderr)
    print(out)


if __name__ == "__main__":
    main()
