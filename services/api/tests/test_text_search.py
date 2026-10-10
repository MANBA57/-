"""中文分词转换函数的单元测试。

这些函数是全文检索能用的前提：FTS5 的 unicode61 会把整串中文当一个 token，
trigram 又要求查询 ≥3 字。我们的方案是把汉字逐个拆成 token，检索时拼成短语。
"""

from __future__ import annotations

import pytest

from app.text_search import deseg, seg, to_match_query


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("空首布", "空 首 布"),
        ("青铜", "青 铜"),
        ("布", "布"),
        ("", ""),
        ("战国 中期", "战 国 中 期"),
    ],
)
def test_seg_splits_cjk(raw: str, expected: str) -> None:
    assert seg(raw) == expected


def test_seg_keeps_ascii_words_intact() -> None:
    assert seg("LIBOR 利率") == "LIBOR 利 率"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("青铜", '"青 铜"'),
        ("布", '"布"'),
        ("空首布", '"空 首 布"'),
        ("LIBOR", '"LIBOR"'),
        # 连续的汉字视为一个短语（不做分词，避免引入 jieba 之类依赖）；
        # 用户想分词语义时用空格隔开即可
        ("魏国刀币", '"魏 国 刀 币"'),
        ("魏国 刀币", '"魏 国" AND "刀 币"'),
        ("TIPS 与 国债", '"TIPS" AND "与" AND "国 债"'),
    ],
)
def test_to_match_query(raw: str, expected: str) -> None:
    assert to_match_query(raw) == expected


def test_to_match_query_empty() -> None:
    assert to_match_query("") == ""
    assert to_match_query("   ") == ""
    assert to_match_query("！？，。") == ""


def test_deseg_restores_cjk_spacing() -> None:
    assert deseg("青 铜 时 代") == "青铜时代"
    assert deseg("空 首 布") == "空首布"


def test_deseg_keeps_meaningful_spaces() -> None:
    # 高亮标记与汉字之间的空格要保留，否则 snippet 会挤成一团
    assert deseg("<<青 铜>> 铸 币") == "<<青铜>> 铸币"


def test_deseg_idempotent() -> None:
    once = deseg("战 国 中 期")
    assert deseg(once) == once
