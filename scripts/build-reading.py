"""
把共读文献从 docx 转成阅读页用的 JSON（一次性工具）。
产物：public/data/readings/<id>.json
docx 是 PDF 转来的，每个视觉行都是一个段落，所以要先把断行合并回真正的段落。
"""
import json
import re
from pathlib import Path

import docx

SRC = Path(r"C:\Users\zjh22\Downloads\Five Misunderstandings About Case-Study Research.docx")
OUT = Path("public/data/readings/flyvbjerg-case-study.json")

# 章节标题 → 中文题名（翻译，供阅读页双行显示）
SECTIONS = [
    ("Abstract", "摘要"),
    ("Introduction", "引言"),
    ("The Conventional Wisdom About Case-study research", "关于案例研究的成见"),
    ("The Role of Cases in Human Learning", "案例在人的学习中的作用"),
    ("Cases as ‘Black Swans’", "案例作为「黑天鹅」"),
    ("Strategies for Case Selection", "案例选择策略"),
    ("Do Case Studies Contain a Subjective Bias?", "案例研究带有主观偏见吗"),
    ("The Irreducible Quality of Good Case Narratives", "好的案例叙事不可化约的品质"),
    ("Conclusions", "结论"),
    ("References", "参考文献"),
]


def is_para_end(text: str) -> bool:
    t = text.rstrip()
    if len(t) < 40:
        return False
    return bool(re.search(r"[.!?][\'\"”’)]*$", t))


document = docx.Document(str(SRC))
raw = [p.text.strip() for p in document.paragraphs]
compact = [t for t in raw if t]

title = compact[0]
author = compact[1]
reference = compact[2]

heading_index = {}
for name, _ in SECTIONS:
    for i, text in enumerate(compact):
        if text == name:
            heading_index[name] = i
            break

missing = [n for n, _ in SECTIONS if n not in heading_index]
if missing:
    raise SystemExit(f"找不到章节标题: {missing}")

ordered = sorted(heading_index.items(), key=lambda kv: kv[1])

sections = []
for pos, (name, start) in enumerate(ordered):
    end = ordered[pos + 1][1] if pos + 1 < len(ordered) else len(compact)
    body = compact[start + 1 : end]

    paragraphs = []
    buf = ""
    for line in body:
        buf = f"{buf} {line}".strip() if buf else line
        if is_para_end(buf):
            paragraphs.append(re.sub(r"\s{2,}", " ", buf))
            buf = ""
    if buf:
        paragraphs.append(re.sub(r"\s{2,}", " ", buf))

    sections.append(
        {
            "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
            "title": name,
            "titleZh": dict(SECTIONS)[name],
            "paragraphs": paragraphs,
        }
    )

references = next((s for s in sections if s["id"] == "references"), None)
body_sections = [s for s in sections if s["id"] != "references"]

payload = {
    "id": "flyvbjerg-case-study",
    "title": title,
    "titleZh": "案例研究的五个误解",
    "author": author,
    "reference": reference,
    "doi": compact[3].replace("DOI: ", "").replace("10. 1177", "10.1177"),
    "link": "https://journals.sagepub.com/doi/10.1177/1077800405284363",
    "sections": body_sections,
    "references": references["paragraphs"] if references else [],
    "mindmap": None,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

# 文献清单：第四屏「文献共读」用它列出入库的文献
index_path = OUT.parent / "index.json"
index_path.write_text(
    json.dumps(
        {
            "items": [
                {
                    "id": payload["id"],
                    "title": payload["title"],
                    "titleZh": payload["titleZh"],
                    "author": payload["author"],
                    "reference": payload["reference"],
                    "sections": len(body_sections),
                    "paragraphs": sum(len(s["paragraphs"]) for s in body_sections),
                }
            ]
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)

chars = sum(len(p) for s in body_sections for p in s["paragraphs"])
print(f"写出 {OUT}")
print(f"章节 {len(body_sections)} 个，段落 {sum(len(s['paragraphs']) for s in body_sections)} 段，约 {chars} 字符")
for s in body_sections:
    print(f"  {s['id']:<40} {len(s['paragraphs']):>3} 段")
