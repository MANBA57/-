"""目录类接口：钱币、体系、维度、时间轴、演化、术语、统计。"""

from __future__ import annotations

import sqlite3
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app import queries
from app.db import get_db
from app.schemas import (
    CategoryOut,
    CoinDetail,
    CoinListOut,
    EvolutionOut,
    FacetsOut,
    StatsOut,
    TermOut,
    TimelineEntry,
)
from app.text_search import to_match_query

router = APIRouter(prefix="/api/v1", tags=["catalog"])

Db = Annotated[sqlite3.Connection, Depends(get_db)]


# ---------------------------------------------------------------- 钱币

@router.get("/coins", response_model=CoinListOut, summary="钱币列表（筛选 + 分页）")
def list_coins(
    db: Db,
    category: Annotated[str | None, Query(description="体系 key：bu/dao/yuan/bei")] = None,
    period: Annotated[str | None, Query(description="时期，如「战国中期」")] = None,
    state: Annotated[str | None, Query(description="国别，如「魏」")] = None,
    material: Annotated[str | None, Query(description="材质，如「青铜」")] = None,
    q: Annotated[str | None, Query(max_length=64, description="关键词，走全文检索")] = None,
    sort: Literal["order", "period", "name", "weight"] = "order",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> CoinListOut:
    match = to_match_query(q) if q else ""
    items, total = queries.list_coins(
        db, category=category, period=period, state=state, material=material,
        q=q, match_expr=match, sort=sort, page=page, page_size=page_size,
    )
    return CoinListOut(
        items=items, total=total, page=page, page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


# 必须声明在 /coins/{slug} 之前，否则 "compare" 会被当成 slug
@router.get("/coins/compare", response_model=list[CoinDetail], summary="并排对比 2~3 枚钱币")
def compare(
    db: Db,
    slugs: Annotated[str, Query(description="逗号分隔的 slug，例如 01-空首布,08-三孔布")],
) -> list[CoinDetail]:
    parts = [s.strip() for s in slugs.split(",") if s.strip()]
    if not 2 <= len(parts) <= 3:
        raise HTTPException(status_code=422, detail="对比需要 2~3 枚钱币")
    found = queries.compare_coins(db, parts)
    missing = [s for s in parts if all(f.slug != s for f in found)]
    if missing:
        raise HTTPException(status_code=404, detail=f"找不到钱币: {missing}")
    return found


@router.get("/coins/{slug}", response_model=CoinDetail, summary="钱币详情")
def coin_detail(db: Db, slug: str) -> CoinDetail:
    coin = queries.get_coin(db, slug)
    if coin is None:
        raise HTTPException(status_code=404, detail=f"找不到钱币: {slug}")
    return coin


# ---------------------------------------------------------------- 维度与体系

@router.get("/facets", response_model=FacetsOut, summary="各维度可选值与计数（驱动筛选面板）")
def get_facets(db: Db) -> FacetsOut:
    return queries.facets(db)


@router.get("/categories", response_model=list[CategoryOut], summary="四大货币体系")
def get_categories(db: Db) -> list[CategoryOut]:
    return [CategoryOut(**c) for c in queries.categories(db)]


# ---------------------------------------------------------------- 时间轴与演化

@router.get("/timeline", response_model=list[TimelineEntry], summary="按时期分组的时间轴")
def get_timeline(db: Db) -> list[TimelineEntry]:
    return queries.timeline(db)


@router.get("/evolution", response_model=EvolutionOut, summary="货币体系演化关系图")
def get_evolution(db: Db) -> EvolutionOut:
    return queries.evolution(db)


# ---------------------------------------------------------------- 术语与统计

@router.get("/terms", response_model=list[TermOut], summary="术语词典")
def get_terms(
    db: Db,
    q: Annotated[str | None, Query(max_length=64, description="按名称或释义检索")] = None,
) -> list[TermOut]:
    return queries.terms(db, q=q, match_expr=to_match_query(q) if q else "")


@router.get("/stats", response_model=StatsOut, summary="站点统计（首页数字）")
def get_stats(db: Db) -> StatsOut:
    return queries.stats(db)
