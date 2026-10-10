#!/usr/bin/env python3
"""验证「数据目录只读挂载」这个生产假设。

背景：
    deploy/docker-compose.yml 把数据以**只读卷**挂进容器：
        ../services/api/content:/data:ro
        ../services/api/static:/static:ro
    当初为此把 SQLite 从 WAL 改成 DELETE 日志模式 —— WAL 模式下**读者也要写 -shm**，
    只读挂载会直接打不开库。但这个改动从未在真正的只读条件下验证过：
    如果假设不成立，线上会直接 404/500，而本地一切正常。

做法：
    把 content/ 复制一份到临时目录，用 NTFS ACL **拒绝当前用户的写入权限**，
    让它的行为等同于只读挂载，然后让真实的后端连过去跑一遍接口。

用法：
    python tools/readonly_mount_check.py --setup      # 建只读副本，打印路径
    python tools/readonly_mount_check.py --teardown   # 恢复权限并删除副本
"""

from __future__ import annotations

import argparse
import getpass
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "services" / "api" / "content"
DST = ROOT / ".tmp" / "ro-content"
STATIC_SRC = ROOT / "services" / "api" / "static"
STATIC_DST = ROOT / ".tmp" / "ro-static"

USER = f"{getpass.getuser()}"


def icacls(path: Path, *args: str) -> tuple[int, str]:
    proc = subprocess.run(
        ["icacls", str(path), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def deny_write(path: Path) -> bool:
    """拒绝当前用户对该目录及其内容的写入，但保留读取与列举。

    权限串必须用 (WD,AD) 而不是 (W,D)：
        WD = FILE_WRITE_DATA / FILE_ADD_FILE
        AD = FILE_APPEND_DATA / FILE_ADD_SUBDIRECTORY
    而 icacls 的 (W,D) 是泛化的「写 + 删」，实测会把**读取与目录列举**一起封掉
    （os.listdir 报 WinError 5，连 os.access 都仍报可写），
    那是一种过度拒绝，不是对只读挂载的忠实模拟。
    (OI)(CI) 让 ACE 继承到子项。
    """
    rc, out = icacls(path, "/deny", f"{USER}:(OI)(CI)(WD,AD)")
    if rc != 0:
        print(f"  ✗ icacls 失败: {out.strip()[:200]}")
        return False
    return True


def allow_write(path: Path) -> bool:
    rc, out = icacls(path, "/remove:d", USER)
    if rc != 0:
        print(f"  ! 移除拒绝项失败: {out.strip()[:200]}")
        return False
    return True


def force_remove(path: Path) -> None:
    """删除目录，必要时先恢复权限。

    只读 ACL 会让 shutil.rmtree 静默失败（配 ignore_errors=True 时更隐蔽），
    留下一个删不掉的残骸，下次 setup 就撞 FileExistsError。
    所以必须先移除拒绝项再删；仍失败则用 icacls /reset 把权限交还给继承。
    """
    if not path.exists():
        return
    allow_write(path)
    shutil.rmtree(path, ignore_errors=True)
    if path.exists():
        icacls(path, "/reset", "/T")
        icacls(path, "/grant", f"{USER}:(OI)(CI)F", "/T")
        shutil.rmtree(path, ignore_errors=True)
    if path.exists():
        subprocess.run(["cmd", "/c", "rd", "/s", "/q", str(path)], capture_output=True)


def setup() -> int:
    force_remove(DST)
    force_remove(STATIC_DST)

    DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SRC, DST)
    shutil.copytree(STATIC_SRC, STATIC_DST)

    db = DST / "app.db"
    if not db.is_file():
        print(f"  ✗ 找不到 {db}，先跑数据管线")
        return 1

    # 确认当前不是 WAL：只读挂载下 WAL 读者需要写 -shm，会直接打不开
    import sqlite3

    con = sqlite3.connect(db)
    mode = con.execute("PRAGMA journal_mode").fetchone()[0]
    con.close()
    print(f"  journal_mode = {mode}")
    if mode.lower() == "wal":
        print("  ✗ 仍是 WAL，只读挂载下会打不开库")
        return 1

    print("  设为只读…")
    if not deny_write(DST) or not deny_write(STATIC_DST):
        return 1

    # 自检：确认现在确实写不进去、但读得了
    probe = DST / "__write_probe.tmp"
    try:
        probe.write_text("x", encoding="utf-8")
        print("  ✗ 仍然可写，只读模拟失败（ACL 没生效）")
        allow_write(DST)
        return 1
    except PermissionError:
        print("  ✓ 已确认不可写（PermissionError）")
    try:
        listed = len(list(DST.iterdir()))
        (DST / "app.db").read_bytes()[:16]
        print(f"  ✓ 已确认仍可读取与列举（{listed} 项）")
    except Exception as exc:  # noqa: BLE001
        print(f"  ✗ 读取被误封，模拟过度：{exc}")
        allow_write(DST)
        return 1

    print(f"\n  只读数据目录: {DST}")
    print(f"  只读静态目录: {STATIC_DST}")
    print("\n  下一步：用这两个路径启动后端并跑接口，然后执行 --teardown\n")
    return 0


def teardown() -> int:
    for p in (DST, STATIC_DST):
        if p.exists():
            force_remove(p)
            print(f"  {'✓ 已删除' if not p.exists() else '✗ 删除失败'} {p}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--setup", action="store_true")
    ap.add_argument("--teardown", action="store_true")
    args = ap.parse_args()
    if args.setup:
        return setup()
    if args.teardown:
        return teardown()
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
