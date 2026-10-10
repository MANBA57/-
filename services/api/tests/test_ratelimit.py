"""限流器单元测试。

不走 HTTP：pytest 环境把阈值抬高了，这里直接测令牌桶本身的行为。
"""

from __future__ import annotations

import time

from app.ratelimit import TokenBucketLimiter


def test_burst_then_throttle() -> None:
    lim = TokenBucketLimiter(rate_per_second=1.0, burst=5)
    allowed = [lim.allow("ip") for _ in range(10)]
    assert allowed[:5] == [True] * 5
    assert allowed[5:] == [False] * 5


def test_refill_over_time() -> None:
    lim = TokenBucketLimiter(rate_per_second=50.0, burst=2)
    assert lim.allow("ip") and lim.allow("ip")
    assert not lim.allow("ip")
    time.sleep(0.06)  # 50/s → 约 3 个令牌
    assert lim.allow("ip")


def test_buckets_are_per_key() -> None:
    lim = TokenBucketLimiter(rate_per_second=1.0, burst=1)
    assert lim.allow("a")
    assert not lim.allow("a")
    assert lim.allow("b")  # 另一个 IP 不受影响


def test_never_exceeds_burst() -> None:
    lim = TokenBucketLimiter(rate_per_second=1000.0, burst=3)
    time.sleep(0.05)
    assert sum(lim.allow("ip") for _ in range(50)) == 3
