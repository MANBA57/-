"""SQL 查询层。

约定：
  - 每个对外函数都接收一个 sqlite3.Connection
  - 批量查询一次性把关联数据取出来，避免 N+1
  - 不在这里做业务校验，那是 router 的职责
"""

from __future__ import annotations

import sqlite3
import time
from typing import Any

from app.text_search import to_match_query
from app.schemas import (
    CategoryBrief,
    CoinBrief,
    CoinDetail,
    EvolutionEdge,
    EvolutionNode,
    EvolutionOut,
    FacetValue,
    FacetsOut,
    ImageOut,
    Range,
    SearchHit,
    SearchOut,
    StatsOut,
    TermOut,
    TimelineEntry,
)

SORT_MAP = {
    "order": "c.order_index ASC",
    "period": "c.period_order ASC, c.order_index ASC",
    "name": "c.name ASC",
    "weight": "COALESCE(c.weight_max_g, 0) DESC, c.order_index ASC",
}


def _ph(n: int) -> str:
    return ",".join("?" * n)


def category_map(con: sqlite3.Connection) -> dict[str, CategoryBrief]:
    return {
        r["key"]: CategoryBrief(key=r["key"], name=r["name"])
        for r in con.execute("SELECT key, name FROM category")
    }


def _dim_map(con: sqlite3.Connection, table: str, column: str, slugs: list[str]) -> dict[str, list[str]]:
    if not slugs:
        return {}
    out: dict[str, list[str]] = {s: [] for s in slugs}
    # 按 rowid（即插入顺序）取，不要 ORDER BY 值：
    # 分析器是按语意顺序插入的（国别为 周王室/卫/郑/宋），
    # 而 SQLite 对中文按 UTF-8 字节序排序会打乱它（卫 U+536B 会排到 周 U+5468 前面）。
    sql = f"SELECT coin_slug, {column} AS v FROM {table} WHERE coin_slug IN ({_ph(len(slugs))}) ORDER BY rowid"
    for r in con.execute(sql, slugs):
        out.setdefault(r["coin_slug"], []).append(r["v"])
    return out


def _image_map(con: sqlite3.Connection, slugs: list[str]) -> dict[str, list[ImageOut]]:
    if not slugs:
        return {}
    out: dict[str, list[ImageOut]] = {s: [] for s in slugs}
    sql = f"""
        SELECT coin_slug, order_index, role, width, height, aspect_ratio, lqip,
               full_avif, full_webp, thumb_avif, thumb_webp
        FROM coin_image
        WHERE coin_slug IN ({_ph(len(slugs))})
        ORDER BY coin_slug, order_index
    """
    for r in con.execute(sql, slugs):
        out.setdefault(r["coin_slug"], []).append(
            ImageOut(
                order=r["order_index"], role=r["role"], width=r["width"], height=r["height"],
                aspect_ratio=r["aspect_ratio"], lqip=r["lqip"],
                avif=r["full_avif"], webp=r["full_webp"],
                thumb_avif=r["thumb_avif"], thumb_webp=r["thumb_webp"],
            )
        )
    return out


def _briefs(con: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[CoinBrief]:
    slugs = [r["slug"] for r in rows]
    cats = category_map(con)
    states = _dim_map(con, "coin_state", "state", slugs)
    materials = _dim_map(con, "coin_material", "material", slugs)
    images = _image_map(con, slugs)
    out: list[CoinBrief] = []
    for r in rows:
        imgs = images.get(r["slug"], [])
        out.append(
            CoinBrief(
                slug=r["slug"], name=r["name"], alias=r["alias"],
                category=cats.get(r["category_key"], CategoryBrief(key=r["category_key"], name=r["category_key"])),
                period_key=r["period_key"], period_source=r["period_source"],
                states=states.get(r["slug"], []), materials=materials.get(r["slug"], []),
                rarity=r["rarity"], image_count=len(imgs),
                thumbnail=imgs[0] if imgs else None,
            )
        )
    return out


def _where(
    category: str | None, period: str | None, state: str | None,
    material: str | None, q: str | None, match_expr: str,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if category:
        clauses.append("c.category_key = ?")
        params.append(category)
    if period:
        clauses.append("c.period_key = ?")
        params.append(period)
    if state:
        clauses.append("EXISTS (SELECT 1 FROM coin_state s WHERE s.coin_slug = c.slug AND s.state = ?)")
        params.append(state)
    if material:
        clauses.append("EXISTS (SELECT 1 FROM coin_material m WHERE m.coin_slug = c.slug AND m.material = ?)")
        params.append(material)
    if q and match_expr:
        clauses.append("c.slug IN (SELECT slug FROM coin_fts WHERE coin_fts MATCH ?)")
        params.append(match_expr)
    sql = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return sql, params


def list_coins(
    con: sqlite3.Connection,
    *,
    category: str | None = None,
    period: str | None = None,
    state: str | None = None,
    material: str | None = None,
    q: str | None = None,
    match_expr: str = "",
    sort: str = "order",
    page: int = 1,
    page_size: int = 24,
) -> tuple[list[CoinBrief], int]:
    where, params = _where(category, period, state, material, q, match_expr)
    total = con.execute(f"SELECT COUNT(*) FROM coin c{where}", params).fetchone()[0]
    order = SORT_MAP.get(sort, SORT_MAP["order"])
    rows = con.execute(
        f"SELECT c.* FROM coin c{where} ORDER BY {order} LIMIT ? OFFSET ?",
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    return _briefs(con, rows), total


def get_coin(con: sqlite3.Connection, slug: str) -> CoinDetail | None:
    r = con.execute("SELECT * FROM coin WHERE slug = ?", (slug,)).fetchone()
    if r is None:
        return None
    brief = _briefs(con, [r])[0]
    images = _image_map(con, [slug]).get(slug, [])
    units = _dim_map(con, "coin_unit", "unit", [slug]).get(slug, [])

    related_rows = con.execute(
        "SELECT * FROM coin WHERE category_key = ? AND slug <> ? ORDER BY order_index LIMIT 4",
        (r["category_key"], slug),
    ).fetchall()
    related = _briefs(con, related_rows)

    def rng(lo: Any, hi: Any) -> Range | None:
        if lo is None and hi is None:
            return None
        return Range(min=lo if lo is not None else hi, max=hi if hi is not None else lo)

    import json

    try:
        overridden = json.loads(r["overridden_fields"] or "[]")
    except (TypeError, ValueError):
        overridden = []

    return CoinDetail(
        **brief.model_dump(),
        period=r["period"],
        year_mentioned=r["year_mentioned"],
        description_md=r["description_md"],
        units=units,
        diameter_mm=rng(r["diameter_min_mm"], r["diameter_max_mm"]),
        length_mm=rng(r["length_min_mm"], r["length_max_mm"]),
        weight_g=rng(r["weight_min_g"], r["weight_max_g"]),
        inscription_front=r["inscription_front"],
        inscription_back=r["inscription_back"],
        images=images,
        related=related,
        overridden_fields=overridden,
    )


def compare_coins(con: sqlite3.Connection, slugs: list[str]) -> list[CoinDetail]:
    out: list[CoinDetail] = []
    for s in slugs:
        d = get_coin(con, s)
        if d is not None:
            out.append(d)
    return out


def facets(con: sqlite3.Connection) -> FacetsOut:
    def vals(sql: str) -> list[FacetValue]:
        return [FacetValue(value=r[0], count=r[1]) for r in con.execute(sql)]

    return FacetsOut(
        categories=vals(
            """SELECT cat.name, COUNT(c.id) FROM category cat
               LEFT JOIN coin c ON c.category_key = cat.key
               GROUP BY cat.key ORDER BY cat.order_index"""
        ),
        periods=vals(
            """SELECT period_key, COUNT(*) FROM coin WHERE period_key IS NOT NULL
               GROUP BY period_key ORDER BY MIN(period_order)"""
        ),
        states=vals(
            """SELECT state, COUNT(*) FROM coin_state GROUP BY state ORDER BY COUNT(*) DESC, state"""
        ),
        materials=vals(
            """SELECT material, COUNT(*) FROM coin_material GROUP BY material ORDER BY COUNT(*) DESC, material"""
        ),
        units=vals(
            """SELECT unit, COUNT(*) FROM coin_unit GROUP BY unit ORDER BY COUNT(*) DESC, unit"""
        ),
    )


def categories(con: sqlite3.Connection) -> list[dict[str, Any]]:
    cats = con.execute("SELECT * FROM category ORDER BY order_index").fetchall()
    out = []
    for cat in cats:
        rows = con.execute(
            "SELECT * FROM coin WHERE category_key = ? ORDER BY order_index", (cat["key"],)
        ).fetchall()
        # 类别示意图：直接用该类别第一条钱币的首图，避免为 4 个类别单独维护一套图
        img_map = _image_map(con, [rows[0]["slug"]]) if rows else {}
        first_imgs = img_map.get(rows[0]["slug"], []) if rows else []
        out.append(
            {
                "key": cat["key"], "name": cat["name"], "intro_md": cat["intro_md"],
                "intro_source": cat["intro_source"],
                "coin_count": len(rows), "images": first_imgs[:1],
            }
        )
    return out


def timeline(con: sqlite3.Connection) -> list[TimelineEntry]:
    rows = con.execute(
        """SELECT period_key, MIN(period_order) AS ord, MIN(period_start_year) AS s,
                  MAX(period_end_year) AS e
           FROM coin WHERE period_key IS NOT NULL
           GROUP BY period_key ORDER BY ord"""
    ).fetchall()
    out: list[TimelineEntry] = []
    for r in rows:
        coin_rows = con.execute(
            "SELECT * FROM coin WHERE period_key = ? ORDER BY order_index", (r["period_key"],)
        ).fetchall()
        out.append(
            TimelineEntry(
                period_key=r["period_key"],
                period_label=r["period_key"],
                start_year=r["s"],
                end_year=r["e"],
                coins=_briefs(con, coin_rows),
            )
        )
    return out


def evolution(con: sqlite3.Connection) -> EvolutionOut:
    rows = con.execute("SELECT * FROM evolution_edge ORDER BY order_index").fetchall()
    name_to_slug = {
        r["name"]: r["slug"] for r in con.execute("SELECT name, slug FROM coin")
    }
    nodes: dict[str, EvolutionNode] = {}
    edges: list[EvolutionEdge] = []
    for r in rows:
        for label in (r["from_label"], r["to_label"]):
            if label in nodes:
                continue
            bare = label.split("（")[0].strip()
            slug = name_to_slug.get(bare)
            nodes[label] = EvolutionNode(
                label=label, system_key=r["system_key"], is_coin=slug is not None, slug=slug
            )
        edges.append(
            EvolutionEdge(
                from_label=r["from_label"], to_label=r["to_label"], kind=r["kind"],
                note=r["note"], system_key=r["system_key"],
            )
        )
    return EvolutionOut(nodes=list(nodes.values()), edges=edges)


def terms(con: sqlite3.Connection, q: str | None = None, match_expr: str = "") -> list[TermOut]:
    if q and match_expr:
        rows = con.execute(
            """SELECT t.* FROM term t
               WHERE t.name IN (SELECT name FROM term_fts WHERE term_fts MATCH ?)
                  OR t.definition_md LIKE ?
               ORDER BY t.order_index""",
            (match_expr, f"%{q}%"),
        ).fetchall()
    else:
        rows = con.execute("SELECT * FROM term ORDER BY order_index").fetchall()

    out: list[TermOut] = []
    for r in rows:
        # 关联钱币：找出正文提到该术语的前 3 枚（复用统一的分词转换，别手搓引号）
        rel = con.execute(
            """SELECT slug FROM coin_fts WHERE coin_fts MATCH ?
               ORDER BY bm25(coin_fts, 10.0, 8.0, 1.0, 2.0) LIMIT 3""",
            (to_match_query(r["name"]),),
        ).fetchall()
        out.append(
            TermOut(
                name=r["name"], pinyin=r["pinyin"], category=r["category"],
                definition_md=r["definition_md"], source=r["source"],
                related_slugs=[x["slug"] for x in rel],
            )
        )
    return out


def search(con: sqlite3.Connection, q: str, match_expr: str, kind: str, limit: int) -> SearchOut:
    t0 = time.perf_counter()
    coins: list[SearchHit] = []
    terms_out: list[SearchHit] = []

    cats = category_map(con)
    if kind in ("all", "coin") and match_expr:
        # 注意：coin_fts 只有 slug/name/alias/description/inscription 五列，
        # category_key 在 coin 表上，必须 JOIN 回去，不能直接从 FTS 表取。
        rows = con.execute(
            """SELECT c.slug, c.name, c.category_key,
                      snippet(coin_fts, 3, '<<', '>>', '…', 18) AS snip
               FROM coin_fts
               JOIN coin c ON c.slug = coin_fts.slug
               WHERE coin_fts MATCH ?
               ORDER BY bm25(coin_fts, 10.0, 8.0, 1.0, 2.0)
               LIMIT ?""",
            (match_expr, limit),
        ).fetchall()
        for r in rows:
            c = cats.get(r["category_key"])
            coins.append(
                SearchHit(
                    type="coin", slug=r["slug"], name=r["name"],
                    snippet=r["snip"] or "", category=c.name if c else None,
                )
            )

    if kind in ("all", "term") and match_expr:
        # 同理，term_fts 只有 name/definition，category 在 term 表上
        rows = con.execute(
            """SELECT t.name, t.category,
                      snippet(term_fts, 1, '<<', '>>', '…', 18) AS snip
               FROM term_fts
               JOIN term t ON t.name = term_fts.name
               WHERE term_fts MATCH ?
               ORDER BY bm25(term_fts, 8.0, 1.0)
               LIMIT ?""",
            (match_expr, limit),
        ).fetchall()
        for r in rows:
            terms_out.append(
                SearchHit(
                    type="term", slug=None, name=r["name"],
                    snippet=r["snip"] or "", category=r["category"],
                )
            )

    return SearchOut(
        query=q,
        match_expression=match_expr,
        total=len(coins) + len(terms_out),
        took_ms=round((time.perf_counter() - t0) * 1000, 2),
        coins=coins,
        terms=terms_out,
    )


def stats(con: sqlite3.Connection) -> StatsOut:
    def one(sql: str, *p: Any) -> Any:
        return con.execute(sql, p).fetchone()[0]

    buckets = [
        FacetValue(value=r[0], count=r[1])
        for r in con.execute(
            """SELECT period_key, COUNT(*) FROM coin WHERE period_key IS NOT NULL
               GROUP BY period_key ORDER BY MIN(period_order)"""
        )
    ]
    # 必须按 sha256 去重再求和：被重复引用的图片在 coin_image 里有多行，
    # 直接 SUM 会把它们算两遍，压缩比就虚高了。
    img_bytes = one(
        "SELECT COALESCE(SUM(output_bytes),0) FROM (SELECT DISTINCT sha256, output_bytes FROM coin_image)"
    )
    src_bytes = one(
        "SELECT COALESCE(SUM(source_bytes),0) FROM (SELECT DISTINCT sha256, source_bytes FROM coin_image)"
    )
    span = con.execute(
        "SELECT MIN(period_start_year), MAX(period_end_year) FROM coin WHERE period_key IS NOT NULL"
    ).fetchone()
    span_txt = ""
    if span and span[0] is not None:
        # 起点在公元前的写「公元前 N 年」；终点按正负分别写「前 N 年 / N 年」，
        # 否则会出现「前 1949 年」这种被误读为公元前的文案
        end_txt = f"前 {abs(span[1])} 年" if span[1] < 0 else f"{span[1]} 年"
        span_txt = f"公元前 {abs(span[0])} 年 — {end_txt}"
    return StatsOut(
        coin_count=one("SELECT COUNT(*) FROM coin"),
        category_count=one("SELECT COUNT(*) FROM category"),
        image_count=one("SELECT COUNT(DISTINCT sha256) FROM coin_image"),
        term_count=one("SELECT COUNT(*) FROM term"),
        evolution_edge_count=one("SELECT COUNT(*) FROM evolution_edge"),
        period_span=span_txt,
        period_buckets=buckets,
        image_bytes=img_bytes,
        source_bytes=src_bytes,
        compression_ratio=round(src_bytes / img_bytes, 1) if img_bytes else None,
    )
