"""全文检索接口。"""

from __future__ import annotations

import sqlite3
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app import queries
from app.db import get_db
from app.schemas import SearchOut
from app.text_search import deseg, to_match_query

router = APIRouter(prefix="/api/v1", tags=["search"])

Db = Annotated[sqlite3.Connection, Depends(get_db)]


@router.get("/search", response_model=SearchOut, summary="全文检索（钱币 + 术语）")
def search(
    db: Db,
    q: Annotated[str, Query(min_length=1, max_length=64, description="关键词，支持 1 字以上中文")],
    type: Literal["all", "coin", "term"] = "all",
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> SearchOut:
    match = to_match_query(q)
    result = queries.search(db, q=q, match_expr=match, kind=type, limit=limit)
    # 索引里汉字被逐个拆开，snippet 会带回多余空格，这里还原
    for hit in result.coins + result.terms:
        hit.snippet = deseg(hit.snippet)
    return result
