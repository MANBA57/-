"""SQLite 访问层。

只读服务：连接后立刻 `PRAGMA query_only = ON`，即使代码写错也不可能改到数据。
刻意不用 ORM —— 库里是手工调过的 schema（FTS5 虚表 + 维度拆表），
ORM 在这些结构上只会碍事，裸 SQL 更直白也更快。
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from app.config import DB_PATH


class DatabaseUnavailable(RuntimeError):
    """数据库文件不存在（P1 管线未跑）。"""


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise DatabaseUnavailable(
            f"数据库不存在: {DB_PATH}\n请先执行: python scripts/run_pipeline.py"
        )
    # check_same_thread=False 是必需的，不是偷懒：
    # FastAPI 把「同步依赖」和「同步端点」分别丢进线程池执行，两者可能落在不同线程，
    # 于是连接会在 A 线程创建、在 B 线程使用，触发
    #   sqlite3.ProgrammingError: SQLite objects created in a thread can only be used in that same thread
    # 而且它是偶发的（线程恰好复用时不会报），线上表现为随机 500。
    # 安全性：每个请求独享一个连接、串行使用，不存在同一连接的并发访问。
    con = sqlite3.connect(str(DB_PATH), timeout=5.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only = ON")
    return con


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI 依赖：每个请求一个连接。"""
    con = connect()
    try:
        yield con
    finally:
        con.close()
