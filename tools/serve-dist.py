#!/usr/bin/env python3
"""本地预览：托管 apps/web/dist，并把 /api 与 /images 反代到后端。

用途：本机沙箱禁止子进程使用管道，Vite 在 Windows 下会 exec("net use") 探测
网络驱动器（该调用无 try 包裹）→ spawn EPERM，导致 `vite dev` / `vite preview`
在受限模式下无法启动。此脚本用 Python 标准库直接托管构建产物，不受该限制。

**代理是刻意的**：前端因此可以用同源相对路径访问 API，构建时不需要写死后端地址；
同一份产物既能本地预览，也能直接丢给 Caddy 托管。

需要热更新（HMR）时请改用 `pnpm dev`，但那要求会话处于非受限文件策略下。

用法:
    python tools/serve-dist.py [--port 4173] [--api http://127.0.0.1:8000]
"""

from __future__ import annotations

import argparse
import functools
import http.client
import http.server
import mimetypes
import os
import socketserver
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "web" / "dist"

PROXY_PREFIXES = ("/api/", "/images/")
# 逐跳首部，按 RFC 不该转发
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "coin-museum-preview"

    # ---------------------------------------------------------------- 代理

    def _is_proxy_path(self) -> bool:
        return any(self.path.startswith(p) for p in PROXY_PREFIXES)

    def _proxy(self) -> None:
        base: urllib.parse.SplitResult = self.server.api_base  # type: ignore[attr-defined]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        headers = {
            k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP | {"host"}
        }
        headers["Host"] = base.netloc
        headers["Accept-Encoding"] = "identity"  # 避免要处理压缩流

        conn_cls = http.client.HTTPSConnection if base.scheme == "https" else http.client.HTTPConnection
        conn = conn_cls(base.netloc, timeout=30)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            payload = resp.read()
        except Exception as exc:  # noqa: BLE001
            self.send_error(502, f"后端不可达：{exc}")
            return
        finally:
            conn.close()

        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() in HOP_BY_HOP or k.lower() == "content-length":
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    # ---------------------------------------------------------------- 静态

    def send_head(self):  # type: ignore[override]
        if self._is_proxy_path():
            return None  # 由 do_GET/do_HEAD 另行处理
        path = self.translate_path(self.path)
        if not os.path.exists(path):
            # 未命中：回退到 SPA 外壳，由前端路由接管
            self.path = "/index.html"
        elif os.path.isdir(path) and not os.path.isfile(os.path.join(path, "index.html")):
            # 目录存在但没有自己的 index.html —— 同样回退。
            # 有 index.html 时不要覆盖 self.path：
            # 那是预渲染为该路由单独生成的文件，带独立的标题与元数据。
            self.path = "/index.html"
        return super().send_head()

    def do_GET(self) -> None:  # noqa: N802
        if self._is_proxy_path():
            self._proxy()
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self._is_proxy_path():
            self._proxy()
            return
        super().do_HEAD()

    def end_headers(self) -> None:  # type: ignore[override]
        if not self._is_proxy_path():
            # 预览时禁用缓存，避免看到旧产物
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:  # type: ignore[override]
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4173)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--api", default="http://127.0.0.1:8000", help="后端地址，供 /api 与 /images 反代")
    args = ap.parse_args()

    if not DIST.is_dir():
        print(f"[serve-dist] 找不到构建产物: {DIST}", file=sys.stderr)
        print("[serve-dist] 请先执行: pnpm build", file=sys.stderr)
        return 1

    mimetypes.add_type("image/avif", ".avif")
    mimetypes.add_type("image/webp", ".webp")
    # Python 的 mimetypes 不认识 .webmanifest，不注册会以 application/octet-stream 返回
    mimetypes.add_type("application/manifest+json", ".webmanifest")

    handler = functools.partial(Handler, directory=str(DIST))
    with ReusableServer((args.host, args.port), handler) as httpd:
        httpd.api_base = urllib.parse.urlsplit(args.api)  # type: ignore[attr-defined]
        print(f"[serve-dist] 托管 {DIST}")
        print(f"[serve-dist] 反代 {PROXY_PREFIXES} -> {args.api}")
        print(f"[serve-dist] http://{args.host}:{args.port}/")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
