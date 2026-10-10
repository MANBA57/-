"""API 响应模型。

字段命名与前端 TypeScript 类型一一对应（apps/web/src/api/types.ts）。
凡是「推断」来的数据都带 *_source 标注，前端据此区别展示，不把推断当事实。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Range(BaseModel):
    min: float
    max: float


class CategoryBrief(BaseModel):
    key: str
    name: str


class ImageOut(BaseModel):
    order: int
    role: str
    width: int | None = None
    height: int | None = None
    aspect_ratio: float | None = None
    lqip: str | None = None
    avif: str
    webp: str
    thumb_avif: str
    thumb_webp: str


class CoinBrief(BaseModel):
    slug: str
    name: str
    alias: str | None = None
    category: CategoryBrief
    period_key: str | None = None
    period_source: str | None = None
    states: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    rarity: str | None = None
    image_count: int = 0
    thumbnail: ImageOut | None = None


class CoinDetail(CoinBrief):
    period: str | None = None
    year_mentioned: int | None = None
    description_md: str
    units: list[str] = Field(default_factory=list)
    diameter_mm: Range | None = None
    length_mm: Range | None = None
    weight_g: Range | None = None
    inscription_front: str | None = None
    inscription_back: str | None = None
    images: list[ImageOut] = Field(default_factory=list)
    related: list[CoinBrief] = Field(default_factory=list)
    overridden_fields: list[str] = Field(default_factory=list)


class CoinListOut(BaseModel):
    items: list[CoinBrief]
    total: int
    page: int
    page_size: int
    total_pages: int


class FacetValue(BaseModel):
    value: str
    count: int


class FacetsOut(BaseModel):
    categories: list[FacetValue]
    periods: list[FacetValue]
    states: list[FacetValue]
    materials: list[FacetValue]
    units: list[FacetValue]


class CategoryOut(BaseModel):
    key: str
    name: str
    intro_md: str | None = None
    intro_source: str | None = None  # auto | editor
    coin_count: int
    images: list[ImageOut] = Field(default_factory=list)


class TimelineEntry(BaseModel):
    period_key: str
    period_label: str
    start_year: int | None = None
    end_year: int | None = None
    coins: list[CoinBrief] = Field(default_factory=list)


class EvolutionNode(BaseModel):
    label: str
    system_key: str
    is_coin: bool
    slug: str | None = None


class EvolutionEdge(BaseModel):
    from_label: str
    to_label: str
    kind: str | None = None
    note: str | None = None
    system_key: str


class EvolutionOut(BaseModel):
    nodes: list[EvolutionNode]
    edges: list[EvolutionEdge]


class TermOut(BaseModel):
    name: str
    pinyin: str | None = None
    category: str | None = None
    definition_md: str
    source: str | None = None
    related_slugs: list[str] = Field(default_factory=list)


class SearchHit(BaseModel):
    type: str  # coin | term
    slug: str | None = None
    name: str
    snippet: str
    category: str | None = None


class SearchOut(BaseModel):
    query: str
    match_expression: str
    total: int
    took_ms: float
    coins: list[SearchHit] = Field(default_factory=list)
    terms: list[SearchHit] = Field(default_factory=list)


class StatsOut(BaseModel):
    coin_count: int
    category_count: int
    image_count: int
    term_count: int
    evolution_edge_count: int
    period_span: str
    period_buckets: list[FacetValue]
    image_bytes: int
    source_bytes: int
    compression_ratio: float | None = None
