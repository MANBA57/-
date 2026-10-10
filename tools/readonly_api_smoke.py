#!/usr/bin/env python3
"""配合 readonly_mount_check.py：在只读数据目录上跑一遍真实接口。

用 FastAPI 的 TestClient 而不是起 uvicorn —— 它同样会经过依赖注入与线程池，
覆盖到「SQLite 连接跨线程」那条路径，但不需要管理后台进程。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ["COIN_DB"] = str(ROOT / ".tmp" / "ro-content" / "app.db")
os.environ["COIN_STATIC"] = str(ROOT / ".tmp" / "ro-static")
os.environ["COIN_RATE_LIMIT"] = "1000000"
sys.path.insert(0, str(ROOT / "services" / "api"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ENDPOINTS = [
    "/api/v1/health",
    "/api/v1/stats",
    "/api/v1/categories",
    "/api/v1/facets",
    "/api/v1/coins?page_size=3",
    "/api/v1/coins/01-空首布",
    "/api/v1/search?q=刀币",
    "/api/v1/search?q=圜",
    "/api/v1/timeline",
    "/api/v1/evolution",
    "/api/v1/terms",
]

client = TestClient(app)
fails = 0
for url in ENDPOINTS:
    r = client.get(url)
    ok = r.status_code == 200
    fails += 0 if ok else 1
    print(f"  {'OK ' if ok else '✗  '} {r.status_code}  {url}")

r = client.get("/images/coins/01-空首布/thumb/01.webp")
ctype = r.headers.get("content-type", "")
ok = r.status_code == 200 and ctype.startswith("image/")
fails += 0 if ok else 1
print(f"  {'OK ' if ok else '✗  '} {r.status_code}  /images/... ({len(r.content)} B, {ctype})")

print()
print("  ✓ 只读挂载下全部通过" if fails == 0 else f"  ✗ {fails} 项失败")
sys.exit(1 if fails else 0)
