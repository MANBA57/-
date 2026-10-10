"""SQLite 访问层。

只读服务：以 SQLite 的只读模式打开数据库，再叠一层 `PRAGMA query_only = ON`，
即使代码写错也不可能改到数据。
刻意不用 ORM —— 库里是手工调过的 schema（FTS5 虚表 + 维度拆表），
ORM 在这些结构上只会碍事，裸 SQL 更直白也更快。
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from urllib.parse import quote

from app.config import DB_PATH


class DatabaseUnavailable(RuntimeError):
    """数据库文件不存在（P1 管线未跑）。"""


def _readonly_uri(path: str) -> str:
    """构造以只读模式打开的 SQLite URI。

    为什么显式用 mode=ro：
        生产把数据以只读卷挂进容器（deploy/docker-compose.yml 的 `:ro`）。
        不显式指定时，sqlite3.connect() 以 READWRITE 打开，然后**依赖 SQLite
        自己回退**——官方文档说 "opened for reading and writing if possible,
        or reading only if the file is write protected by the operating system"。
        实测确实会回退（对文件加只读属性后，默认打开仍能读）。
        但把「只读」写成显式意图，比依赖一条容易被忽略的回退规则更可靠，
        也顺带保证了永远不会因为某次误加的写语句而改动数据。

    已验证：把数据目录设为不可写后，11 个接口 + 图片全部正常
    （见 tools/readonly_mount_check.py 与 tools/readonly_api_smoke.py）。

    百分号编码：路径里的 `?` 与 `#` 在 URI 中有特殊含义，必须转义；
    中文等非 ASCII 字符交给 SQLite 按 UTF-8 处理即可。
    """
    safe = path.replace("\\", "/").replace("?", quote("?")).replace("#", quote("#"))
    return f"file:{safe}?mode=ro"


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
    con = sqlite3.connect(
        _readonly_uri(str(DB_PATH)), uri=True, timeout=5.0, check_same_thread=False
    )
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
