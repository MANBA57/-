#!/usr/bin/env python3
"""一条命令重跑整条数据管线：解析 → 图片 → 建库 → 门禁。

后续拿到新的钱币 docx 时，把它放进 data/ 或改 extract_docx.py 里的候选路径，
然后重跑本脚本即可，不需要改任何代码。

用法：
    python scripts/run_pipeline.py
    python scripts/run_pipeline.py --docx "C:/github/钱币数据/先秦(3).docx"
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

STEPS: list[tuple[str, list[str]]] = [
    ("解析 docx", ["extract_docx.py"]),
    ("处理图片", ["process_images.py"]),
    ("构建数据库", ["build_db.py"]),
    ("质量门禁", ["validate.py"]),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx", help="源 docx 路径，透传给 extract_docx.py")
    ap.add_argument("--skip-images", action="store_true", help="跳过耗时的图片处理（约 45 秒）")
    args, _ = ap.parse_known_args()

    py = sys.executable
    overall = time.time()

    for name, argv in STEPS:
        if args.skip_images and argv[0] == "process_images.py":
            print(f"\n===== 跳过：{name} =====")
            continue
        cmd = [py, str(HERE / argv[0]), *argv[1:]]
        if argv[0] == "extract_docx.py" and args.docx:
            cmd += ["--docx", args.docx]

        print(f"\n===== {name} =====", flush=True)
        t0 = time.time()
        rc = subprocess.call(cmd)
        dt = time.time() - t0
        if rc != 0:
            print(f"\n[管道] ✗ 「{name}」失败（exit {rc}，用时 {dt:.1f}s），已中止", flush=True)
            return rc
        print(f"[管道] ✓ 「{name}」完成（{dt:.1f}s）", flush=True)

    print(f"\n[管道] 全部完成，总用时 {time.time() - overall:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
