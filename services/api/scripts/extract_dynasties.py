#!/usr/bin/env python3
"""把 docs/钱币简介/ 下的 23 个朝代 docx 整理成数据库可录入的结构。

与 extract_docx.py（先秦专用）的关系：
  - 输出格式同构（raw.json 的 categories/coins/fields/images/image_catalog），
    因此 process_images.py 可以按 --raw 逐文件直接消费；
  - 复用其尺寸/重量/引号抽取与素材匹配函数，正则按新文件的行文放宽；
  - 朝代、时期、国别等先秦专属逻辑在此重新实现。

新文件的结构规律（实测 23 个文件）：
  - 每个文件 = 一个朝代；首段为标题（个别文件无标题，直接是条目）；
  - 标题后可选一段朝代导语（长段、非粗体）；
  - 钱币条目两种写法：
      a) 全粗体短行（≤16 字、无句末标点）—— 19 个文件；
      b) 「N. 名称」编号行 —— 元朝/元起义军/明大理/明起义军/南明 5 个文件；
  - 描述为条目后的非粗体段落，可多段；
  - 图片三种落位：条目名段内联 / 描述段内联 / 独立表格（西夏/辽/金/南宋，
    每币一表、两图）。表格是 body 的 w:tbl 子元素，python-docx 的
    doc.paragraphs 看不到，必须按 body 子元素顺序遍历；
  - 只有秦文件带类别标题「三、圜钱类」（映射到既有 yuan 类别）。

文件名纠错（以内容为准）：
  - 南朝钱币简介.docx   → 标题「南明钱币」，实为南明（弘光/隆武/永历）；
  - 明代大理国钱币简介.docx → 1-13 条为明朝本朝钱，14-19 条为明代弘治年间
    大理土司铸币（正文自述），整体归明朝；
  - 元朝/元起义军/明起义军 无标题段，朝代取自文件名。

输出：
    content/generated/dynasties/<key>.raw.json      每朝代一份（管线同构）
    content/generated/dynasties_import.json          合并的数据库录入结构
    content/generated/dynasties_report.json          校对报告
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

# extract_docx.py 与本脚本同目录，按脚本所在目录导入其可复用部分
sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_docx import (  # noqa: E402
    CATEGORY_KEYS,
    CATEGORY_RE,
    ENTRY_RE,
    dedupe_keep_order,
    extract_quoted,
    match_patterns,
    norm_len,
    read_media,
)

# --------------------------------------------------------------------------- 朝代注册表

# 文件名 → (key, 显示名, 起年, 止年)。起止年为约数，仅用于时间轴排序。
# order_index 按列表顺序赋予（先秦在 build_db 里是 0，这里从 1 起）。
DYNASTY_REGISTRY: list[dict[str, object]] = [
    {"file": "2.秦钱币简介.docx",         "key": "qin",       "name": "秦",       "start": -221, "end": -207},
    {"file": "3.西汉时期钱币简介.docx",   "key": "xihan",     "name": "西汉",     "start": -202, "end": 8},
    {"file": "4.新莽时期钱币简介.docx",   "key": "xinmang",   "name": "新莽",     "start": 9,    "end": 23},
    {"file": "5.东汉时期钱币简介.docx",   "key": "donghan",   "name": "东汉",     "start": 25,   "end": 220},
    {"file": "6.三国时期钱币简介.docx",   "key": "sanguo",    "name": "三国",     "start": 220,  "end": 280},
    {"file": "7.晋朝时期钱币简介.docx",   "key": "jin",       "name": "晋朝",     "start": 266,  "end": 420},
    {"file": "8.十六国时期钱币简介.docx", "key": "shiliuguo", "name": "十六国",   "start": 304,  "end": 439},
    {"file": "10.北朝时期钱币简介.docx",  "key": "beichao",   "name": "北朝",     "start": 439,  "end": 581},
    {"file": "9.南朝时期钱币简介.docx",   "key": "nanchao",   "name": "南朝",     "start": 420,  "end": 589},
    {"file": "11.隋朝时期钱币简介.docx",  "key": "sui",       "name": "隋朝",     "start": 581,  "end": 618},
    {"file": "12.唐朝时期钱币简介.docx",  "key": "tang",      "name": "唐朝",     "start": 618,  "end": 907},
    {"file": "13.五代时期钱币简介.docx",  "key": "wudai",     "name": "五代",     "start": 907,  "end": 960},
    {"file": "14.十国时期钱币简介.docx",  "key": "shiguo",    "name": "十国",     "start": 902,  "end": 979},
    {"file": "15.北宋时期钱币简介.docx",  "key": "beisong",   "name": "北宋",     "start": 960,  "end": 1127},
    {"file": "17.辽代时期钱币简介.docx",  "key": "liao",      "name": "辽代",     "start": 916,  "end": 1125},
    {"file": "16.南宋时期钱币简介.docx",  "key": "nansong",   "name": "南宋",     "start": 1127, "end": 1279},
    {"file": "19.西夏时期钱币简介.docx",  "key": "xixia",     "name": "西夏",     "start": 1038, "end": 1227},
    {"file": "18.金代时期钱币简介.docx",  "key": "jindai",    "name": "金代",     "start": 1115, "end": 1234},
    {"file": "20.元朝钱币简介.docx",      "key": "yuan",      "name": "元朝",     "start": 1206, "end": 1368},
    {"file": "21.元起义军钱币简介.docx",  "key": "yuan_qiyi", "name": "元末起义军", "start": 1351, "end": 1368},
    {"file": "22.明代钱币简介.docx",      "key": "ming",      "name": "明朝",     "start": 1368, "end": 1644},
    {"file": "23.南明钱币简介.docx",      "key": "nanming",   "name": "南明",     "start": 1644, "end": 1662},
    {"file": "24.明起义军钱币简介.docx",  "key": "ming_qiyi", "name": "明末起义军", "start": 1621, "end": 1664},
    {"file": "25.后金.docx",              "key": "houjin",    "name": "后金",     "start": 1616, "end": 1636},
    {"file": "26.清代.docx",              "key": "qing",      "name": "清代",     "start": 1636, "end": 1912},
    {"file": "27.三藩.docx",              "key": "sanfan",    "name": "三藩",     "start": 1673, "end": 1681},
    {"file": "28.清代起义军.docx",        "key": "qing_qiyi", "name": "清代起义军", "start": 1851, "end": 1868},
    {"file": "29.民国.docx",              "key": "minguo",    "name": "民国",     "start": 1912, "end": 1949},
]

# 合并导入时，无显式类别的钱币统一挂到这个新类别（先秦四体系之外的第 5 类）。
# 属于可改的默认值，导入前如需换分法，改 dynasties_import.json 的 category_key 即可。
DEFAULT_CATEGORY = {"key": "fangkong", "name": "方孔圆钱", "order": 4}

FILENAME_FIXES = {
    "22.明代钱币简介.docx": "编号正册纠正了旧文件名「明代大理国钱币简介」的误导；第 14-19 条为明代弘治年间云南大理土司铸币（正文自述），一并归明朝",
    "23.南明钱币简介.docx": "编号正册纠正了旧文件名「南朝钱币简介」——内容实为南明钱币（弘光/隆武/永历）",
}

# --------------------------------------------------------------------------- 抽取正则

NUM = r"[\d.]+"
LEN_UNITS = {"毫米": 1.0, "mm": 1.0, "厘米": 10.0, "cm": 10.0}

# 新文件行文更口语（「直径只有1.2厘米左右」「重四铢（大约2.5克左右）」），
# 连接词比 extract_docx 的版本放宽。
LEN_CONNECTOR = r"(?:约|大约|为|是|在|只有|仅有|约莫|大概|左右)?"
RANGE_SEP = r"(?:至|到|-|–|—|~|～)"


def find_ranges_lenient(text: str, label: str) -> tuple[float, float] | None:
    unit_alt = "|".join(LEN_UNITS)
    out: list[tuple[float, float]] = []
    for m in re.finditer(
        rf"{label}\s*{LEN_CONNECTOR}\s*({NUM})\s*{RANGE_SEP}\s*({NUM})\s*{LEN_CONNECTOR}\s*({unit_alt})",
        text,
    ):
        a = norm_len(m.group(1), m.group(3))
        b = norm_len(m.group(2), m.group(3))
        out.append((min(a, b), max(a, b)))
    for m in re.finditer(
        rf"{label}\s*{LEN_CONNECTOR}\s*({NUM})\s*(?:{RANGE_SEP}\s*({NUM})\s*)?({unit_alt})",
        text,
    ):
        v = norm_len(m.group(1), m.group(3))
        v2 = norm_len(m.group(2), m.group(3)) if m.group(2) else v
        out.append((min(v, v2), max(v, v2)))
    if not out:
        return None
    return (min(a for a, _ in out), max(b for _, b in out))


def find_weight_lenient(text: str) -> tuple[float, float] | None:
    # 「重 8 克」「重量约为 3 至 4 克」「重四铢（大约2.5克左右）」
    span = re.search(
        rf"重(?:量)?[^\d]{{0,10}}({NUM})\s*{RANGE_SEP}\s*({NUM})\s*{LEN_CONNECTOR}\s*克", text
    )
    if span:
        a, b = float(span.group(1)), float(span.group(2))
        return (min(a, b), max(a, b))
    single = re.search(rf"重(?:量)?[^\d]{{0,10}}({NUM})\s*(?:多|余)?\s*克", text)
    if single:
        v = float(single.group(1))
        return (v, v)
    return None


def find_year(text: str) -> int | None:
    m = re.search(r"公元前\s*(\d{3,4})\s*年", text)
    if m:
        return -int(m.group(1))
    m = re.search(r"公元\s*(\d{3,4})\s*年", text)
    if m:
        return int(m.group(1))
    # 「1644 年」「（1361年）」这类裸公历年份
    m = re.search(r"(?<![\d.])(\d{3,4})\s*年", text)
    if m and 100 <= int(m.group(1)) <= 1700:
        return int(m.group(1))
    return None


MATERIAL_PATTERNS_DYN: list[tuple[str, str]] = [
    ("青铜", r"青铜"),
    ("红铜", r"红铜"), ("黄铜", r"黄铜"), ("白铜", r"白铜|青白铜"),
    ("铁", r"铁钱|铁质|用铁|铁币"),
    ("铅", r"铅钱|铅质"),
    ("银", r"银币|银钱|银质|白银|银两"),
    ("金", r"金币|黄金|鎏金"),
    ("纸", r"纸币|纸钞|宝钞|交子|会子"),
    ("象牙", r"象牙"), ("玉", r"玉币|玉质"),
]

UNIT_PATTERNS_DYN: list[tuple[str, str]] = [
    ("铢", r"[一二三四五六七八九十半\d]+\s*铢"),
    ("两", r"半两|一两|“两”|「两」|十二铢"),  # 十二铢=半两，两与铢都可能被提及
    ("贯", r"[一二三四五六七八九十百千\d]+\s*贯|每贯"),
    ("文", r"当[一二三四五六七八九十百\d]+文|[一二三四五六七八九十百\d]+\s*文钱"),
]

RARITY_KEYWORDS = [
    "存世极少", "存世稀少", "存世量极少", "存世量稀少", "存世量很少", "存世量较少",
    "存世量特别少", "传世极少", "最为罕见", "极为罕见", "极为稀少", "罕见", "珍稀",
    "珍罕", "孤品", "存世无多", "所见不多", "不多见", "很少见",
]

NAME_MAX_LEN = 16


# --------------------------------------------------------------------------- 解析

@dataclass
class CoinDoc:
    name: str
    alias: str | None = None
    order: int = 0
    description: str = ""
    category_key: str | None = None
    images: list[dict[str, object]] = field(default_factory=list)


def para_embeds(par_xml: str) -> list[str]:
    return re.findall(r'r:embed="([^"]+)"', par_xml)


def _bold_all(par: Paragraph) -> bool | None:
    """段落里所有带文本的 run 是否全粗体；无文本 run 时返回 None。"""
    runs = [r for r in par.runs if r.text.strip()]
    if not runs:
        return None
    return all(r.bold for r in runs)


def parse_file(docx_path: Path) -> dict[str, object]:
    doc = Document(str(docx_path))
    rels = doc.part.rels
    media = read_media(docx_path)

    def rid_to_media(rid: str) -> dict[str, object] | None:
        rel = rels.get(rid)
        if rel is None or "media/" not in rel.target_ref:
            return None
        name = rel.target_ref.split("/")[-1]
        return media.get(name)

    # 先按文档顺序收集块（段落+表格），并预计算每个段落的「下一个非空文本长度」，
    # 供普通短行币名判定做前视。
    blocks: list[dict[str, object]] = []
    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:tbl"):
            blocks.append({"child": child, "par": None, "text": "", "bold_all": None})
        elif child.tag == qn("w:p"):
            par = Paragraph(child, doc)
            blocks.append(
                {
                    "child": child,
                    "par": par,
                    "text": par.text.strip(),
                    "bold_all": _bold_all(par),
                }
            )
    for i, b in enumerate(blocks):
        nxt = next((x["text"] for x in blocks[i + 1:] if str(x["text"])), "")
        b["next_text_len"] = len(nxt)

    coins: list[CoinDoc] = []
    title = ""
    intro = ""
    current: CoinDoc | None = None
    current_category: str | None = None  # 仅秦文件用到（圜钱类）
    image_order = 0
    warnings: list[str] = []

    def add_images_from_xml(xml: str, target: CoinDoc | None) -> int:
        nonlocal image_order
        added = 0
        for rid in para_embeds(xml):
            m = rid_to_media(rid)
            if m is None:
                warnings.append(f"未解析图片引用 {rid}")
                continue
            if target is not None:
                target.images.append(
                    {"media": m["name"], "sha256": m["sha256"], "order": image_order}
                )
            else:
                warnings.append(f"图片 {m['name']} 出现在任何条目之前，未归属")
            image_order += 1
            added += 1
        return added

    seen_first_text = False

    for b in blocks:
        child, par, text = b["child"], b["par"], str(b["text"])
        if par is None:  # 表格：图片归属当前钱币（西夏/辽/金/南宋：每币一表两图）
            add_images_from_xml(child.xml, current)
            continue

        cat_m = CATEGORY_RE.match(text) if text else None
        entry_m = ENTRY_RE.match(text) if text else None
        # 币名三种写法：
        #  a) 编号行「N. 名称」；
        #  b) 全粗短行——须在标题段已被消费后（文档标题也是粗体短行）；
        #  c) 普通短行 + 下一个非空文本是长段（民国册：无编号、无粗体，
        #     「民国通宝」这样的普通短行后跟长描述；首段同样适用，此时册子无标题）。
        bold_name = (not entry_m) and (not cat_m) and seen_first_text and b["bold_all"] is True
        plain_name = (
            (not entry_m) and (not cat_m) and b["bold_all"] is False
            and 0 < len(text) <= NAME_MAX_LEN
            and not text.endswith(("。", "，", "！", "？", "；", "：", ":", "、"))
            and int(b["next_text_len"]) > 50
        )

        if cat_m:
            current_category = CATEGORY_KEYS[cat_m.group(1)]
            continue

        if entry_m or bold_name or plain_name:
            raw_name = entry_m.group(2).strip() if entry_m else text
            alias = None
            paren = re.match(r"^(.+?)[（(](.+?)[）)]$", raw_name)
            if paren:
                raw_name, alias = paren.group(1).strip(), paren.group(2).strip()
            current = CoinDoc(
                name=raw_name,
                alias=alias,
                order=int(entry_m.group(1)) if entry_m else len(coins) + 1,
                category_key=current_category,
            )
            coins.append(current)
            add_images_from_xml(child.xml, current)
            seen_first_text = True
            continue

        if text:
            if not seen_first_text and len(text) > 40:
                # 首段就是长导语（三藩册：无短标题，开篇即导语），标题回退到文件名
                intro = text
                seen_first_text = True
            elif not seen_first_text:
                title = text
                seen_first_text = True
            elif current is not None:
                current.description = (
                    current.description + "\n" + text if current.description else text
                )
            else:
                intro = intro + "\n" + text if intro else text
        # 有文字的段落里若内联了图片，归属当前钱币
        if 'r:embed="' in child.xml:
            add_images_from_xml(child.xml, current)

    return {
        "title": title,
        "intro": intro,
        "coins": coins,
        "media": media,
        "warnings": warnings,
    }


def extract_coin_fields(desc: str, dynasty: dict[str, object]) -> dict[str, object]:
    dia = find_ranges_lenient(desc, "直径") or find_ranges_lenient(desc, "外径")
    length = find_ranges_lenient(desc, "通长")
    weight = find_weight_lenient(desc)

    rarity = None
    for kw in RARITY_KEYWORDS:
        if kw in desc:
            rarity = kw
            break

    alias = extract_quoted(desc, "又称") or extract_quoted(desc, "俗称") or extract_quoted(desc, "又名")

    return {
        "period": dynasty["name"],
        # period_key 沿用先秦惯例用中文（如「战国中期」），前端筛选与时间轴直接展示该值
        "period_key": str(dynasty["name"]),
        "period_source": "auto",  # 朝代由源文件的分册明确，非推断
        "period_start_year": dynasty["start"],
        "period_end_year": dynasty["end"],
        "period_order": dynasty["order_index"],
        "year_mentioned": find_year(desc),
        "diameter_mm": {"min": dia[0], "max": dia[1]} if dia else None,
        "length_mm": {"min": length[0], "max": length[1]} if length else None,
        "weight_g": {"min": weight[0], "max": weight[1]} if weight else None,
        "states": [],
        "materials": match_patterns(desc, MATERIAL_PATTERNS_DYN),
        "units": match_patterns(desc, UNIT_PATTERNS_DYN),
        "inscription_front": extract_quoted(desc, "面文")
        or extract_quoted(desc, "钱文为")
        or extract_quoted(desc, "钱文是"),
        "inscription_back": extract_quoted(desc, "背文"),
        "rarity": rarity,
        "alias": alias,
    }


def sanitize(name: str) -> str:
    return re.sub(r"[\s/\\:*?\"<>|（）()]+", "-", name).strip("-")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../../docs/钱币简介-29册")
    ap.add_argument("--out", default="content/generated")
    args = ap.parse_args()

    api_dir = Path(__file__).resolve().parent.parent
    src_dir = (api_dir / args.src).resolve()
    out_dir = api_dir / args.out
    dyn_dir = out_dir / "dynasties"
    dyn_dir.mkdir(parents=True, exist_ok=True)

    for i, d in enumerate(DYNASTY_REGISTRY, start=1):
        d["order_index"] = i

    used_slugs: set[str] = set()
    all_coins: list[dict[str, object]] = []
    dyn_summary: list[dict[str, object]] = []
    problems: list[str] = []
    total_media = 0
    total_unique = 0

    for d in DYNASTY_REGISTRY:
        path = src_dir / str(d["file"])
        if not path.exists():
            problems.append(f"缺文件：{path}")
            continue
        parsed = parse_file(path)
        coins_out: list[dict[str, object]] = []
        for seq, coin in enumerate(parsed["coins"], start=1):  # type: ignore[arg-type]
            fields = extract_coin_fields(coin.description, d)  # type: ignore[arg-type]
            if coin.alias:
                fields["alias"] = coin.alias
            slug = f"{d['key']}-{seq:02d}-{sanitize(coin.name)}"
            n = 2
            while slug in used_slugs:
                slug = f"{d['key']}-{seq:02d}-{sanitize(coin.name)}-{n}"
                n += 1
            used_slugs.add(slug)
            rec = {
                "slug": slug,
                "dynasty_key": d["key"],
                "name": coin.name,
                "order": coin.order,
                "order_index": seq,
                "category_key": coin.category_key or DEFAULT_CATEGORY["key"],
                "description_md": coin.description.strip(),
                "fields": fields,
                "overridden_fields": [],
                "images": coin.images,
            }
            coins_out.append(rec)
            all_coins.append(rec)
            if not coin.description:
                problems.append(f"{d['name']}/{coin.name}：无描述正文")
            if not coin.images:
                problems.append(f"{d['name']}/{coin.name}：无图片")

        media = parsed["media"]  # type: ignore[assignment]
        by_sha: dict[str, dict[str, object]] = {}
        for m in media.values():  # type: ignore[union-attr]
            by_sha.setdefault(str(m["sha256"]), m)
        image_catalog = sorted(by_sha.values(), key=lambda x: str(x["name"]))
        total_media += len(media)  # type: ignore[arg-type]
        total_unique += len(by_sha)

        raw = {
            "meta": {
                "title": parsed["title"] or path.stem,
                "intro": parsed["intro"],
                "dynasty_key": d["key"],
                "dynasty_name": d["name"],
                "source_doc": str(path),
                "parsed_at": datetime.now(timezone.utc).isoformat(),
            },
            "categories": [
                {
                    "key": DEFAULT_CATEGORY["key"],
                    "name": DEFAULT_CATEGORY["name"],
                    "order": DEFAULT_CATEGORY["order"],
                    "intro_md": parsed["intro"].strip(),
                    "intro_source": "auto",
                    "images": [],
                    "coins": coins_out,
                }
            ],
            "orphans": parsed["warnings"],
            "image_catalog": image_catalog,
        }
        (dyn_dir / f"{d['key']}.raw.json").write_text(
            json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        imgs = sum(len(c["images"]) for c in coins_out)
        dyn_summary.append(
            {
                **{k: d[k] for k in ("key", "name", "start", "end", "order_index", "file")},
                "title_in_doc": parsed["title"] or "(无标题，取文件名)",
                "coin_count": len(coins_out),
                "image_refs": imgs,
                "media_files": len(media),  # type: ignore[arg-type]
                "media_unique": len(by_sha),
                "warnings": parsed["warnings"],
            }
        )
        if parsed["warnings"]:
            problems.extend(f"{d['name']}: {w}" for w in parsed["warnings"])  # type: ignore[union-attr]
        fix = FILENAME_FIXES.get(str(d["file"]))
        print(f"[dyn] {d['name']:<6} {len(coins_out):>3} 币 / 图 {imgs:>3} 引用"
              f"（唯一 {len(by_sha)}）{('  ⚠ ' + fix) if fix else ''}")

    # ---- 合并的数据库录入结构 ----
    coverage = {
        k: sum(1 for c in all_coins if c["fields"].get(k) not in (None, [], ""))  # type: ignore[union-attr]
        for k in ["diameter_mm", "weight_g", "year_mentioned", "materials", "rarity",
                  "inscription_front", "alias"]
    }
    combined = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": "由 docs/钱币简介/ 23 个 docx 整理；字段结构与 content/generated/raw.json 同构，"
                "另带 dynasty_key 维度。导入前可人工调整 category_key 等字段。",
        "dynasties": dyn_summary,
        "categories": [
            {
                **DEFAULT_CATEGORY,
                "intro_md": "秦统一后至明清的两千年间，中国铸币沿用「圆形方孔」形制，"
                            "以通宝、元宝、重宝等宝文钱为主体。",
                "intro_source": "editor",
            }
        ],
        "coins": all_coins,
        "image_stats": {
            "media_files": total_media,
            "media_unique": total_unique,
            "referenced": sum(len(c["images"]) for c in all_coins),  # type: ignore[union-attr]
        },
        "field_coverage": coverage,
        "problems": problems,
    }
    (out_dir / "dynasties_import.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = {
        "source_dir": str(src_dir),
        "files": len(dyn_summary),
        "total_coins": len(all_coins),
        "total_image_refs": combined["image_stats"]["referenced"],
        "filename_fixes": FILENAME_FIXES,
        "dynasties": dyn_summary,
        "field_coverage": coverage,
        "problems": problems,
    }
    (out_dir / "dynasties_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n[dyn] 合计 {len(all_coins)} 币 / {dyn_summary and sum(d['coin_count'] for d in dyn_summary)} 条"
          f" / 图片引用 {combined['image_stats']['referenced']}（唯一 {total_unique}）")
    print(f"[dyn] 字段覆盖: {coverage}")
    print(f"[dyn] 待人工复核 {len(problems)} 处（详见 dynasties_report.json）")
    print(f"[dyn] 输出: {dyn_dir}/  {out_dir / 'dynasties_import.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
