"""目录与检索接口的契约测试。

数值断言都是硬编码的「金标准」，来自 P1 管线对《先秦(2).docx》的实际解析结果。
数据换了新的 docx 时这些数字需要同步更新 —— 那正是它们存在的意义。
"""

from __future__ import annotations

import pytest

from app.config import DB_PATH

EXPECTED_COINS = 27
EXPECTED_CATEGORIES = 4
EXPECTED_UNIQUE_IMAGES = 48
EXPECTED_TERMS = 12
EXPECTED_EDGES = 14


# ---------------------------------------------------------------- meta

def test_health(client) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["database"]["exists"] is True
    assert body["database"]["coins"] == EXPECTED_COINS
    assert body["database"]["images"] == EXPECTED_UNIQUE_IMAGES


def test_stats(client) -> None:
    d = client.get("/api/v1/stats").json()
    assert d["coin_count"] == EXPECTED_COINS
    assert d["category_count"] == EXPECTED_CATEGORIES
    assert d["image_count"] == EXPECTED_UNIQUE_IMAGES
    assert d["term_count"] == EXPECTED_TERMS
    assert d["evolution_edge_count"] == EXPECTED_EDGES
    assert len(d["period_buckets"]) == 5
    assert sum(b["count"] for b in d["period_buckets"]) == EXPECTED_COINS


def test_stats_dedupes_repeated_image_references(client) -> None:
    """被重复引用的图片在 coin_image 里有多行，统计必须按 sha256 去重，
    否则压缩比会虚高（曾出现 86.3 MB / 12.0× 的错误值）。"""
    d = client.get("/api/v1/stats").json()
    assert 80 * 1048576 < d["source_bytes"] < 83 * 1048576, d["source_bytes"]
    assert 6.5 * 1048576 < d["image_bytes"] < 7.5 * 1048576, d["image_bytes"]
    assert 11.0 < d["compression_ratio"] < 12.0


# ---------------------------------------------------------------- 列表

def test_coin_list_defaults(client) -> None:
    d = client.get("/api/v1/coins").json()
    assert d["total"] == EXPECTED_COINS
    assert d["page"] == 1
    assert d["total_pages"] == 2  # 每页 24 条 → 27 条共 2 页


def test_coin_list_pagination(client) -> None:
    p1 = client.get("/api/v1/coins", params={"page": 1, "page_size": 10}).json()
    p2 = client.get("/api/v1/coins", params={"page": 2, "page_size": 10}).json()
    assert len(p1["items"]) == 10 and len(p2["items"]) == 10
    assert p1["total_pages"] == 3
    assert {i["slug"] for i in p1["items"]} & {i["slug"] for i in p2["items"]} == set()


@pytest.mark.parametrize(
    "params,expected",
    [
        ({"category": "bu"}, 11),
        ({"category": "dao"}, 8),
        ({"category": "yuan"}, 6),
        ({"category": "bei"}, 2),
        ({"period": "战国晚期"}, 6),
        ({"state": "魏"}, 3),
        ({"material": "青铜"}, 5),
    ],
)
def test_coin_list_filters(client, params, expected) -> None:
    d = client.get("/api/v1/coins", params=params).json()
    assert d["total"] == expected, f"{params} -> {d['total']}"


def test_coin_list_combined_filters(client) -> None:
    d = client.get("/api/v1/coins", params={"category": "bu", "material": "青铜"}).json()
    assert 0 < d["total"] < 11
    for item in d["items"]:
        assert item["category"]["key"] == "bu"
        assert "青铜" in item["materials"]


def test_coin_list_sort_by_period(client) -> None:
    d = client.get("/api/v1/coins", params={"sort": "period"}).json()
    assert d["items"][0]["period_key"] == "商周"


def test_coin_list_rejects_bad_params(client) -> None:
    assert client.get("/api/v1/coins", params={"page": 0}).status_code == 422
    assert client.get("/api/v1/coins", params={"page_size": 999}).status_code == 422
    assert client.get("/api/v1/coins", params={"sort": "drop table"}).status_code == 422


# ---------------------------------------------------------------- 详情

def test_coin_detail(client) -> None:
    d = client.get("/api/v1/coins/01-空首布").json()
    assert d["name"] == "空首布"
    assert d["category"]["key"] == "bu"
    assert len(d["images"]) == 2
    assert d["images"][0]["thumb_webp"].endswith(".webp")
    assert d["images"][0]["lqip"].startswith("data:image/webp;base64,")
    assert len(d["related"]) == 4
    assert all(r["slug"] != d["slug"] for r in d["related"])
    assert d["description_md"]


def test_coin_detail_reports_period_provenance(client) -> None:
    """时期来源必须能区分「原文明确」与「人工补充」，否则等于把推断当事实展示。"""
    auto = client.get("/api/v1/coins/01-空首布").json()
    assert auto["period_source"] == "auto"

    editor = client.get("/api/v1/coins/08-三孔布").json()
    assert editor["period_source"] == "editor"
    assert "period" in editor["overridden_fields"]

    inferred = client.get("/api/v1/coins/14-卤刀").json()
    assert inferred["period_source"] == "inferred"


def test_coin_detail_404(client) -> None:
    assert client.get("/api/v1/coins/99-不存在").status_code == 404


def test_coin_detail_optional_ranges(client) -> None:
    """原文没给尺寸的条目，ranges 必须是 null，而不是 0。"""
    d = client.get("/api/v1/coins/01-空首布").json()
    assert d["diameter_mm"] is None and d["weight_g"] is None
    d2 = client.get("/api/v1/coins/03-楚布").json()
    assert d2["length_mm"] == {"min": 100.0, "max": 100.0}
    assert d2["weight_g"] == {"min": 30.0, "max": 33.0}


def test_state_order_is_semantic_not_alphabetical(client) -> None:
    """回归：国别应按分析器插入的语意顺序返回。

    曾经的写法是 ORDER BY state，而 SQLite 对中文按 UTF-8 字节序排
    （卫 U+536B < 周 U+5468 < 宋 < 郑），会把「周王室·卫·郑·宋」打乱成
    「卫·周王室·宋·郑」，界面上读起来很别扭。
    """
    d = client.get("/api/v1/coins/01-空首布").json()
    assert d["states"] == ["周王室", "卫", "郑", "宋"]


# ---------------------------------------------------------------- 对比

def test_compare(client) -> None:
    d = client.get("/api/v1/coins/compare", params={"slugs": "01-空首布,08-三孔布"}).json()
    assert [c["name"] for c in d] == ["空首布", "三孔布"]


def test_compare_requires_two(client) -> None:
    assert client.get("/api/v1/coins/compare", params={"slugs": "01-空首布"}).status_code == 422


def test_compare_rejects_four(client) -> None:
    slugs = ",".join(["01-空首布", "02-桥足布", "03-楚布", "04-四布当釿"])
    assert client.get("/api/v1/coins/compare", params={"slugs": slugs}).status_code == 422


def test_compare_unknown_slug(client) -> None:
    r = client.get("/api/v1/coins/compare", params={"slugs": "01-空首布,99-不存在"})
    assert r.status_code == 404


# ---------------------------------------------------------------- 维度与体系

def test_facets(client) -> None:
    d = client.get("/api/v1/facets").json()
    assert len(d["categories"]) == EXPECTED_CATEGORIES
    assert [p["value"] for p in d["periods"]] == ["商周", "春秋", "战国早期", "战国中期", "战国晚期"]
    assert sum(c["count"] for c in d["categories"]) == EXPECTED_COINS
    assert any(s["value"] == "魏" for s in d["states"])
    assert any(m["value"] == "青铜" for m in d["materials"])


def test_categories(client) -> None:
    d = client.get("/api/v1/categories").json()
    assert [c["key"] for c in d] == ["bu", "dao", "yuan", "bei"]
    assert sum(c["coin_count"] for c in d) == EXPECTED_COINS
    # 「贝币与原始货币类」在原文里没有导语段落，由覆盖层补上；
    # 其余三类导语是原文自带的。两者都必须标出来源。
    assert all(c["intro_md"] for c in d)
    assert all(c["intro_source"] in ("auto", "editor") for c in d)
    by_key = {c["key"]: c for c in d}
    assert by_key["bei"]["intro_source"] == "editor"
    assert by_key["bu"]["intro_source"] == "auto"


# ---------------------------------------------------------------- 时间轴与演化

def test_timeline(client) -> None:
    d = client.get("/api/v1/timeline").json()
    assert len(d) == 5
    assert sum(len(t["coins"]) for t in d) == EXPECTED_COINS
    # 时间轴必须按年代先后排列（period_order 升序）
    starts = [t["start_year"] for t in d]
    assert starts == sorted(starts)
    assert starts[0] == -1600


def test_evolution(client) -> None:
    d = client.get("/api/v1/evolution").json()
    assert len(d["edges"]) == EXPECTED_EDGES
    assert {e["system_key"] for e in d["edges"]} >= {"bu", "dao", "yuan", "bei"}
    jumpable = [n for n in d["nodes"] if n["is_coin"]]
    assert len(jumpable) >= 8
    assert all(n["slug"] for n in jumpable)


# ---------------------------------------------------------------- 术语

def test_terms(client) -> None:
    d = client.get("/api/v1/terms").json()
    assert len(d) == EXPECTED_TERMS
    names = {t["name"] for t in d}
    assert {"釿", "寽", "朋", "朱", "郢爰"} <= names


def test_terms_related_coins(client) -> None:
    d = client.get("/api/v1/terms", params={"q": "釿"}).json()
    assert d
    jin = next(t for t in d if t["name"] == "釿")
    assert "10-梁充釿五二十当寽" in jin["related_slugs"]


def test_terms_all_have_related(client) -> None:
    d = client.get("/api/v1/terms").json()
    assert all(t["related_slugs"] for t in d)


# ---------------------------------------------------------------- 搜索

@pytest.mark.parametrize("kw", ["布", "刀币", "青铜", "魏国", "空首布", "蚁鼻钱", "圜钱", "纪重铭文"])
def test_search_various_lengths(client, kw: str) -> None:
    """关键回归：双字中文查询曾因 trigram 分词器全部返回 0。"""
    d = client.get("/api/v1/search", params={"q": kw}).json()
    assert d["total"] > 0, f"「{kw}」无结果，match={d['match_expression']}"


def test_search_match_expression(client) -> None:
    d = client.get("/api/v1/search", params={"q": "青铜"}).json()
    assert d["match_expression"] == '"青 铜"'


def test_search_snippet_is_desegmented(client) -> None:
    d = client.get("/api/v1/search", params={"q": "青铜", "type": "coin"}).json()
    snip = d["coins"][0]["snippet"]
    assert "青 铜" not in snip, f"snippet 未还原: {snip!r}"
    assert "<<" in snip and ">>" in snip


def test_search_type_filter(client) -> None:
    coins_only = client.get("/api/v1/search", params={"q": "青铜", "type": "coin"}).json()
    assert coins_only["terms"] == []
    terms_only = client.get("/api/v1/search", params={"q": "釿", "type": "term"}).json()
    assert terms_only["coins"] == []
    assert terms_only["terms"]


def test_search_empty_query_rejected(client) -> None:
    assert client.get("/api/v1/search", params={"q": ""}).status_code == 422


def test_search_limit_respected(client) -> None:
    d = client.get("/api/v1/search", params={"q": "布", "limit": 3}).json()
    assert len(d["coins"]) <= 3


# ---------------------------------------------------------------- 图片静态托管

def test_image_served_with_correct_mime(client) -> None:
    """webp/avif 未被注册 MIME 时会以 application/octet-stream 返回，<img> 可能不渲染。"""
    if not (DB_PATH.parent.parent / "static" / "images").is_dir():
        pytest.skip("静态图片目录不存在")
    coin = client.get("/api/v1/coins/01-空首布").json()
    url = coin["images"][0]["thumb_webp"]
    r = client.get(url)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/webp")


# ---------------------------------------------------------------- 线程/并发回归

def test_connection_usable_across_threads() -> None:
    """回归：FastAPI 把「同步依赖」与「同步端点」分别放进线程池，可能落到不同线程。

    若 connect() 没有 check_same_thread=False，就会偶发
    `SQLite objects created in a thread can only be used in that same thread`，
    表现为随机 500 —— 这正是 P3 前端联调时暴露的问题，TestClient 没能复现它。
    """
    import threading

    from app.db import connect

    con = connect()
    result: dict[str, int] = {}
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            result["n"] = con.execute("SELECT COUNT(*) FROM coin").fetchone()[0]
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            con.close()

    t = threading.Thread(target=worker)
    t.start()
    t.join(timeout=10)

    assert not errors, f"跨线程使用连接失败: {errors}"
    assert result.get("n") == EXPECTED_COINS


def test_endpoints_survive_concurrent_requests(client) -> None:
    """并发打不同接口，确保不再出现随机 500。"""
    import concurrent.futures

    paths = [
        "/api/v1/coins",
        "/api/v1/facets",
        "/api/v1/stats",
        "/api/v1/categories",
        "/api/v1/timeline",
        "/api/v1/terms",
    ] * 4

    def hit(p: str) -> int:
        return client.get(p).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(hit, paths))

    assert set(codes) == {200}, f"出现非 200 响应: {sorted(set(codes))}"
