"""FastAPI 入口。

只读公开 API：无鉴权、无写接口。数据来自 P1 管线生成的 SQLite。
"""

from __future__ import annotations

import mimetypes
import sqlite3
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config import ALLOWED_ORIGINS, DB_PATH, RATE_LIMIT_PER_SECOND, STATIC_DIR
from app.db import DatabaseUnavailable, connect
from app.ratelimit import RateLimitMiddleware
from app.routers import catalog, search


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    # 启动即探一次数据库，把「管线没跑」这种问题在启动日志里就暴露出来
    try:
        con = connect()
        n = con.execute("SELECT COUNT(*) FROM coin").fetchone()[0]
        con.close()
        print(f"[api] 数据库就绪: {DB_PATH}（{n} 条钱币）")
    except DatabaseUnavailable as exc:
        print(f"[api] ⚠ {exc}")
    except sqlite3.Error as exc:
        print(f"[api] ⚠ 数据库读取失败: {exc}")
    yield


app = FastAPI(
    title="数字钱币库 API",
    description="先秦四大货币体系的数字化展馆后端，公开只读。",
    version=__version__,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# 中间件顺序：先限流再 CORS（CORS 必须在最外层，否则 429 响应会缺 CORS 头）
app.add_middleware(RateLimitMiddleware, rate_per_second=RATE_LIMIT_PER_SECOND)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(DatabaseUnavailable)
async def db_unavailable_handler(request: Request, exc: DatabaseUnavailable) -> JSONResponse:
    # 管线未跑时给出可执行的指引，而不是 500 堆栈
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.get("/api/v1/health", tags=["meta"], summary="存活探针 + 数据就绪状态")
def health() -> dict[str, Any]:
    info: dict[str, Any] = {
        "status": "ok",
        "version": __version__,
        "database": {"path": str(DB_PATH), "exists": DB_PATH.exists()},
    }
    if DB_PATH.exists():
        try:
            con = connect()
            info["database"]["coins"] = con.execute("SELECT COUNT(*) FROM coin").fetchone()[0]
            info["database"]["images"] = con.execute(
                "SELECT COUNT(DISTINCT sha256) FROM coin_image"
            ).fetchone()[0]
            con.close()
        except sqlite3.Error as exc:
            info["status"] = "degraded"
            info["database"]["error"] = str(exc)
    else:
        info["status"] = "degraded"
    return info


app.include_router(catalog.router)
app.include_router(search.router)

# 图片由 Caddy 在生产环境直接托管；本地开发时由 FastAPI 代劳，
# 免得还要单独起一个静态服务。
# 必须先注册 MIME 类型：Python 的 mimetypes 默认不认识这两个格式，
# 否则会以 application/octet-stream 返回，<img> 可能直接不渲染。
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")

_images_dir = STATIC_DIR / "images"
if _images_dir.is_dir():
    app.mount("/images", StaticFiles(directory=str(_images_dir)), name="images")
