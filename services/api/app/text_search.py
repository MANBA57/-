"""中文友好的 FTS5 检索辅助。

背景：FTS5 内置分词器对中文都不好用。
  - unicode61：把一整串中文当成**单个 token**，「空首布展馆」搜不到「空首布」
  - trigram：按三字滑窗建索引，**查询必须 ≥3 个字**，「刀币」「青铜」这类
    双字词直接搜不到 —— 而中文用户的双字查询是常态

这里的做法：**索引时把 CJK 字符逐个拆成 token**，检索时把「青铜」拼成短语
查询 `"青 铜"`。于是 1 字、2 字、任意长度的中文子串查询都能命中，同时仍然
享受 FTS5 的相关度排序与 snippet 高亮。

ASCII（如 LIBOR、TIPS）不受影响，按整词处理。
"""

from __future__ import annotations

import re

CJK = r"\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
_CJK_RUN = re.compile(f"[{CJK}]+")
_ASCII_RUN = re.compile(r"[A-Za-z0-9]+")
# snippet 里被我们插入的「汉字之间的空格」，输出前要还原
_CJK_SPACE = re.compile(f"(?<=[{CJK}])\\s+(?=[{CJK}])")


def seg(text: str) -> str:
    """把文本转成「汉字之间带空格」的形式，供 FTS5 索引。"""
    if not text:
        return ""
    out: list[str] = []
    for ch in text:
        if re.match(f"[{CJK}]", ch):
            out.append(f" {ch} ")
        else:
            out.append(ch)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def to_match_query(query: str) -> str:
    """把用户输入转成 FTS5 MATCH 表达式。

    汉字串 → 字符短语（"青 铜"），ASCII 串 → 整词短语（"LIBOR"），
    多个片段之间用 AND 连接。返回空串表示无法构造查询。
    """
    q = (query or "").strip()
    if not q:
        return ""
    parts: list[str] = []
    for run in re.findall(f"[{CJK}]+|[A-Za-z0-9]+", q):
        if _CJK_RUN.fullmatch(run):
            parts.append('"' + " ".join(run) + '"')
        elif _ASCII_RUN.fullmatch(run):
            parts.append('"' + run + '"')
    return " AND ".join(parts)


def deseg(text: str) -> str:
    """把 snippet/高亮结果里汉字之间的多余空格去掉。"""
    if not text:
        return ""
    prev = None
    while prev != text:
        prev = text
        text = _CJK_SPACE.sub("", text)
    return text
