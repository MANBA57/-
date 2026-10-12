#!/usr/bin/env python3
"""数据质量门禁。管线跑不通就不允许部署。

硬性失败（exit 1）：
  - 数据库缺失或关键表为空
  - 有钱币缺名称 / 类别 / 描述
  - 图片记录指向的文件在磁盘上不存在
  - 图片总体积超过预算
  - 全文检索对标准查询毫无响应

软性告警（exit 0，但打印出来供人工处理）：
  - 无图条目、缺时期的条目、原文声明条数与实际解析条数不一致

用法：
    python scripts/validate.py [--db content/app.db] [--max-image-mb 8]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parent.parent
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))
from app.text_search import to_match_query  # noqa: E402

PROBE_QUERIES = ["布", "青铜", "魏国", "刀币", "空首布", "蚁鼻钱", "圜钱", "战国"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="content/app.db")
    ap.add_argument("--max-image-mb", type=float, default=8.0)
    args = ap.parse_args()

    api_dir = _API_DIR
    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = api_dir / db_path

    errors: list[str] = []
    warnings: list[str] = []

    if not db_path.exists():
        print(f"[validate] ✗ 数据库不存在: {db_path}")
        print("[validate] 请先依次执行 extract_docx.py → process_images.py → build_db.py")
        return 1

    con = sqlite3.connect(db_path)
    cur = con.cursor()

    def scalar(sql: str, *params: object) -> object:
        return cur.execute(sql, params).fetchone()[0]

    # ---- 表与基本计数 ----
    tables = {
        r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
    }
    required = {"coin", "category", "coin_image", "term", "evolution_edge", "coin_fts", "term_fts"}
    missing = required - tables
    if missing:
        errors.append(f"缺少表: {sorted(missing)}")

    n_coin = scalar("SELECT COUNT(*) FROM coin")
    n_cat = scalar("SELECT COUNT(*) FROM category")
    n_img = scalar("SELECT COUNT(*) FROM coin_image")
    n_term = scalar("SELECT COUNT(*) FROM term")
    print(f"[validate] coin={n_coin} category={n_cat} coin_image={n_img} term={n_term}")

    if n_coin == 0:
        errors.append("coin 表为空")
    if n_cat == 0:
        errors.append("category 表为空")
    if n_term == 0:
        warnings.append("term 表为空，术语词典页会是空的")

    # ---- 必填字段 ----
    for col in ("name", "category_key", "description_md"):
        bad = cur.execute(
            f"SELECT slug FROM coin WHERE {col} IS NULL OR TRIM({col}) = ''"
        ).fetchall()
        if bad:
            errors.append(f"{col} 为空的条目: {[b[0] for b in bad]}")

    # ---- 类别外键有效性 ----
    orphan_cat = cur.execute(
        "SELECT slug, category_key FROM coin WHERE category_key NOT IN (SELECT key FROM category)"
    ).fetchall()
    if orphan_cat:
        errors.append(f"类别引用无效: {orphan_cat}")

    # ---- 时期覆盖与来源标注 ----
    no_period = cur.execute(
        "SELECT slug FROM coin WHERE period_key IS NULL OR period_key = ''"
    ).fetchall()
    if no_period:
        warnings.append(f"缺时期的条目（可在 content/overrides/coin_fields.json 补）: {[r[0] for r in no_period]}")

    # ---- 类别导语覆盖 ----
    no_intro = cur.execute(
        "SELECT key FROM category WHERE intro_md IS NULL OR TRIM(intro_md) = ''"
    ).fetchall()
    if no_intro:
        warnings.append(
            f"类别缺导语（可在 content/overrides/category_intro.json 补）: {[r[0] for r in no_intro]}"
        )
    unsigned_cat = cur.execute(
        """SELECT key FROM category
           WHERE intro_md IS NOT NULL AND TRIM(intro_md) <> ''
             AND (intro_source IS NULL OR intro_source = '')"""
    ).fetchall()
    if unsigned_cat:
        errors.append(f"类别有导语但未标注来源（应为 auto/editor）: {[r[0] for r in unsigned_cat]}")

    # 不变量：有时期就必须有来源标注，否则前端无法区分「原文明确」与「推断」
    unsigned = cur.execute(
        """SELECT slug FROM coin
           WHERE period_key IS NOT NULL AND period_key <> ''
             AND (period_source IS NULL OR period_source = '')"""
    ).fetchall()
    if unsigned:
        errors.append(f"有时期但未标注来源（应为 auto/inferred/editor）: {[r[0] for r in unsigned]}")

    bad_source = cur.execute(
        """SELECT DISTINCT period_source FROM coin
           WHERE period_source IS NOT NULL AND period_source NOT IN ('auto','inferred','editor')"""
    ).fetchall()
    if bad_source:
        errors.append(f"未知的 period_source 取值: {[r[0] for r in bad_source]}")

    # ---- 无图条目 ----
    no_img = cur.execute(
        """SELECT c.slug FROM coin c
           WHERE NOT EXISTS (SELECT 1 FROM coin_image i WHERE i.coin_slug = c.slug)"""
    ).fetchall()
    if no_img:
        warnings.append(f"无图条目: {[r[0] for r in no_img]}")

    # ---- 图片文件存在性与体积 ----
    static_root = api_dir / "static"
    total_bytes = 0
    missing_files: list[str] = []
    # 按唯一路径累计体积：原图直出策略下 full/thumb 的 avif/webp 四个字段指向
    # 同一物理文件，按行×列累加会把同一文件重复计 4 次。
    seen_paths: set[str] = set()
    for (fa, fw, ta, tw) in cur.execute(
        "SELECT full_avif, full_webp, thumb_avif, thumb_webp FROM coin_image"
    ):
        for rel in (fa, fw, ta, tw):
            if not rel or rel in seen_paths:
                continue
            seen_paths.add(rel)
            # 路径形如 /images/coins/01-空首布/01.avif，映射回 static 目录
            p = static_root / rel.lstrip("/").replace("images/", "images/", 1)
            if not p.exists():
                missing_files.append(rel)
            else:
                total_bytes += p.stat().st_size
    if missing_files:
        errors.append(f"图片文件缺失 {len(missing_files)} 个，例如: {missing_files[:5]}")

    total_mb = total_bytes / 1048576
    print(f"[validate] 图片文件总体积: {total_mb:.2f} MB（上限 {args.max_image_mb} MB）")
    if total_mb > args.max_image_mb:
        errors.append(f"图片体积 {total_mb:.2f} MB 超过上限 {args.max_image_mb} MB")

    # ---- 全文检索 ----
    fts_fail: list[str] = []
    for q in PROBE_QUERIES:
        mq = to_match_query(q)
        if not mq:
            continue
        try:
            n = scalar("SELECT COUNT(*) FROM coin_fts WHERE coin_fts MATCH ?", mq)
            nt = scalar("SELECT COUNT(*) FROM term_fts WHERE term_fts MATCH ?", mq)
        except sqlite3.OperationalError as exc:
            fts_fail.append(f"{q}({exc})")
            continue
        if n + nt == 0:
            fts_fail.append(q)
    if fts_fail:
        errors.append(f"以下查询在全文索引里毫无命中（索引或分词可能有问题）: {fts_fail}")

    # ---- 来源一致性 ----
    report_path = api_dir / "content" / "generated" / "report.json"
    if report_path.exists():
        rep = json.loads(report_path.read_text(encoding="utf-8"))
        declared, parsed = rep.get("declared_coin_count"), rep.get("parsed_coin_count")
        if declared and parsed and declared != parsed:
            warnings.append(
                f"原文声称 {declared} 种，实际解析 {parsed} 条 —— 源文档未完成，等后续批次补齐"
            )
        if rep.get("overrides_applied"):
            print(f"[validate] 人工覆盖已生效: {rep['overrides_applied']}")

    con.close()

    print()
    if warnings:
        print(f"[validate] ⚠ {len(warnings)} 条告警:")
        for w in warnings:
            print(f"    - {w}")
    if errors:
        print(f"[validate] ✗ {len(errors)} 条硬性失败:")
        for e in errors:
            print(f"    - {e}")
        return 1

    print("[validate] ✓ 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
