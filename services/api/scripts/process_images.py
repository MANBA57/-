#!/usr/bin/env python3
"""处理《先秦(2).docx》里的图片：去重 → 压缩 → 输出 AVIF/WebP 双格式 + LQIP。

输入：docx 内 word/media/*，以及 extract_docx.py 产出的 raw.json（提供归属关系）
输出：
    static/images/<scope>/<slug>/NN.avif|webp     原图（长边 ≤ 1600）
    static/images/<scope>/<slug>/thumb/NN.avif|webp  缩略图（长边 ≤ 400）
    content/generated/images.json                 每张图的尺寸、路径与 LQIP

设计取舍：
  - AVIF 作主格式（体积最小），WebP 作回退，前端用 <picture> 输出
  - 剥离 EXIF 等元数据（原图含 GPS/设备信息，公开站点不应带出去）
  - 有透明通道就保留，没有就压成 RGB，避免无谓的体积浪费

用法：
    python scripts/process_images.py [--raw content/generated/raw.json] [--out static/images]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

FULL_MAX = 1600
THUMB_MAX = 400
# 原图多为 ~1266px 的钱币照片。按 q55/q82 输出时 WebP 回退占了总体积的 63%，
# 总量 9.1 MB 超出 8 MB 目标；下调到 50/70 后约 6.6 MB，肉眼无可辨差异。
AVIF_QUALITY = 50
WEBP_QUALITY = 70
LQIP_WIDTH = 16
LQIP_QUALITY = 40

# python-docx 报的是像素尺寸；这里限制输入像素总量，防超大图打爆内存
Image.MAX_IMAGE_PIXELS = 200_000_000


def is_meaningfully_transparent(img: Image.Image) -> bool:
    if img.mode not in ("RGBA", "LA", "P"):
        return False
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    lo, hi = alpha.getextrema()
    return lo < 250  # 存在明显透明像素


def prepare(img: Image.Image) -> Image.Image:
    """EXIF 自动旋转 + 定色模式 + 去元数据。"""
    img = ImageOps.exif_transpose(img) or img
    if is_meaningfully_transparent(img):
        return img.convert("RGBA")
    return img.convert("RGB")


def fit(img: Image.Image, max_side: int) -> Image.Image:
    w, h = img.size
    scale = max_side / max(w, h)
    if scale >= 1:
        return img
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def encode_avif(img: Image.Image, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="AVIF", quality=AVIF_QUALITY)
    return path.stat().st_size


def encode_webp(img: Image.Image, path: Path, quality: int = WEBP_QUALITY) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="WEBP", quality=quality, method=6)
    return path.stat().st_size


def make_lqip(img: Image.Image) -> tuple[str, str]:
    """返回 (data URI, 宽高比)。给前端做占位，避免图片加载时布局跳动。"""
    w, h = img.size
    tiny = img.resize((LQIP_WIDTH, max(1, round(h * LQIP_WIDTH / w))), Image.LANCZOS)
    buf = io.BytesIO()
    tiny.convert("RGB").save(buf, format="WEBP", quality=LQIP_QUALITY)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{b64}", round(w / h, 4)


def slugify_scope(path_parts: list[str]) -> Path:
    return Path(*path_parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="content/generated/raw.json")
    ap.add_argument("--out", default="static/images")
    ap.add_argument("--manifest", default="content/generated/images.json")
    args = ap.parse_args()

    api_dir = Path(__file__).resolve().parent.parent

    def resolve(p: str) -> Path:
        q = Path(p)
        return q if q.is_absolute() else api_dir / q

    raw_path = resolve(args.raw)
    out_dir = resolve(args.out)
    manifest_path = resolve(args.manifest)

    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    docx_path = Path(raw["meta"]["source_doc"])
    if not docx_path.exists():
        raise SystemExit(f"找不到源文档：{docx_path}")

    # ---- 建立 sha256 → 归属（scope, slug）与显示序号的映射 ----
    owner: dict[str, dict[str, object]] = {}
    for cat in raw["categories"]:
        for i, im in enumerate(cat["images"]):
            owner.setdefault(im["sha256"], {"scope": "categories", "slug": cat["key"], "seq": i + 1})
        for coin in cat["coins"]:
            for i, im in enumerate(coin["images"]):
                owner.setdefault(
                    im["sha256"], {"scope": "coins", "slug": coin["slug"], "seq": i + 1}
                )

    catalog = {im["sha256"]: im for im in raw["image_catalog"]}
    print(f"[images] 唯一图片 {len(catalog)} 张，有归属 {len(owner)} 张")

    # ---- 逐张处理 ----
    results: dict[str, dict[str, object]] = {}
    unprocessable: list[dict[str, object]] = []
    total_bytes = 0
    src_bytes = 0

    with zipfile.ZipFile(docx_path) as zf:
        by_name = {
            Path(i.filename).name: i
            for i in zf.infolist()
            if i.filename.startswith("word/media/") and not i.is_dir() and not i.filename.endswith("/")
        }
        for idx, (sha, meta) in enumerate(sorted(catalog.items()), start=1):
            media_name = str(meta["name"])
            info = by_name.get(media_name)
            if info is None:
                unprocessable.append({"media": media_name, "reason": "zip 内找不到"})
                continue
            data = zf.read(info.filename)
            src_bytes += len(data)

            try:
                img = Image.open(io.BytesIO(data))
                img.load()
            except Exception as exc:  # noqa: BLE001 - 单张图失败不应中断整条管线
                unprocessable.append({"media": media_name, "reason": f"{type(exc).__name__}: {exc}"})
                continue

            fmt_in = img.format or "?"
            img = prepare(img)
            ow, oh = img.size

            own = owner.get(sha)
            if own is None:  # 未被任何条目引用（理论上不该发生）
                sub = Path("unassigned") / f"{idx:02d}-{Path(media_name).stem}"
            else:
                sub = Path(str(own["scope"])) / str(own["slug"])
            seq = int(own["seq"]) if own else 1
            stem = f"{seq:02d}"

            full = fit(img, FULL_MAX)
            thumb = fit(img, THUMB_MAX)

            full_avif = out_dir / sub / f"{stem}.avif"
            full_webp = out_dir / sub / f"{stem}.webp"
            thumb_avif = out_dir / sub / "thumb" / f"{stem}.avif"
            thumb_webp = out_dir / sub / "thumb" / f"{stem}.webp"

            a = encode_avif(full, full_avif)
            w = encode_webp(full, full_webp)
            ta = encode_avif(thumb, thumb_avif)
            tw = encode_webp(thumb, thumb_webp)
            lqip, ratio = make_lqip(full)
            total_bytes += a + w + ta + tw

            def rel(p: Path) -> str:
                return "/images/" + p.relative_to(out_dir).as_posix()

            results[sha] = {
                "media": media_name,
                "source_format": fmt_in,
                "source_bytes": len(data),
                "sha256": sha,
                "scope": str(own["scope"]) if own else "unassigned",
                "owner_slug": str(own["slug"]) if own else None,
                "order": seq,
                "width": full.size[0],
                "height": full.size[1],
                "source_width": ow,
                "source_height": oh,
                "aspect_ratio": ratio,
                "lqip": lqip,
                "full": {"avif": rel(full_avif), "webp": rel(full_webp), "bytes_avif": a, "bytes_webp": w},
                "thumb": {"avif": rel(thumb_avif), "webp": rel(thumb_webp), "bytes_avif": ta, "bytes_webp": tw},
            }
            if idx % 10 == 0 or idx == len(catalog):
                print(f"[images] {idx}/{len(catalog)} 已处理，累计输出 {total_bytes/1048576:.1f} MB")

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_doc": str(docx_path),
        "count": len(results),
        "source_bytes": src_bytes,
        "output_bytes": total_bytes,
        "compression_ratio": round(src_bytes / total_bytes, 1) if total_bytes else None,
        "images": results,
        "unprocessable": unprocessable,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[images] 完成 {len(results)} 张")
    print(f"[images] 源 {src_bytes/1048576:.1f} MB -> 输出 {total_bytes/1048576:.1f} MB "
          f"(压缩 {manifest['compression_ratio']}×)")
    if unprocessable:
        print(f"[images] ⚠ 无法处理 {len(unprocessable)} 张: {unprocessable}")
    print(f"[images] 清单: {manifest_path}")
    if total_bytes > 8 * 1048576:
        print(f"[images] ⚠ 输出超过 8 MB 目标（{total_bytes/1048576:.1f} MB），需要下调质量参数")
    return 0


if __name__ == "__main__":
    sys.exit(main())
