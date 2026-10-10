"""行程限流：内存令牌桶，按客户端 IP 计数。

公开免登录站点必须防刷（尤其是 /search 与后续的计算类接口）。这里刻意用最简单的
实现：单进程内存字典 + 惰性清理。站点是单进程部署，不需要 Redis。

注意：代理后面拿到的 client.host 是代理地址，所以优先读 X-Forwarded-For 的第一段。
Caddy 反代时由它注入该头。
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


@dataclass
class _Bucket:
    tokens: float
    updated: float = field(default_factory=time.monotonic)


class TokenBucketLimiter:
    def __init__(self, rate_per_second: float, burst: int) -> None:
        self.rate = rate_per_second
        self.burst = burst
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()
        self._last_prune = time.monotonic()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                b = _Bucket(tokens=float(self.burst), updated=now)
                self._buckets[key] = b
            else:
                b.tokens = min(self.burst, b.tokens + (now - b.updated) * self.rate)
                b.updated = now
            if b.tokens < 1.0:
                return False
            b.tokens -= 1.0
            # 每 5 分钟清一次长期不活跃的桶，避免内存无界增长
            if now - self._last_prune > 300:
                stale = [k for k, v in self._buckets.items() if now - v.updated > 300]
                for k in stale:
                    self._buckets.pop(k, None)
                self._last_prune = now
            return True


def client_key(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, rate_per_second: float = 20.0, burst: int | None = None) -> None:
        super().__init__(app)
        self.limiter = TokenBucketLimiter(rate_per_second, burst or max(10, int(rate_per_second * 2)))

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        # 静态资源与文档不受限，限流只针对 API
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
            if not self.limiter.allow(client_key(request)):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "请求过于频繁，请稍后再试"},
                    headers={"Retry-After": "1"},
                )
        return await call_next(request)
