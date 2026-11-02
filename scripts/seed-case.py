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
        "id": "case_wuxi_hezhang",
        "file": "examples/case-wuxi-hezhang.md",
        "province": "江苏省",
        "city": "无锡市",
        "district": "梁溪区",
        "lng": 120.3017,
        "lat": 31.5747,
        "domains": ["生态治理"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2007",
        "sources": [
            {
                "title": "现代河长从这里走向全国——江苏无锡市河长制实施十年调查（中国水利报）",
                "url": "https://www.chinawater.com.cn/newscenter/kx/201612/t20161209_453237.html",
            },
            {
                "title": "且看「河长」如何治水（人民周刊，2016-12-30）",
                "url": "https://paper.people.com.cn/rmzk/html/2016-12/30/content_1749944.htm",
            },
            {
                "title": "中共中央办公厅 国务院办公厅印发《关于全面推行河长制的意见》",
                "url": "https://www.mee.gov.cn/zcwj/zyygwj/201912/t20191225_751541.shtml",
            },
        ],
    },
    {
        "id": "case_shanghai_mianshen",
        "file": "examples/case-shanghai-mianshen.md",
        "province": "上海市",
        "city": "上海市",
        "district": "黄浦区",
        "lng": 121.4903,
        "lat": 31.2228,
        "domains": ["营商环境"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2026",
        "sources": [
            {
                "title": "《上海市加快打造国际一流营商环境行动方案（2026 年）》解读（上海市政府）",
                "url": "https://www.shanghai.gov.cn/wzjd/20260122/00ae93bb37684c60a8c4fb3b5f2b12e5.html",
            },
            {
                "title": "从「企业找政策」到「政策追企业」——黑龙江构筑营商新模式（新华网）",
                "url": "https://www.news.cn/politics/20250819/bc9eac9dca57401a9a5cc30e6804a159/c.html",
            },
            {
                "title": "龙华「免申即享」改革：一事项一算法（深圳市龙华区）",
                "url": "https://www.szlhq.gov.cn/gkmlpt/content/12/12186/post_12186503.html",
            },
        ],
    },
    {
        "id": "case_dingxi_caili",
        "file": "examples/case-dingxi-caili.md",
        "province": "甘肃省",
        "city": "定西市",
        "district": "安定区",
        "lng": 104.6258,
        "lat": 35.5798,
        "domains": ["乡村振兴"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2022",
        "sources": [
            {
                "title": "治理高价彩礼推动移风易俗（人民日报，2023-03-20）",
                "url": "https://paper.people.com.cn/rmrb/html/2023-03/20/nw.D110000renmrb_20230320_5-07.htm",
            },
            {
                "title": "让彩礼「瘦身」为幸福「加码」（光明日报，2026-05-20）",
                "url": "https://epaper.gmw.cn/gmrb/html/content/202605/20/content_14288.html",
            },
            {
                "title": "陇原新风拂面来——甘肃省移风易俗工作综述（甘肃省人民政府）",
                "url": "http://www.gansu.gov.cn/gsszf/gsyw/202610/174405441.shtml",
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
    {
        "id": "case_ninghai_36tiao",
        "file": "examples/case-ninghai-qingdan.md",
        "province": "浙江省",
        "city": "宁波市",
        "district": "宁海县",
        "lng": 121.4326,
        "lat": 29.2998,
        "domains": ["政务公开"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2014",
        # 信访量与干部、村民两端的例子取自人民日报调查；清单结构与「三委会」修订取自司法部转载的澎湃报道
        "sources": [
            {
                "title": "宁海「小清单」解决乡村治理大问题（人民日报，2018-08-26）",
                "url": "https://www.xinhuanet.com/politics/2018-08/26/c_1123328981.htm",
            },
            {
                "title": "浙江宁波：小微权力清单让乡村权力在阳光下运行（澎湃新闻，司法部转载）",
                "url": "https://www.moj.gov.cn/pub/sfbgw/zwgkztzl/xxxcgcxjpfzsx/fzsxmtgz/fzxcjsjcx/202011/t20201116_173108.html",
            },
            {
                "title": "「36条」清单确保「小微权力」在阳光下运行（中央社会工作部，2024-12-23）",
                "url": "https://www.zyshgzb.gov.cn/n1/2024/1223/c459874-40387770.html",
            },
        ],
    },
    {
        "id": "case_guangdong_tingke",
        "file": "examples/case-guangdong-tingke.md",
        "province": "广东省",
        "city": "广州市",
        "district": "越秀区",
        "lng": 113.2807,
        "lat": 23.1256,
        "domains": ["应急管理"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2014",
        # 通知与指引条款以中国天气网广东站所载全文为准；后续演化（广州分「延迟上学」与「停课」两档）见广州教育口径
        "sources": [
            {
                "title": "广东省教育厅 广东省气象局关于建立教育系统应对台风暴雨停课安排工作机制的通知（附停课安排指引全文）",
                "url": "http://gd.weather.com.cn/jzrzt/2013/07/2165361.shtml",
            },
            {
                "title": "广东台风暴雨极端天气停课安排指引正式实施（羊城晚报，中新网转载，2014-08-01）",
                "url": "https://www.chinanews.com.cn/sh/2014/08-01/6450926.shtml",
            },
            {
                "title": "暴雨、台风期间何时停课停学？指引来了（广州教育）",
                "url": "https://m.itouchtv.cn/article/2d430d1fdcf34e9563db80c5e1a46ec4",
            },
        ],
    },
    {
        "id": "case_nanjing_xiaoxihu",
        "file": "examples/case-nanjing-xiaoxihu.md",
        "province": "江苏省",
        "city": "南京市",
        "district": "秦淮区",
        "lng": 118.7861,
        "lat": 32.0338,
        "domains": ["城市更新"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2015",
        # 规划单元与技术做法取自东南大学团队自述；居民个案与联合国奖项取自中新网
        "sources": [
            {
                "title": "践行人民城市理念——南京小西湖街区保护与再生实践（东南大学建筑学院）",
                "url": "https://arch.seu.edu.cn/2021/1008/c9118a385754/page.htm",
            },
            {
                "title": "南京小西湖历史风貌街区：走入国际视野的老城微更新（中新网，2023-06-18）",
                "url": "https://www.chinanews.com/sh/2023/06-18/10027194.shtml",
            },
            {
                "title": "新华社撰文：「老城南」赓续千年文脉赋能城市更新（秦淮区人民政府转载）",
                "url": "http://www.njqh.gov.cn/ywdt/tpxw/202601/t20260112_5762594.html",
            },
        ],
    },
    {
        "id": "case_shanghai_yangjing",
        "file": "examples/case-shanghai-yangjing.md",
        "province": "上海市",
        "city": "上海市",
        "district": "浦东新区",
        "lng": 121.5677,
        "lat": 31.2459,
        "domains": ["社会组织"],
        "author_id": 1,
        "author_name": "张同学",
        "year": "2013",
        # 机构属性与社区规模取自街道公开简介；筹款与参与式预算数据取自文汇报报道；资助额度取自基金会公开征集公告
        "sources": [
            {
                "title": "上海洋泾社区公益基金会简介（浦东新区人民政府）",
                "url": "https://www.pudong.gov.cn/zwgk/gysy-yjjdzdgz/2022/290/153961.html",
            },
            {
                "title": "从社区规划师到社区基金会，社会组织创新赋能基层治理（文汇报，2024-05-01）",
                "url": "https://www.scf.org.cn/csjjh/n3421/n3424/n3426/u1ai301674.html",
            },
            {
                "title": "一日捐资助项目申请（上海洋泾社区公益基金会）",
                "url": "http://yjcf.org/application/107",
            },
            {
                "title": "全国七成社区基金会在上海，将推动全市 211 个街镇全覆盖（第一财经，2018-09-27）",
                "url": "https://www.yicai.com/news/100033168.html",
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
