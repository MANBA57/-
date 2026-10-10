"""运行时配置。刻意只用标准库 os.environ，不引入 pydantic-settings。"""

from __future__ import annotations

import os
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = API_DIR.parent.parent

# SQLite 数据库位置（P1 由 scripts/build_db.py 生成）
DB_PATH = Path(os.environ.get("COIN_DB", API_DIR / "content" / "app.db"))

# 静态资源（图片）目录，由 Caddy 直接托管；本地开发时 FastAPI 也可以挂载
STATIC_DIR = Path(os.environ.get("COIN_STATIC", API_DIR / "static"))

# CORS 白名单。
# https://localhost 与 capacitor://localhost 是 Capacitor WebView 的真实 Origin，
# 漏掉会导致打包后的 APK 里所有请求被拦。
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "COIN_ALLOWED_ORIGINS",
        ",".join(
            [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:4173",
                "http://127.0.0.1:4173",
                "https://localhost",
                "capacitor://localhost",
            ]
        ),
    ).split(",")
    if origin.strip()
]

# 公开站点的简易限流阈值（每秒每 IP 的请求数）
RATE_LIMIT_PER_SECOND = int(os.environ.get("COIN_RATE_LIMIT", "20"))
