#!/usr/bin/env python3
"""把 raw.json + images.json + 种子数据装配成 SQLite 数据库（含 FTS5 全文索引）。

中文检索的关键：FTS5 默认的 unicode61 分词器会把一整串中文当成**单个 token**，
等于搜不了。这里改用 **trigram** 分词器（SQLite 3.34+），它按三字滑窗建索引，
天然支持中文子串匹配。

用法：
    python scripts/build_db.py [--db content/app.db]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from extract_docx import PERIOD_BY_KEY

_API_DIR = Path(__file__).resolve().parent.parent
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))
from app.text_search import seg, to_match_query  # noqa: E402

SCHEMA = """
-- 刻意不用 WAL：数据库在运行时是只读的（容器里以 :ro 挂载），
-- 而 WAL 模式下**读者也需要写 -shm 文件**，只读挂载会直接打不开库。
-- 本库由管线一次性生成、之后只读，DELETE 日志模式完全够用。
PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;

CREATE TABLE dynasty (
    id          INTEGER PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE category (
    id           INTEGER PRIMARY KEY,
    key          TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    intro_md     TEXT,
    intro_source TEXT,   -- auto（原文自带）| editor（人工补充）
    order_index  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE coin (
    id                INTEGER PRIMARY KEY,
    slug              TEXT UNIQUE NOT NULL,
    dynasty_key       TEXT NOT NULL DEFAULT '先秦',
    name              TEXT NOT NULL,
    alias             TEXT,
    category_key      TEXT NOT NULL REFERENCES category(key),
    period            TEXT,
    period_key        TEXT,
    period_source     TEXT,
    period_start_year INTEGER,
    period_end_year   INTEGER,
    period_order      INTEGER,
    year_mentioned    INTEGER,
    diameter_min_mm   REAL,
    diameter_max_mm   REAL,
    length_min_mm     REAL,
    length_max_mm     REAL,
    weight_min_g      REAL,
    weight_max_g      REAL,
    inscription_front TEXT,
    inscription_back  TEXT,
    rarity            TEXT,
    description_md    TEXT NOT NULL,
    order_index       INTEGER NOT NULL DEFAULT 0,
    source_doc        TEXT,
    overridden_fields TEXT,
    created_at        TEXT NOT NULL
);

CREATE TABLE coin_image (
    id             INTEGER PRIMARY KEY,
    coin_slug      TEXT REFERENCES coin(slug),
    category_key   TEXT REFERENCES category(key),
    sha256         TEXT NOT NULL,
    order_index    INTEGER NOT NULL DEFAULT 0,
    role           TEXT NOT NULL DEFAULT 'coin',
    width          INTEGER,
    height         INTEGER,
    aspect_ratio   REAL,
    lqip           TEXT,
    full_avif      TEXT,
    full_webp      TEXT,
    thumb_avif     TEXT,
    thumb_webp     TEXT,
    source_format  TEXT,
    source_bytes   INTEGER,
    output_bytes   INTEGER,
    CHECK (coin_slug IS NOT NULL OR category_key IS NOT NULL)
);

-- 维度拆表：/facets 与筛选走这里，避免对 JSON 列做 LIKE 扫描
CREATE TABLE coin_state    (coin_slug TEXT NOT NULL REFERENCES coin(slug), state    TEXT NOT NULL, PRIMARY KEY (coin_slug, state));
CREATE TABLE coin_material (coin_slug TEXT NOT NULL REFERENCES coin(slug), material TEXT NOT NULL, PRIMARY KEY (coin_slug, material));
CREATE TABLE coin_unit     (coin_slug TEXT NOT NULL REFERENCES coin(slug), unit     TEXT NOT NULL, PRIMARY KEY (coin_slug, unit));

CREATE TABLE term (
    id            INTEGER PRIMARY KEY,
    name          TEXT UNIQUE NOT NULL,
    pinyin        TEXT,
    category      TEXT,
    definition_md TEXT NOT NULL,
    source        TEXT,
    order_index   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE evolution_edge (
    id          INTEGER PRIMARY KEY,
    system_key  TEXT NOT NULL,
    from_label  TEXT NOT NULL,
    to_label    TEXT NOT NULL,
    kind        TEXT,
    note        TEXT,
    order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_coin_category ON coin(category_key);
CREATE INDEX idx_coin_period   ON coin(period_order);
CREATE INDEX idx_coin_name     ON coin(name);
CREATE INDEX idx_img_coin      ON coin_image(coin_slug);
CREATE INDEX idx_img_category  ON coin_image(category_key);
CREATE INDEX idx_state_state   ON coin_state(state);
CREATE INDEX idx_mat_material  ON coin_material(material);

-- 分词方案：索引时把汉字逐个拆成 token（见 app/text_search.py 的 seg()），
-- 检索时把「青铜」拼成短语 "青 铜"。这样 1 字 / 2 字 / 多字中文查询都能命中，
-- 而 unicode61 会把整串中文当一个 token、trigram 又要求查询 ≥3 字。
CREATE VIRTUAL TABLE coin_fts USING fts5(
    slug UNINDEXED, name, alias, description, inscription,
    tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE term_fts USING fts5(
    name, definition,
    tokenize = 'unicode61'
);
"""


def rng(v: dict | None) -> tuple[float | None, float | None]:
    if not v:
        return (None, None)
    return (v.get("min"), v.get("max"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="content/app.db")
    ap.add_argument("--raw", default="content/generated/raw.json")
    ap.add_argument("--images", default="content/generated/images.json")
    ap.add_argument("--terms", default="content/seed/terms.json")
    ap.add_argument("--evolution", default="content/seed/evolution.json")
    # 朝代分册数据（docs/钱币简介/）：extract_dynasties.py + import_dynasties.py 产出。
    # 文件存在即自动并入，不存在则跳过（纯先秦流程不受影响）。
    ap.add_argument("--dynasties", default="content/generated/dynasties_import.json")
    ap.add_argument("--dynasties-images", default="content/generated/dynasties_images.json")
    args = ap.parse_args()

    api_dir = Path(__file__).resolve().parent.parent

    def resolve(p: str) -> Path:
        q = Path(p)
        return q if q.is_absolute() else api_dir / q

    raw = json.loads(resolve(args.raw).read_text(encoding="utf-8"))
    images = json.loads(resolve(args.images).read_text(encoding="utf-8"))
    terms = json.loads(resolve(args.terms).read_text(encoding="utf-8"))["terms"]
    edges = json.loads(resolve(args.evolution).read_text(encoding="utf-8"))["edges"]

    db_path = resolve(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    for suffix in ("-wal", "-shm"):
        side = db_path.with_name(db_path.name + suffix)
        if side.exists():
            side.unlink()

    import sqlite3

    con = sqlite3.connect(db_path)
    # 用 Row 工厂：预渲染元数据那段按列名取值，元组下标会很难读也容易错
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    cur = con.cursor()
    now = datetime.now(timezone.utc).isoformat()

    cur.execute(
        "INSERT INTO dynasty(key, name, order_index) VALUES (?,?,?)", ("xianqin", "先秦", 0)
    )

    # ---- 类别 ----
    for cat in raw["categories"]:
        cur.execute(
            "INSERT INTO category(key, name, intro_md, intro_source, order_index) VALUES (?,?,?,?,?)",
            (cat["key"], cat["name"], cat["intro_md"], cat.get("intro_source"), cat["order"]),
        )

    # ---- 钱币 ----
    order_counter = 0
    for cat in raw["categories"]:
        for coin in cat["coins"]:
            f = coin["fields"]
            pk = f.get("period_key")
            pmeta = PERIOD_BY_KEY.get(pk) if pk else None
            dmin, dmax = rng(f.get("diameter_mm"))
            lmin, lmax = rng(f.get("length_mm"))
            wmin, wmax = rng(f.get("weight_g"))
            order_counter += 1
            cur.execute(
                """
                INSERT INTO coin(
                    slug, dynasty_key, name, alias, category_key,
                    period, period_key, period_source,
                    period_start_year, period_end_year, period_order, year_mentioned,
                    diameter_min_mm, diameter_max_mm, length_min_mm, length_max_mm,
                    weight_min_g, weight_max_g,
                    inscription_front, inscription_back, rarity,
                    description_md, order_index, source_doc, overridden_fields, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    coin["slug"], "先秦", coin["name"], f.get("alias"), cat["key"],
                    f.get("period"), pk, f.get("period_source"),
                    pmeta[1] if pmeta else None, pmeta[2] if pmeta else None,
                    pmeta[3] if pmeta else None, f.get("year_mentioned"),
                    dmin, dmax, lmin, lmax, wmin, wmax,
                    f.get("inscription_front"), f.get("inscription_back"), f.get("rarity"),
                    coin["description_md"], order_counter, raw["meta"]["source_doc"],
                    json.dumps(coin.get("overridden_fields") or [], ensure_ascii=False), now,
                ),
            )
            for s in f.get("states") or []:
                cur.execute("INSERT OR IGNORE INTO coin_state VALUES (?,?)", (coin["slug"], s))
            for m in f.get("materials") or []:
                cur.execute("INSERT OR IGNORE INTO coin_material VALUES (?,?)", (coin["slug"], m))
            for u in f.get("units") or []:
                cur.execute("INSERT OR IGNORE INTO coin_unit VALUES (?,?)", (coin["slug"], u))

    # ---- 图片 ----
    img_by_sha = images["images"]
    img_rows = 0
    for cat in raw["categories"]:
        for im in cat["images"]:
            meta = img_by_sha.get(im["sha256"])
            if not meta:
                continue
            cur.execute(
                """INSERT INTO coin_image(
                       coin_slug, category_key, sha256, order_index, role,
                       width, height, aspect_ratio, lqip,
                       full_avif, full_webp, thumb_avif, thumb_webp,
                       source_format, source_bytes, output_bytes)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    None, cat["key"], im["sha256"], im["order"], "category",
                    meta["width"], meta["height"], meta["aspect_ratio"], meta["lqip"],
                    meta["full"]["avif"], meta["full"]["webp"],
                    meta["thumb"]["avif"], meta["thumb"]["webp"],
                    meta["source_format"], meta["source_bytes"],
                    meta["full"]["bytes_avif"] + meta["full"]["bytes_webp"]
                    + meta["thumb"]["bytes_avif"] + meta["thumb"]["bytes_webp"],
                ),
            )
            img_rows += 1
        for coin in cat["coins"]:
            for im in coin["images"]:
                meta = img_by_sha.get(im["sha256"])
                if not meta:
                    continue
                cur.execute(
                    """INSERT INTO coin_image(
                           coin_slug, category_key, sha256, order_index, role,
                           width, height, aspect_ratio, lqip,
                           full_avif, full_webp, thumb_avif, thumb_webp,
                           source_format, source_bytes, output_bytes)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        coin["slug"], None, im["sha256"], im["order"], "coin",
                        meta["width"], meta["height"], meta["aspect_ratio"], meta["lqip"],
                        meta["full"]["avif"], meta["full"]["webp"],
                        meta["thumb"]["avif"], meta["thumb"]["webp"],
                        meta["source_format"], meta["source_bytes"],
                        meta["full"]["bytes_avif"] + meta["full"]["bytes_webp"]
                        + meta["thumb"]["bytes_avif"] + meta["thumb"]["bytes_webp"],
                    ),
                )
                img_rows += 1

    # ---- 朝代分册（秦至明末，原图直出）----
    # dynasty 表原本只插先秦一行、coin.dynasty_key 写死「先秦」，此处按
    # dynasties_import.json 的注册信息扩展；先秦时期序最大为 4（战国晚期），
    # 朝代 period_order 统一 +4 错开，保证时间轴先后正确。
    dyn_path = resolve(args.dynasties)
    dyn_img_path = resolve(args.dynasties_images)
    if dyn_path.exists():
        dyn = json.loads(dyn_path.read_text(encoding="utf-8"))
        dyn_images: dict[str, dict[str, object]] = {}
        if dyn_img_path.exists():
            dyn_images = json.loads(dyn_img_path.read_text(encoding="utf-8"))["images"]
        else:
            print("[db] ⚠ 未找到朝代图片 manifest，钱币将无图入库")
        src_by_key = {d["key"]: f"docs/钱币简介/{d['file']}" for d in dyn["dynasties"]}

        for d in dyn["dynasties"]:
            cur.execute(
                "INSERT INTO dynasty(key, name, order_index) VALUES (?,?,?)",
                (d["key"], d["name"], d["order_index"]),
            )
        for cat in dyn["categories"]:
            cur.execute(
                "INSERT INTO category(key, name, intro_md, intro_source, order_index) VALUES (?,?,?,?,?)",
                (cat["key"], cat["name"], cat.get("intro_md"), cat.get("intro_source"), cat.get("order", 4)),
            )

        dyn_img_rows = 0
        for coin in dyn["coins"]:
            f = coin["fields"]
            pk = f.get("period_key")
            pmeta = PERIOD_BY_KEY.get(pk) if pk else None
            dmin, dmax = rng(f.get("diameter_mm"))
            lmin, lmax = rng(f.get("length_mm"))
            wmin, wmax = rng(f.get("weight_g"))
            order_counter += 1
            cur.execute(
                """
                INSERT INTO coin(
                    slug, dynasty_key, name, alias, category_key,
                    period, period_key, period_source,
                    period_start_year, period_end_year, period_order, year_mentioned,
                    diameter_min_mm, diameter_max_mm, length_min_mm, length_max_mm,
                    weight_min_g, weight_max_g,
                    inscription_front, inscription_back, rarity,
                    description_md, order_index, source_doc, overridden_fields, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    coin["slug"], coin["dynasty_key"], coin["name"], f.get("alias"), coin["category_key"],
                    f.get("period"), pk, f.get("period_source"),
                    f.get("period_start_year"), f.get("period_end_year"),
                    4 + f["period_order"] if f.get("period_order") else (pmeta[3] if pmeta else None),
                    f.get("year_mentioned"),
                    dmin, dmax, lmin, lmax, wmin, wmax,
                    f.get("inscription_front"), f.get("inscription_back"), f.get("rarity"),
                    coin["description_md"], order_counter,
                    src_by_key.get(coin["dynasty_key"]),
                    json.dumps(coin.get("overridden_fields") or [], ensure_ascii=False), now,
                ),
            )
            for s in f.get("states") or []:
                cur.execute("INSERT OR IGNORE INTO coin_state VALUES (?,?)", (coin["slug"], s))
            for m in f.get("materials") or []:
                cur.execute("INSERT OR IGNORE INTO coin_material VALUES (?,?)", (coin["slug"], m))
            for u in f.get("units") or []:
                cur.execute("INSERT OR IGNORE INTO coin_unit VALUES (?,?)", (coin["slug"], u))
            for im in coin["images"]:
                meta = dyn_images.get(str(im["sha256"]))
                if not meta:
                    continue
                cur.execute(
                    """INSERT INTO coin_image(
                           coin_slug, category_key, sha256, order_index, role,
                           width, height, aspect_ratio, lqip,
                           full_avif, full_webp, thumb_avif, thumb_webp,
                           source_format, source_bytes, output_bytes)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        coin["slug"], None, im["sha256"], im["order"], "coin",
                        meta["width"], meta["height"], meta["aspect_ratio"], meta["lqip"],
                        meta["full"]["avif"], meta["full"]["webp"],
                        meta["thumb"]["avif"], meta["thumb"]["webp"],
                        meta["source_format"], meta["source_bytes"],
                        meta["source_bytes"],  # 原图直出：输出字节数 = 源字节数
                    ),
                )
                dyn_img_rows += 1
        print(f"[db] 朝代分册: dynasty +{len(dyn['dynasties'])} / coin +{len(dyn['coins'])} / "
              f"coin_image +{dyn_img_rows}")
    else:
        print(f"[db] 未找到 {dyn_path}，跳过朝代分册导入")

    # ---- 术语 ----
    for i, t in enumerate(terms):
        cur.execute(
            """INSERT INTO term(name, pinyin, category, definition_md, source, order_index)
               VALUES (?,?,?,?,?,?)""",
            (t["name"], t.get("pinyin"), t.get("category"), t["definition_md"], t.get("source"), i),
        )

    # ---- 演化关系 ----
    for i, e in enumerate(edges):
        cur.execute(
            """INSERT INTO evolution_edge(system_key, from_label, to_label, kind, note, order_index)
               VALUES (?,?,?,?,?,?)""",
            (e["system_key"], e["from_label"], e["to_label"], e.get("kind"), e.get("note"), i),
        )

    # ---- FTS5 索引（汉字逐字拆分成 token，见 app/text_search.py） ----
    coin_rows = cur.execute(
        """SELECT slug, name, COALESCE(alias,''), description_md,
                  COALESCE(inscription_front,'') || ' ' || COALESCE(inscription_back,'')
           FROM coin"""
    ).fetchall()
    cur.executemany(
        "INSERT INTO coin_fts(slug, name, alias, description, inscription) VALUES (?,?,?,?,?)",
        [(r[0], seg(r[1]), seg(r[2]), seg(r[3]), seg(r[4])) for r in coin_rows],
    )
    term_rows = cur.execute("SELECT name, definition_md FROM term").fetchall()
    cur.executemany(
        "INSERT INTO term_fts(name, definition) VALUES (?,?)",
        [(seg(r[0]), seg(r[1])) for r in term_rows],
    )

    con.commit()

    def count(table: str) -> int:
        return cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    print(f"[db] 数据库: {db_path}")
    print(f"[db] dynasty={count('dynasty')} category={count('category')} coin={count('coin')} "
          f"coin_image={count('coin_image')} term={count('term')} evolution_edge={count('evolution_edge')}")
    print(f"[db] 维度: state={count('coin_state')} material={count('coin_material')} unit={count('coin_unit')}")

    # 自检：不同长度的中文查询是否都能命中
    probes = ["布", "青铜", "魏国", "刀币", "空首布", "纪重铭文", "蚁鼻钱", "圜钱"]
    for p in probes:
        mq = to_match_query(p)
        n = cur.execute("SELECT COUNT(*) FROM coin_fts WHERE coin_fts MATCH ?", (mq,)).fetchone()[0]
        nt = cur.execute("SELECT COUNT(*) FROM term_fts WHERE term_fts MATCH ?", (mq,)).fetchone()[0]
        flag = "OK " if (n + nt) > 0 else "MISS"
        print(f"[db] FTS 自检 {flag} 「{p}」-> 钱币 {n} 条 / 术语 {nt} 条  MATCH={mq}")

    # ---- 人工校对表 ----
    import csv

    review_dir = api_dir / "content" / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    csv_path = review_dir / "coins.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "序号", "slug", "名称", "别名", "类别", "时期", "时期来源",
            "国别", "材质", "记重单位",
            "直径_min_mm", "直径_max_mm", "通长_min_mm", "通长_max_mm",
            "重量_min_g", "重量_max_g", "面文", "背文", "存世",
            "图片数", "描述字数", "人工覆盖字段",
        ])
        for r in cur.execute(
            """
            SELECT c.order_index, c.slug, c.name, COALESCE(c.alias,''), cat.name,
                   COALESCE(c.period,''), COALESCE(c.period_source,''),
                   (SELECT GROUP_CONCAT(state,'/') FROM coin_state WHERE coin_slug=c.slug),
                   (SELECT GROUP_CONCAT(material,'/') FROM coin_material WHERE coin_slug=c.slug),
                   (SELECT GROUP_CONCAT(unit,'/') FROM coin_unit WHERE coin_slug=c.slug),
                   c.diameter_min_mm, c.diameter_max_mm, c.length_min_mm, c.length_max_mm,
                   c.weight_min_g, c.weight_max_g,
                   COALESCE(c.inscription_front,''), COALESCE(c.inscription_back,''),
                   COALESCE(c.rarity,''),
                   (SELECT COUNT(*) FROM coin_image WHERE coin_slug=c.slug),
                   LENGTH(c.description_md), COALESCE(c.overridden_fields,'')
            FROM coin c JOIN category cat ON cat.key = c.category_key
            ORDER BY c.order_index
            """
        ):
            w.writerow(["" if v is None else v for v in r])

    print(f"[db] 校对表: {csv_path}")

    # ---- 预渲染用的路由元数据 ----
    # 前端构建期读这个文件，为每条路由生成带独立 <title>/<meta>/OG/JSON-LD
    # 的静态 HTML。刻意让管线产出而不是让前端去请求 API ——
    # 否则前端构建就得依赖后端正在运行，构建会变脆。
    import re as _re

    def plain(md: str, limit: int) -> str:
        t = _re.sub(r"\*\*(.+?)\*\*", r"\1", md or "")
        t = _re.sub(r"\s+", " ", t).strip()
        return t[:limit] + ("…" if len(t) > limit else "")

    SITE = "数字钱币库·先秦馆"
    prerender_routes: list[dict[str, object]] = [
        {
            "path": "/",
            "title": f"{SITE} —— 先秦四大货币体系的数字化展馆",
            "description": "布币、刀币、圜钱、贝币——从农具、削刀、纺轮与海贝演变而来的中国最早一批金属铸币。可检索、可对比、可沿时间轴浏览。",
            "changefreq": "weekly",
            "priority": "1.0",
        },
        {
            "path": "/coins",
            "title": f"钱币库 · {SITE}",
            "description": "按货币体系、时期、国别、材质四个维度检索先秦钱币，支持按年代与重量排序。",
            "changefreq": "weekly",
            "priority": "0.9",
        },
        {
            "path": "/timeline",
            "title": f"时间轴 · {SITE}",
            "description": "从商周到秦统一，按时期浏览先秦钱币的形制演变。",
            "changefreq": "monthly",
            "priority": "0.8",
        },
        {
            "path": "/evolution",
            "title": f"货币体系演化 · {SITE}",
            "description": "农具铲变布币，削刀变刀币，玉璧纺轮变圜钱——四大货币体系的演变关系图。",
            "changefreq": "monthly",
            "priority": "0.8",
        },
        {
            "path": "/terms",
            "title": f"术语词典 · {SITE}",
            "description": "釿、寽、朋、朱——读懂先秦钱文里的记重单位与形制术语。",
            "changefreq": "monthly",
            "priority": "0.7",
        },
        {
            "path": "/about",
            "title": f"关于 · {SITE}",
            "description": "作品定位、数据来源与推断标注说明、技术实现。",
            "changefreq": "monthly",
            "priority": "0.6",
        },
    ]

    for r in cur.execute(
        """SELECT c.slug, c.name, c.alias, cat.name AS cat_name, c.period_key,
                  c.description_md
           FROM coin c JOIN category cat ON cat.key = c.category_key
           ORDER BY c.order_index"""
    ):
        bits = [r["name"]]
        if r["alias"]:
            bits.append(f"又称{r['alias']}")
        if r["period_key"]:
            bits.append(r["period_key"])
        bits.append(r["cat_name"])
        prerender_routes.append(
            {
                "path": f"/coins/{r['slug']}",
                "title": f"{r['name']} · {' · '.join(bits[2:])} · {SITE}",
                "description": plain(r["description_md"], 110),
                "contentHtml": "".join(
                    f"<p>{plain(p, 400)}</p>"
                    for p in (r["description_md"] or "").split("\n")
                    if p.strip()
                ),
                "changefreq": "yearly",
                "priority": "0.7",
            }
        )

    prerender_path = api_dir / "content" / "generated" / "prerender.json"
    prerender_path.parent.mkdir(parents=True, exist_ok=True)
    prerender_path.write_text(
        json.dumps(
            {
                "site": {
                    "name": SITE,
                    "description": "先秦四大货币体系的数字化展馆",
                    "lang": "zh-CN",
                },
                "routes": prerender_routes,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[db] 预渲染元数据: {prerender_path}（{len(prerender_routes)} 条路由）")

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
