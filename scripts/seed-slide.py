"""把一个展位写进线上 slides 表（一次性工具）。
用法：python scripts/seed-slide.py | npx wrangler d1 execute innovation-localgov --remote --file -
"""
import io
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SLIDES = [
    {
        "id": "slide_xian_shangban",
        "title": "西安市「商办同圈」：政务大厅为什么开进商场",
        "course": "地方政府创新",
        "term": "2026 秋",
        "author_id": 1,
        "author_name": "张同学",
        "slides": 21,
        "description": (
            "西安新城区把政务大厅搬进解放路商圈的商业综合体，让办事人流进入老城商业空间。"
            "展示沿三件事推进：办事人过去为什么要一天跑三个地方；老城商业为什么需要新的客流；"
            "以及这次搬迁如何把分散的服务网点重新归集。每页都标注了资料来源，"
            "包括极目新闻、海报新闻、人民日报与人民网的相关报道。"
        ),
        # 原 pptx 26MB 超 KV 单值上限，用 PowerPoint 转成 1.8MB 的 PDF 存进 KV，
        # file_url 指向读取接口，详情页 iframe 内嵌预览
        "file_url": "/api/slides/slide_xian_shangban/file",
        "cover_url": "",
    }
]


def q(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def build(item: dict) -> str:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cols = [
        "id", "title", "course", "term", "author_id", "author_name",
        "cover_url", "file_url", "description", "slide_count",
        "status", "visibility", "created_at",
    ]
    vals = [
        q(item["id"]), q(item["title"]), q(item["course"]), q(item["term"]),
        str(item["author_id"]), q(item["author_name"]),
        q(item["cover_url"]), q(item["file_url"]), q(item["description"]),
        str(item["slides"]), q("published"), q("public"), q(now),
    ]
    updates = ", ".join(
        f"{c} = excluded.{c}" for c in cols if c not in ("id", "created_at")
    )
    return (
        f"INSERT INTO slides ({', '.join(cols)})\n"
        f"VALUES ({', '.join(vals)})\n"
        f"ON CONFLICT(id) DO UPDATE SET {updates};\n"
    )


out = "".join(build(s) for s in SLIDES)
path = ROOT / ".wrangler" / "seed-slides.sql"
path.parent.mkdir(parents=True, exist_ok=True)
io.open(path, "w", encoding="utf-8", newline="\n").write(out)
print(f"wrote {path}", file=__import__("sys").stderr)
