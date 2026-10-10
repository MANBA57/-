"""pytest 全局配置。

测试里把限流阈值抬到极高，避免大量断言请求互相触发 429；
限流本身另有专门的用例。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ["COIN_RATE_LIMIT"] = "1000000"

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import pytest  # noqa: E402

from app.config import DB_PATH  # noqa: E402


@pytest.fixture(scope="session")
def client():
    if not DB_PATH.exists():
        pytest.skip(f"数据库不存在（{DB_PATH}），请先执行 python scripts/run_pipeline.py")
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c
