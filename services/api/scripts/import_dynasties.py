#!/usr/bin/env python3
"""把朝代钱币的原图从 docx 媒体库直出到 static/images，不做任何重编码。

背景：这批源图本就是小尺寸扫描图（唯一 700 张 / 94 MB / 长边中位 342px），
AVIF/WebP 重编码会明显损失钱文细节，故按「原图直出」策略导入：
  - 文件字节与 docx 内完全一致（不缩放、不转码、不去元数据）；
  - 尺寸/宽高比用 PIL 只读不写；
  - LQIP 仍是 16px 模糊占位（仅加载占位用，不是展示图）；
  - manifest 的 full/thumb 字段全部指向原图路径 —— 前端 <picture> 的
    avif/webp 源拿到同一 URL，浏览器按内容嗅探渲染，零前端改动。

输入：content/generated/dynasties/*.raw.json（extract_dynasties.py 产出）
      content/generated/raw.json（先秦正册，extract_docx.py 产出，存在则一并处理）
输出：
    static/images/coins/<slug>/NN.png|jpg        钱币原图
    static/images/categories/<key>/NN.png|jpg     类别原图（先秦）
    content/generated/dynasties_images.json       朝代分册合并 manifest（键 sha256）
    content/generated/images.json                 先秦 manifest（build_db 主流程消费）

用法：
    python scripts/import_dynasties.py
"""

from __future__ import annotations

import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_images import make_lqip, prepare  # noqa: E402

EXT_BY_FORMAT = {"PNG": "png", "JPEG": "jpg"}


def emit_original(
    data: bytes,
    dest_rel: str,
    out_dir: Path,
    media_name: str,
    source_doc: str,
) -> dict[str, object]:
    """把原始字节落盘并返回 manifest 条目（不缩放、不转码）。"""
    img = Image.open(io.BytesIO(data))
    img.load()
    fmt = img.format or "?"
    if fmt not in EXT_BY_FORMAT:
        raise ValueError(f"不支持的格式 {fmt}")
    prepared = prepare(img)  # 仅取 EXIF 旋转后的正确宽高，不回写文件

    dest = out_dir / dest_rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    lqip, ratio = make_lqip(prepared)
    url = "/images/" + dest_rel
    return {
        "media": media_name,
        "source_doc": source_doc,
        "source_format": fmt,
        "source_bytes": len(data),
        "width": prepared.size[0],
        "height": prepared.size[1],
        "aspect_ratio": ratio,
        "lqip": lqip,
        # 四个展示位全指原图；bytes 只记一处，统计口径为「输出=源」
        "full": {"avif": url, "webp": url, "bytes_avif": len(data), "bytes_webp": 0},
        "thumb": {"avif": url, "webp": url, "bytes_avif": 0, "bytes_webp": 0},
    }


def process_raw(
    raw: dict[str, object],
    out_dir: Path,
    manifest: dict[str, dict[str, object]],
) -> tuple[int, int]:
    """处理一份 raw.json（朝代分册或先秦正册），返回（落盘张数, 字节数）。"""
    docx_path = Path(str(raw["meta"]["source_doc"]))  # type: ignore[index]
    if not docx_path.exists():
        raise SystemExit(f"源文档缺失：{docx_path}")
    copied = 0
    total = 0

    with zipfile.ZipFile(docx_path) as zf:
        by_name = {
            Path(i.filename).name: i
            for i in zf.infolist()
            if i.filename.startswith("word/media/") and not i.is_dir() and not i.filename.endswith("/")
        }
        for cat in raw["categories"]:  # type: ignore[union-attr]
            # 类别图片（先秦正册每类一张）
            for seq, im in enumerate(cat["images"], start=1):  # type: ignore[union-attr]
                sha = str(im["sha256"])
                if sha in manifest:
                    continue
                info = by_name.get(str(im["media"]))
                if info is None:
                    print(f"[import] ⚠ 类别 {cat['key']}: zip 内找不到 {im['media']}")
                    continue
                data = zf.read(info.filename)
                fmt = Image.open(io.BytesIO(data)).format
                if fmt not in EXT_BY_FORMAT:
                    print(f"[import] ⚠ 跳过不支持的格式 {fmt}: {docx_path.name}/{im['media']}")
                    continue
                manifest[sha] = emit_original(
                    data,
                    f"categories/{cat['key']}/{seq:02d}.{EXT_BY_FORMAT[fmt]}",
                    out_dir,
                    str(im["media"]),
                    docx_path.name,
                )
                total += len(data)
                copied += 1

            for coin in cat["coins"]:  # type: ignore[union-attr]
                for seq, im in enumerate(coin["images"], start=1):
                    sha = str(im["sha256"])
                    if sha in manifest:
                        continue  # 同图多币引用，只落一次盘
                    info = by_name.get(str(im["media"]))
                    if info is None:
                        print(f"[import] ⚠ {coin['slug']}: zip 内找不到 {im['media']}")
                        continue
                    data = zf.read(info.filename)
                    fmt = Image.open(io.BytesIO(data)).format
                    if fmt not in EXT_BY_FORMAT:
                        print(f"[import] ⚠ 跳过不支持的格式 {fmt}: {docx_path.name}/{im['media']}")
                        continue
                    manifest[sha] = emit_original(
                        data,
                        f"coins/{coin['slug']}/{seq:02d}.{EXT_BY_FORMAT[fmt]}",
                        out_dir,
                        str(im["media"]),
                        docx_path.name,
                    )
                    total += len(data)
                    copied += 1
    return copied, total


def main() -> int:
    api_dir = Path(__file__).resolve().parent.parent
    dyn_dir = api_dir / "content" / "generated" / "dynasties"
    out_dir = api_dir / "static" / "images"
    xianqin_raw_path = api_dir / "content" / "generated" / "raw.json"

    raw_files = sorted(dyn_dir.glob("*.raw.json"))
    if not raw_files:
        raise SystemExit(f"找不到朝代数据：{dyn_dir}/*.raw.json，请先跑 extract_dynasties.py")

    def write_manifest(path: Path, images: dict[str, dict[str, object]], src_desc: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        total = sum(m["source_bytes"] for m in images.values())  # type: ignore[misc]
        path.write_text(
            json.dumps(
                {
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "policy": "原图直出：文件字节与 docx 媒体库一致，未缩放/未重编码",
                    "sources": src_desc,
                    "count": len(images),
                    "source_bytes": total,
                    "output_bytes": total,
                    "compression_ratio": 1.0,
                    "images": images,
                    "unprocessable": [],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    # ---- 朝代分册 ----
    dyn_manifest: dict[str, dict[str, object]] = {}
    copied = 0
    total_bytes = 0
    for raw_file in raw_files:
        raw = json.loads(raw_file.read_text(encoding="utf-8"))
        c, t = process_raw(raw, out_dir, dyn_manifest)
        copied += c
        total_bytes += t
    write_manifest(
        api_dir / "content" / "generated" / "dynasties_images.json",
        dyn_manifest,
        f"{len(raw_files)} 个朝代分册",
    )
    print(f"[import] 朝代分册原图直出 {copied} 张 / {total_bytes / 1048576:.1f} MB")

    # ---- 先秦正册（存在则一并原图直出，manifest 覆盖旧版）----
    if xianqin_raw_path.exists():
        raw = json.loads(xianqin_raw_path.read_text(encoding="utf-8"))
        if "dynasty_key" in raw.get("meta", {}):
            print("[import] content/generated/raw.json 是朝代分册格式，跳过先秦处理")
        else:
            xq_manifest: dict[str, dict[str, object]] = {}
            c, t = process_raw(raw, out_dir, xq_manifest)
            write_manifest(xianqin_raw_path.parent / "images.json", xq_manifest, "先秦正册")
            print(f"[import] 先秦正册原图直出 {c} 张 / {t / 1048576:.1f} MB → images.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())
