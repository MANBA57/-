#!/usr/bin/env python3
"""生成全站图标与启动屏。

产物分两处：
    apps/web/public/            网站图标、PWA manifest 图标、favicon
    apps/web/android/app/src/main/res/   安卓自适应图标与启动屏

设计：青铜绿底 + 「泉」字。取青铜器的锈色，与钱币主题一致，且在
48px 这种极小尺寸下仍然认得出（纯色底 + 单个大字最耐缩小）。

安卓自适应图标的前景必须留安全区：系统会按不同形状裁切，
内容要控制在大约 66% 的直径内，否则圆形遮罩下字会被切掉。

用法：
    python tools/make_assets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps" / "web" / "public"
ANDROID_RES = ROOT / "apps" / "web" / "android" / "app" / "src" / "main" / "res"

BG = (36, 80, 63)          # 青铜绿 #24503F
FG = (233, 220, 181)       # 淡青铜 #E9DCB5
SPLASH_BG = (36, 80, 63)

GLYPH = "泉"
FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\simhei.ttf"),
    Path(r"C:\Windows\Fonts\msyhbd.ttc"),
    Path(r"C:\Windows\Fonts\msyh.ttc"),
]

# 安卓各密度的图标边长（与 Capacitor 模板一致）
ANDROID_DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for p in FONT_CANDIDATES:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                continue
    raise SystemExit("找不到可用的中文字体（需要 simhei.ttf 或 msyh.ttc）")


def draw_glyph(img: Image.Image, ratio: float, color: tuple[int, int, int]) -> None:
    """在图片正中画「泉」，字号为画布边长的 ratio 倍。"""
    size = img.size[0]
    font = load_font(int(size * ratio))
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), GLYPH, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(
        ((size - w) / 2 - box[0], (size - h) / 2 - box[1]),
        GLYPH,
        font=font,
        fill=color,
    )


def solid_square(size: int, ratio: float, bg=BG, fg=FG) -> Image.Image:
    img = Image.new("RGB", (size, size), bg)
    draw_glyph(img, ratio, fg)
    return img


def rounded_square(size: int, ratio: float) -> Image.Image:
    """圆角底 + 字，用于 ic_launcher_round。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 2, fill=BG)
    draw_glyph(img, ratio, FG)
    return img


def transparent_glyph(size: int, ratio: float) -> Image.Image:
    """透明底 + 字，用于自适应图标的前景层（背景由 @color 提供）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_glyph(img, ratio, FG)
    return img


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- 网站图标
    print("=== 网站图标 ===")
    for name, size, ratio in (
        ("icon-192.png", 192, 0.62),
        ("icon-512.png", 512, 0.62),
        # maskable 需要留更大的边距，安卓会按圆形/方形裁切
        ("icon-maskable-512.png", 512, 0.46),
        ("apple-touch-icon.png", 180, 0.62),
    ):
        p = PUBLIC / name
        solid_square(size, ratio).save(p, "PNG", optimize=True)
        print(f"  {name:26s} {size}x{size}  {p.stat().st_size/1024:.1f} KB")

    favicon = PUBLIC / "favicon.svg"
    favicon.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<rect width="64" height="64" rx="14" fill="#24503f"/>'
        f'<text x="32" y="33" text-anchor="middle" dominant-baseline="central" '
        f'font-family="SimHei, Microsoft YaHei, sans-serif" font-size="40" fill="#e9dcb5">{GLYPH}</text>'
        "</svg>\n",
        encoding="utf-8",
    )
    print(f"  {'favicon.svg':26s} {'svg':>9s}  {favicon.stat().st_size} B")

    # ---------------------------------------------------------------- 安卓图标
    print("\n=== 安卓图标 ===")
    if not ANDROID_RES.is_dir():
        print(f"  跳过：找不到 {ANDROID_RES}")
    else:
        for density, size in ANDROID_DENSITIES.items():
            d = ANDROID_RES / f"mipmap-{density}"
            d.mkdir(parents=True, exist_ok=True)
            # 普通图标：圆角由系统处理，这里画满
            solid_square(size, 0.62).save(d / "ic_launcher.png", "PNG", optimize=True)
            # 圆形图标
            rounded_square(size, 0.62).save(d / "ic_launcher_round.png", "PNG", optimize=True)
            # 自适应前景：只画字，留安全区，背景来自 @color/ic_launcher_background
            transparent_glyph(size, 0.46).save(
                d / "ic_launcher_foreground.png", "PNG", optimize=True
            )
            print(f"  mipmap-{density:8s} {size:3d}px  ic_launcher / _round / _foreground")

        # 自适应图标的背景色
        bg_xml = ANDROID_RES / "values" / "ic_launcher_background.xml"
        bg_xml.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            "<resources>\n"
            f'    <color name="ic_launcher_background">#{BG[0]:02X}{BG[1]:02X}{BG[2]:02X}</color>\n'
            "</resources>\n",
            encoding="utf-8",
        )
        print(f"  values/ic_launcher_background.xml -> #{BG[0]:02X}{BG[1]:02X}{BG[2]:02X}")

    # ---------------------------------------------------------------- 启动屏
    print("\n=== 启动屏 ===")
    if ANDROID_RES.is_dir():
        splashes = sorted(ANDROID_RES.glob("drawable*/splash.png"))
        for p in splashes:
            with Image.open(p) as old:
                w, h = old.size
            img = Image.new("RGB", (w, h), SPLASH_BG)
            # 前景取短边的比例，横竖屏都不会太夸张
            ratio = 0.16
            font = load_font(int(min(w, h) * ratio))
            d = ImageDraw.Draw(img)
            box = d.textbbox((0, 0), GLYPH, font=font)
            tw, th = box[2] - box[0], box[3] - box[1]
            d.text(((w - tw) / 2 - box[0], (h - th) / 2 - box[1]), GLYPH, font=font, fill=FG)
            img.save(p, "PNG", optimize=True)
            print(f"  {p.relative_to(ANDROID_RES)}  {w}x{h}")
        if not splashes:
            print("  未找到 splash.png，跳过")

    print("\n完成。改完图标后需要重新打包 APK 才会生效。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
