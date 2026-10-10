#!/usr/bin/env python3
"""从《先秦(2).docx》抽取结构化钱币数据。

源文档特点（已实测）：
  - 85.9 MB，正文仅 103 KB；81.9 MB 全是图片（49 个文件，被引用 50 次）
  - 全部段落都是 Normal 样式，**没有标题层级**，靠「一、布币类」「1. 空首布」编号分节
  - 图片段落紧跟在条目描述之后 → 属于该钱币；出现在某类第一条之前 → 属于该类别
  - 同一张图可能被重复引用（image27/28），需按 sha256 去重

输出：
  content/generated/raw.json     解析结果
  content/generated/report.json  切分报告（用于人工核对解析是否正确）

用法：
    python scripts/extract_docx.py [--docx PATH] [--out DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

# --------------------------------------------------------------------------- 常量

DEFAULT_DOCX_CANDIDATES = [
    Path("data") / "先秦(2).docx",
    Path(r"C:\github\钱币数据\先秦(2).docx"),
]

# 类别名 → 稳定 key。文档里「刀币类」漏写了序号「二、」，所以两个写法都要认。
CATEGORY_KEYS = {
    "布币类": "bu",
    "刀币类": "dao",
    "圜钱类": "yuan",
    "贝币与原始货币类": "bei",
}

CATEGORY_RE = re.compile(
    r"^\s*[一二三四五六七八九十]*\s*[、.．]?\s*"
    r"(布币类|刀币类|圜钱类|贝币与原始货币类)\s*$"
)
ENTRY_RE = re.compile(r"^\s*(\d{1,3})\s*[.．、]\s*(\S.{0,40}?)\s*$")

# 时期 → (起年, 止年, 排序权重)。起止年用于时间轴，均为约数。
PERIODS: list[tuple[str, int, int, int]] = [
    ("商周", -1600, -771, 0),
    ("春秋", -770, -476, 1),
    ("战国早期", -475, -351, 2),
    ("战国中期", -350, -281, 3),
    ("战国晚期", -280, -221, 4),
]
PERIOD_BY_KEY = {p[0]: p for p in PERIODS}

# 关键词 → 归一化时期。顺序敏感：先长后短。
PERIOD_PATTERNS: list[tuple[str, str]] = [
    ("商周", "商周"), ("西周", "商周"), ("商代", "商周"),
    ("春秋晚期", "春秋"), ("春秋早期", "春秋"), ("春秋时期", "春秋"), ("春秋", "春秋"),
    ("战国早中期", "战国早期"), ("战国早期", "战国早期"), ("战国前期", "战国早期"),
    ("战国中晚期", "战国中期"), ("战国中期", "战国中期"),
    ("战国末期", "战国晚期"), ("战国晚期", "战国晚期"), ("战国后期", "战国晚期"),
    ("战国", "战国中期"),  # 兜底：只说「战国」时按中期
]

# 这些关键词只是泛称，不能当作原文明确了时期。
# 命中的条目 period_source 记为 inferred，前端应与 auto（原文明确）区别展示。
FALLBACK_PERIOD_KEYWORDS = {"战国"}

STATES = ["周王室", "周王畿", "三晋", "中山", "山戎", "白狄",
          "韩", "赵", "魏", "齐", "燕", "楚", "秦", "卫", "郑", "宋"]

# 材质：不用裸字匹配。裸「铜」「金」「石」「骨」会把「金属铸币」「两枚」这类
# 普通词语误判成材质，必须带上下文。
MATERIAL_PATTERNS: list[tuple[str, str]] = [
    ("青铜", r"青铜"),
    ("红铜", r"红铜"), ("黄铜", r"黄铜"), ("白铜", r"白铜"),
    ("海贝", r"天然海贝|海贝"),
    ("石贝", r"石贝"), ("骨贝", r"骨贝"), ("铜贝", r"铜贝"),
    ("金", r"金币|黄金"),
]

# 记重单位：裸「两」会命中「两枚」「两者」等，只在明确语境下才算。
UNIT_PATTERNS: list[tuple[str, str]] = [
    ("釿", r"釿"), ("寽", r"寽"), ("朋", r"朋"), ("朱", r"十二朱|四朱"),
    ("两", r"半两|一两|“两”|「两」"),
]

NUM = r"[\d.]+"
LEN_UNITS = {"毫米": 1.0, "mm": 1.0, "厘米": 10.0, "cm": 10.0}


# --------------------------------------------------------------------------- 工具


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def norm_len(value: str, unit: str) -> float:
    return round(float(value) * LEN_UNITS.get(unit.lower(), 1.0), 2)


def find_ranges(text: str, label: str) -> tuple[float, float] | None:
    """抓「直径约18至19.5毫米」「通长15至18厘米」这类尺寸。统一换算成毫米，
    返回 (最小值, 最大值)；抓不到返回 None。"""
    unit_alt = "|".join(LEN_UNITS)
    out: list[tuple[float, float]] = []
    # 区间：18至19.5毫米 / 18-19.5mm
    for m in re.finditer(
        rf"{label}\s*(?:约|为|在)?\s*({NUM})\s*(?:至|到|-|–|—|~|～)\s*({NUM})\s*({unit_alt})",
        text,
    ):
        a = norm_len(m.group(1), m.group(3))
        b = norm_len(m.group(2), m.group(3))
        out.append((min(a, b), max(a, b)))
    # 单值：直径约2.8厘米
    for m in re.finditer(rf"{label}\s*(?:约|为|在)?\s*({NUM})\s*({unit_alt})", text):
        v = norm_len(m.group(1), m.group(2))
        out.append((v, v))
    if not out:
        return None
    return (min(a for a, _ in out), max(b for _, b in out))


def find_weight_range(text: str) -> tuple[float, float] | None:
    span = re.search(
        r"重(?:量)?\s*(?:约|为|在)?\s*([\d.]+)\s*(?:至|到|-|–|—|~|～)\s*([\d.]+)\s*克", text
    )
    if span:
        a, b = float(span.group(1)), float(span.group(2))
        return (min(a, b), max(a, b))
    single = re.search(r"重(?:量)?\s*(?:约|为|在)?\s*([\d.]+)\s*克", text)
    if single:
        v = float(single.group(1))
        return (v, v)
    return None


def extract_quoted(text: str, label: str) -> str | None:
    m = re.search(rf"{label}\s*[“\"]([^”\"]+)[”\"]", text)
    return m.group(1).strip() if m else None


def dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


# --------------------------------------------------------------------------- 结构


@dataclass
class ImageRef:
    media: str
    sha256: str
    role: str  # coin | category
    order: int


@dataclass
class Coin:
    order: int
    name: str
    alias: str | None = None
    description: str = ""
    category_key: str = ""
    images: list[ImageRef] = field(default_factory=list)
    fields: dict[str, object] = field(default_factory=dict)


@dataclass
class Category:
    key: str
    name: str
    order: int
    intro: str = ""
    intro_source: str | None = None  # auto | editor
    images: list[ImageRef] = field(default_factory=list)
    coins: list[Coin] = field(default_factory=list)


# --------------------------------------------------------------------------- 主流程


def read_media(docx_path: Path) -> dict[str, dict[str, object]]:
    """读出所有 word/media/* 的字节、sha256 与体积。"""
    media: dict[str, dict[str, object]] = {}
    with zipfile.ZipFile(docx_path) as zf:
        for info in zf.infolist():
            # 跳过目录项（zip 里存在 word/media/ 这个目录条目，否则会被当成一张图）
            if info.is_dir() or info.filename.endswith("/"):
                continue
            if not info.filename.startswith("word/media/"):
                continue
            name = Path(info.filename).name
            data = zf.read(info.filename)
            media[name] = {
                "name": name,
                "bytes": len(data),
                "sha256": sha256_of(data),
                "zip_path": info.filename,
            }
    return media


def parse(docx_path: Path) -> dict[str, object]:
    doc = Document(str(docx_path))
    rels = doc.part.rels
    media = read_media(docx_path)

    def rel_to_media(rid: str) -> str | None:
        rel = rels.get(rid)
        if rel is None:
            return None
        target = rel.target_ref
        if "media/" not in target:
            return None
        return target.split("/")[-1]

    body = doc.element.body
    blocks: list[Paragraph] = [
        Paragraph(child, doc) for child in body.iterchildren() if child.tag == qn("w:p")
    ]

    categories: list[Category] = []
    current_cat: Category | None = None
    current_coin: Coin | None = None
    orphans: list[dict[str, object]] = []
    meta_title = ""
    meta_intro = ""
    image_order = 0

    def add_images(par: Paragraph, role: str) -> int:
        nonlocal image_order
        rids = re.findall(r'r:embed="([^"]+)"', par._p.xml)
        added = 0
        for rid in rids:
            name = rel_to_media(rid)
            if not name or name not in media:
                orphans.append({"kind": "image_unresolved", "rid": rid, "text": par.text.strip()})
                continue
            ref = ImageRef(
                media=name, sha256=str(media[name]["sha256"]), role=role, order=image_order
            )
            image_order += 1
            if role == "category" and current_cat is not None:
                current_cat.images.append(ref)
            elif current_coin is not None:
                current_coin.images.append(ref)
            else:
                orphans.append({"kind": "image_orphan", "media": name})
            added += 1
        return added

    for idx, par in enumerate(blocks):
        text = par.text.strip()
        has_image = 'r:embed="' in par._p.xml or "w:drawing" in par._p.xml

        if has_image:
            add_images(par, "category" if current_coin is None else "coin")
            if not text:
                continue

        if not text:
            continue

        # 类别标题
        cat_m = CATEGORY_RE.match(text)
        if cat_m:
            cat_name = cat_m.group(1)
            current_cat = Category(
                key=CATEGORY_KEYS[cat_name], name=cat_name, order=len(categories)
            )
            categories.append(current_cat)
            current_coin = None
            continue

        # 条目
        entry_m = ENTRY_RE.match(text)
        if entry_m and current_cat is not None:
            raw_name = entry_m.group(2).strip()
            alias = None
            paren = re.match(r"^(.+?)[（(](.+?)[）)]$", raw_name)
            if paren:
                raw_name, alias = paren.group(1).strip(), paren.group(2).strip()
            current_coin = Coin(
                order=int(entry_m.group(1)),
                name=raw_name,
                alias=alias,
                category_key=current_cat.key,
            )
            current_cat.coins.append(current_coin)
            continue

        # 正文
        if current_coin is not None:
            current_coin.description = (
                current_coin.description + "\n" + text if current_coin.description else text
            )
        elif current_cat is not None:
            current_cat.intro = current_cat.intro + "\n" + text if current_cat.intro else text
            current_cat.intro_source = "auto"
        elif not meta_title:
            meta_title = text
        elif not meta_intro:
            meta_intro = text
        else:
            meta_intro += "\n" + text

    declared = None
    m = re.search(r"(\d+)\s*种", meta_intro)
    if m:
        declared = int(m.group(1))

    return {
        "meta": {
            "title": meta_title,
            "intro": meta_intro,
            "declared_coin_count": declared,
            "source_doc": str(docx_path),
            "parsed_at": datetime.now(timezone.utc).isoformat(),
        },
        "media": media,
        "categories": categories,
        "orphans": orphans,
    }


# --------------------------------------------------------------------------- 字段抽取


def extract_states(text: str) -> list[str]:
    """抽国别。裸字匹配假阳性太多（「燕尾布」的燕、「先秦」的秦），
    因此要求命中处有国别语境：后接 国/人/族，或处于并列列举中，
    或本身就是「三晋/周王室/中山/山戎/白狄」这类不易混淆的多字词。"""
    out: list[str] = []
    list_chars = "、及与和"
    for name in STATES:
        for m in re.finditer(re.escape(name), text):
            i, j = m.start(), m.end()
            prev = text[i - 1] if i > 0 else ""
            nxt = text[j] if j < len(text) else ""
            ok = len(name) >= 2 or nxt in "国人族" or prev in list_chars or nxt in list_chars + "等，"
            if prev == "先":  # 先秦
                ok = False
            if ok:
                out.append(name)
                break
    # 按 STATES 中的定义顺序输出，读起来更自然
    # （空首布应为「周王室·卫·郑·宋」，而不是按正文出现顺序的「卫·周王室·宋·郑」）
    return sorted(dedupe_keep_order(out), key=STATES.index)


def match_patterns(text: str, patterns: list[tuple[str, str]]) -> list[str]:
    """按优先级依次匹配，命中后把该片段抹掉，避免嵌套误判
    （例如「青铜贝币」不应再命中「铜贝」）。"""
    work = text
    found: list[str] = []
    for label, pat in patterns:
        if re.search(pat, work):
            found.append(label)
            work = re.sub(pat, lambda m: "\u2588" * len(m.group(0)), work)
    return found


def extract_period(text: str) -> tuple[str | None, str | None]:
    """判定时期。

    不能按「模式表顺序取第一个命中」——原文常在一句话里既说「战国中晚期」，
    后文又说「战国前期强盛时期」，先命中哪个纯属模式表排序的偶然。
    正确做法：**最长关键词优先（更具体），同长度取原文中位置更靠前的**。

    例：桥足布首句是「战国中晚期魏国铸造」，后文才提「战国前期强盛」，
        最长优先 → 战国中晚期 ✓
        尖足布首句只说「战国时期」，后文说「铸行于战国早中期」，
        最长优先 → 战国早中期 ✓
    """
    best_score: tuple[int, int] | None = None
    best: tuple[str, str] | None = None
    for kw, key in PERIOD_PATTERNS:
        pos = text.find(kw)
        if pos < 0:
            continue
        score = (len(kw), -pos)
        if best_score is None or score > best_score:
            best_score, best = score, (kw, key)
    return best if best else (None, None)


def extract_fields(coin: Coin) -> dict[str, object]:
    text = f"{coin.name}。{coin.description}"

    dia = find_ranges(coin.description, "直径") or find_ranges(coin.description, "外径")
    length = find_ranges(coin.description, "通长")
    weight = find_weight_range(coin.description)

    period_raw, period_key = extract_period(text)
    period_source = None
    if period_key:
        period_source = "inferred" if period_raw in FALLBACK_PERIOD_KEYWORDS else "auto"

    year_m = re.search(r"公元前\s*(\d+)\s*年", text)
    year = -int(year_m.group(1)) if year_m else None
    if period_key is None and year is not None:
        for name, start, end, _ in PERIODS:
            if start <= year <= end:
                period_raw, period_key = f"约公元前{abs(year)}年", name
                # 由年份反推的时期同样属于推断，必须标出来（否则会留空）
                period_source = "inferred"
                break

    states = extract_states(text)
    materials = match_patterns(text, MATERIAL_PATTERNS)
    units = match_patterns(text, UNIT_PATTERNS)

    rarity = None
    for kw in ["存世极少", "存世稀少", "传世极少", "最为罕见", "存世量不大", "所见不多", "罕见", "珍稀"]:
        if kw in text:
            rarity = kw
            break

    alias = coin.alias
    if not alias:
        alias = extract_quoted(coin.description, "又称") or extract_quoted(coin.description, "俗称")
        alias = alias or extract_quoted(coin.description, "又名")

    return {
        "diameter_mm": {"min": dia[0], "max": dia[1]} if dia else None,
        "length_mm": {"min": length[0], "max": length[1]} if length else None,
        "weight_g": {"min": weight[0], "max": weight[1]} if weight else None,
        "period": period_raw,
        "period_key": period_key,
        "period_source": period_source,
        "year_mentioned": year,
        "states": states,
        "materials": materials,
        "units": units,
        "inscription_front": extract_quoted(coin.description, "面文"),
        "inscription_back": extract_quoted(coin.description, "背文"),
        "rarity": rarity,
        "alias": alias,
    }


SLUG_PINYIN_HINT: dict[str, str] = {}


def make_slug(coin: Coin, used: set[str]) -> str:
    """条目序号 + 名称的稳定 slug。中文名直接保留（URL 会被百分号编码），
    同时提供一个基于序号的 ASCII 兜底，避免跨平台文件名问题。"""
    base = f"{coin.order:02d}-{coin.name}"
    base = re.sub(r"[\s/\\:*?\"<>|（）()]+", "-", base).strip("-")
    slug = base
    n = 2
    while slug in used:
        slug = f"{base}-{n}"
        n += 1
    used.add(slug)
    return slug


# --------------------------------------------------------------------------- 入口


def resolve_docx(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.exists():
            raise SystemExit(f"找不到文档：{p}")
        return p
    for cand in DEFAULT_DOCX_CANDIDATES:
        if cand.exists():
            return cand
    raise SystemExit("找不到《先秦(2).docx》，请用 --docx 指定路径")


def load_overrides(path: Path) -> dict[str, dict[str, object]]:
    """人工修正层。优先级高于自动抽取，键为钱币 slug。
    形如 {"27-蚁鼻钱": {"period": "战国晚期", "period_key": "战国晚期"}}"""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"覆盖层 JSON 解析失败 {path}: {exc}") from exc
    return {k: v for k, v in data.items() if not k.startswith("_")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx")
    ap.add_argument("--out", default="content/generated")
    ap.add_argument("--overrides", default="content/overrides/coin_fields.json")
    ap.add_argument("--category-overrides", default="content/overrides/category_intro.json")
    args = ap.parse_args()

    docx_path = resolve_docx(args.docx)
    api_dir = Path(__file__).resolve().parent.parent

    def resolve_override(p: str) -> Path:
        q = Path(p)
        return q if q.is_absolute() else api_dir / q

    ov_path = resolve_override(args.overrides)
    overrides = load_overrides(ov_path)
    cat_ov_path = resolve_override(args.category_overrides)
    cat_overrides = load_overrides(cat_ov_path)

    print(f"[extract] 源文档: {docx_path}")
    print(f"[extract] 覆盖层: {ov_path} ({'已加载 ' + str(len(overrides)) + ' 条' if overrides else '无'})")
    print(f"[extract] 类别导语覆盖层: {cat_ov_path} "
          f"({'已加载 ' + str(len(cat_overrides)) + ' 条' if cat_overrides else '无'})")
    parsed = parse(docx_path)

    categories: list[Category] = parsed["categories"]  # type: ignore[assignment]
    media: dict[str, dict[str, object]] = parsed["media"]  # type: ignore[assignment]

    cat_overridden: list[str] = []
    for cat in categories:
        ov = cat_overrides.get(cat.key)
        if not ov:
            continue
        if "intro_md" in ov:
            cat.intro = str(ov["intro_md"])
            cat.intro_source = str(ov.get("intro_source", "editor"))
            cat_overridden.append(cat.key)

    used_slugs: set[str] = set()
    cat_out = []
    total_coins = 0
    overridden: list[str] = []
    for cat in categories:
        coins_out = []
        for coin in cat.coins:
            coin.fields = extract_fields(coin)
            slug = make_slug(coin, used_slugs)
            applied: list[str] = []
            if slug in overrides:
                for k, v in overrides[slug].items():
                    coin.fields[k] = v
                    applied.append(k)
                overridden.append(f"{slug}({','.join(applied)})")
            coins_out.append(
                {
                    "order": coin.order,
                    "slug": slug,
                    "name": coin.name,
                    "category_key": cat.key,
                    "description_md": coin.description.strip(),
                    "fields": coin.fields,
                    "overridden_fields": applied,
                    "images": [
                        {"media": i.media, "sha256": i.sha256, "order": i.order} for i in coin.images
                    ],
                }
            )
            total_coins += 1
        cat_out.append(
            {
                "key": cat.key,
                "name": cat.name,
                "order": cat.order,
                "intro_md": cat.intro.strip(),
                "intro_source": cat.intro_source,
                "images": [
                    {"media": i.media, "sha256": i.sha256, "order": i.order} for i in cat.images
                ],
                "coins": coins_out,
            }
        )

    # 图片去重（同一 sha256 只保留一份，保留最小 order）
    by_sha: dict[str, dict[str, object]] = {}
    for m in media.values():
        by_sha.setdefault(str(m["sha256"]), m)
    unique_images = sorted(by_sha.values(), key=lambda x: str(x["name"]))

    referenced = sum(
        len(c["images"]) + sum(len(coin["images"]) for coin in c["coins"]) for c in cat_out
    )

    out = {
        "meta": parsed["meta"],
        "categories": cat_out,
        "orphans": parsed["orphans"],
        "image_catalog": unique_images,
    }

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = Path(__file__).resolve().parent.parent / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_path = out_dir / "raw.json"
    raw_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    report = {
        "source_doc": str(docx_path),
        "declared_coin_count": parsed["meta"]["declared_coin_count"],  # type: ignore[index]
        "parsed_coin_count": total_coins,
        "category_count": len(cat_out),
        "overrides_applied": overridden,
        "category_intro_overrides": cat_overridden,
        "categories": [
            {
                "key": c["key"],
                "name": c["name"],
                "coin_count": len(c["coins"]),
                "orders": [coin["order"] for coin in c["coins"]],
                "category_images": len(c["images"]),
                "intro_chars": len(c["intro_md"]),
            }
            for c in cat_out
        ],
        "media_files": len(media),
        "media_unique": len(unique_images),
        "image_references": referenced,
        "duplicate_references": referenced - len(unique_images),
        "orphans": len(parsed["orphans"]),
        "coins_missing_description": [
            f"{c['key']}/{coin['name']}" for c in cat_out for coin in c["coins"]
            if not coin["description_md"]
        ],
        "coins_without_image": [
            f"{c['key']}/{coin['name']}" for c in cat_out for coin in c["coins"]
            if not coin["images"]
        ],
        "field_coverage": {
            key: sum(
                1 for c in cat_out for coin in c["coins"] if coin["fields"].get(key) not in (None, [], "")
            )
            for key in [
                "diameter_mm", "length_mm", "weight_g", "period_key",
                "states", "materials", "units", "rarity", "inscription_front",
            ]
        },
    }
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"[extract] 类别 {report['category_count']} 个，钱币 {total_coins} 条")
    print(f"[extract] 图片：{report['media_files']} 个文件 / {report['media_unique']} 张唯一 / "
          f"{report['image_references']} 次引用（重复 {report['duplicate_references']}）")
    print(f"[extract] 声明 {report['declared_coin_count']} 种，实际解析 {total_coins} 条")
    print(f"[extract] 字段覆盖: {report['field_coverage']}")
    if report["coins_without_image"]:
        print(f"[extract] ⚠ 无图条目: {report['coins_without_image']}")
    if report["orphans"]:
        print(f"[extract] ⚠ 孤儿块 {report['orphans']} 处")
    print(f"[extract] 输出: {raw_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
