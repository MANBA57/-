#!/usr/bin/env python3
"""在开发机上用真实的 Caddyfile 验证生产拓扑。

和 docker compose 用的是**同一份** deploy/Caddyfile，只是把三个变量指向本机路径：
    API_UPSTREAM=127.0.0.1:8000      （compose 里是服务名 api:8000）
    WEB_ROOT=<apps/web/dist 绝对路径>  （compose 里是 /srv/web）
    IMAGES_ROOT=<static/images 路径>  （compose 里是 /srv/images）

检查项：SPA 回退、/api 反代、/images 静态托管与 MIME、缓存头、安全头。

用法：
    python deploy/verify_local.py
    python deploy/verify_local.py --port 8080
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CADDY = ROOT / ".toolchain" / "caddy" / "caddy.exe"
CADDYFILE = ROOT / "deploy" / "Caddyfile"
DIST = ROOT / "apps" / "web" / "dist"
IMAGES = ROOT / "services" / "api" / "static" / "images"


def as_caddy_path(p: Path) -> str:
    # Caddy 在 Windows 上接受正斜杠；反斜杠会被当成转义符
    return p.as_posix()


def fetch(url: str, method: str = "GET") -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, method=method, headers={"User-Agent": "verify-local"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--api-upstream", default="127.0.0.1:8000")
    args = ap.parse_args()

    for p, what in ((CADDY, "Caddy（先跑 deploy 前先下载，见 README）"),
                    (CADDYFILE, "Caddyfile"),
                    (DIST, "前端产物（先 pnpm build）"),
                    (IMAGES, "图片目录（先跑数据管线）")):
        if not p.exists():
            print(f"[verify] ✗ 缺少{what}: {p}")
            return 1

    env = os.environ.copy()
    # Caddy 在 Windows 上默认把数据目录放在 %AppData%\Caddy，本机不可写会刷警告；
    # 指到项目内。Docker 里由 caddy_data 卷承担，不需要这一步。
    caddy_home = ROOT / ".toolchain" / "caddy-home"
    caddy_home.mkdir(parents=True, exist_ok=True)
    env.update(
        {
            "SITE_ADDRESS": f":{args.port}",
            "API_UPSTREAM": args.api_upstream,
            "WEB_ROOT": as_caddy_path(DIST),
            "IMAGES_ROOT": as_caddy_path(IMAGES),
            "APPDATA": str(caddy_home),
            "XDG_DATA_HOME": str(caddy_home),
            "XDG_CONFIG_HOME": str(caddy_home),
        }
    )

    print("[verify] 校验 Caddyfile …")
    rc = subprocess.run(
        [str(CADDY), "validate", "--config", str(CADDYFILE), "--adapter", "caddyfile"],
        env=env,
        capture_output=True,
        text=True,
    )
    if rc.returncode != 0:
        print(f"[verify] ✗ 配置校验失败:\n{rc.stdout}\n{rc.stderr}")
        return 1
    print(f"  ✓ 配置合法  {rc.stderr.strip()}")

    # 后端必须在跑，否则 /api 反代会 502
    try:
        status, _, _ = fetch(f"http://{args.api_upstream}/api/v1/health")
        print(f"[verify] 后端 {args.api_upstream} 在线 (HTTP {status})")
    except Exception as exc:  # noqa: BLE001
        print(f"[verify] ✗ 后端 {args.api_upstream} 不可达: {exc}")
        print("         先启动：.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000")
        return 1

    print("[verify] 启动 Caddy …")
    proc = subprocess.Popen(
        [str(CADDY), "run", "--config", str(CADDYFILE), "--adapter", "caddyfile"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )

    base = f"http://127.0.0.1:{args.port}"
    failures: list[str] = []
    try:
        for _ in range(40):
            time.sleep(0.25)
            try:
                fetch(f"{base}/")
                break
            except Exception:  # noqa: BLE001
                continue
        else:
            print("[verify] ✗ Caddy 未能就绪")
            return 1

        def check(label: str, cond: bool, extra: str = "") -> None:
            print(("  ✓ " if cond else "  ✗ ") + label + (f"  {extra}" if extra else ""))
            if not cond:
                failures.append(label)

        # ---- SPA 与前端资源 ----
        st, hdr, body = fetch(f"{base}/")
        check("GET / 返回首页", st == 200 and b'id="root"' in body, f"HTTP {st}, {len(body)}B")
        check("index.html 不缓存", "no-cache" in hdr.get("Cache-Control", ""), hdr.get("Cache-Control", "—"))

        st, _, body = fetch(f"{base}/coins")
        check("SPA 回退 /coins", st == 200 and b'id="root"' in body, f"HTTP {st}")

        st, _, body = fetch(f"{base}/design")
        check("SPA 回退 /design", st == 200 and b'id="root"' in body, f"HTTP {st}")

        # 从 index.html 里取真实的带哈希资源名
        st, _, body = fetch(f"{base}/")
        import re

        text = body.decode("utf-8", "ignore")
        asset = re.search(r'/assets/[A-Za-z0-9._-]+\.js', text)
        if asset:
            st, hdr, body = fetch(base + asset.group(0))
            check(
                "哈希资源永久缓存",
                st == 200 and "immutable" in hdr.get("Cache-Control", ""),
                hdr.get("Cache-Control", "—"),
            )
        else:
            failures.append("index.html 里找不到 /assets/*.js")

        # ---- /api 反代 ----
        st, hdr, body = fetch(f"{base}/api/v1/health")
        check("API 反代 /api/v1/health", st == 200 and b'"status":"ok"' in body, f"HTTP {st}")

        st, _, body = fetch(f"{base}/api/v1/coins?" + urllib.parse.urlencode({"page_size": 3}))
        check("API 反代 /api/v1/coins", st == 200 and b'"total":27' in body, f"HTTP {st}")

        st, _, body = fetch(f"{base}/api/v1/search?" + urllib.parse.urlencode({"q": "刀币"}))
        check("中文检索经反代可用", st == 200 and b'"total"' in body, f"HTTP {st}")

        # ---- /images 静态托管 ----
        st, _, body = fetch(f"{base}/api/v1/coins/" + urllib.parse.quote("01-空首布"))
        import json

        coin = json.loads(body)
        img = coin["images"][0]["thumb_webp"]
        st, hdr, body = fetch(base + urllib.parse.quote(img))
        check(
            "/images 命中且 MIME 正确",
            st == 200 and hdr.get("Content-Type", "").startswith("image/"),
            f"HTTP {st} {hdr.get('Content-Type')} {len(body)}B",
        )
        check("图片有一周缓存", "max-age=604800" in hdr.get("Cache-Control", ""), hdr.get("Cache-Control", "—"))

        st, _, _ = fetch(base + "/images/does-not-exist.webp")
        check("不存在的图片返回 404", st == 404, f"HTTP {st}")

        # ---- 安全头 ----
        st, hdr, _ = fetch(f"{base}/")
        check("X-Content-Type-Options", hdr.get("X-Content-Type-Options") == "nosniff")
        check("Referrer-Policy", hdr.get("Referrer-Policy") == "strict-origin-when-cross-origin")
        check("隐藏 Server 头", "Server" not in hdr)

        # ---- 预渲染 / SEO / PWA ----
        st, _, body = fetch(f"{base}/coins/" + urllib.parse.quote("01-空首布"))
        text = body.decode("utf-8", "ignore")
        check(
            "预渲染路由返回该页专属 HTML",
            st == 200 and "空首布 · 布币类" in text,
            f"HTTP {st}",
        )
        check("预渲染页含 noscript 正文", "<noscript>" in text)
        check("预渲染页含 JSON-LD", "application/ld+json" in text)

        st, _, body = fetch(f"{base}/sitemap.xml")
        check("sitemap.xml", st == 200 and b"<urlset" in body, f"HTTP {st} {len(body)}B")

        st, _, body = fetch(f"{base}/robots.txt")
        check("robots.txt", st == 200 and b"Sitemap:" in body, f"HTTP {st}")

        st, hdr, body = fetch(f"{base}/sw.js")
        check(
            "Service Worker 可获取且不可长效缓存",
            st == 200 and "no-cache" in hdr.get("Cache-Control", ""),
            f"HTTP {st} {hdr.get('Cache-Control', '—')}",
        )

        st, hdr, body = fetch(f"{base}/manifest.webmanifest")
        check(
            "PWA manifest",
            st == 200 and b'"display": "standalone"' in body,
            f"HTTP {st} {hdr.get('Content-Type')}",
        )

        st, hdr, body = fetch(f"{base}/icon-192.png")
        check(
            "PWA 图标",
            st == 200 and hdr.get("Content-Type", "").startswith("image/png"),
            f"HTTP {st} {hdr.get('Content-Type')}",
        )

        # ---- 压缩 ----
        req = urllib.request.Request(
            f"{base}/", headers={"User-Agent": "verify-local", "Accept-Encoding": "gzip"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            check("启用 gzip 压缩", r.headers.get("Content-Encoding") == "gzip",
                  str(r.headers.get("Content-Encoding")))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        err = proc.stderr.read() if proc.stderr else ""
        if err and "error" in err.lower():
            print("[verify] Caddy stderr:\n" + err[:1500])

    print()
    if failures:
        print(f"[verify] ✗ {len(failures)} 项失败: {failures}")
        return 1
    print("[verify] ✓ 生产拓扑全部通过（与 docker compose 用的是同一份 Caddyfile）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
