#!/usr/bin/env python3
"""首屏性能实测：准备埋点页 → 由 PowerShell 启动 Edge 截图 → 还原。

为什么 Edge 不由本脚本启动：
    本环境下 **Python 启动的 Edge 一律挂死**（连 `data:text/html,<h1>hi</h1>`
    都超时，stdout/stderr 给 DEVNULL 也一样），而同一条命令从 PowerShell 直接跑
    秒出结果。这是 Chromium 多进程 mojo 通道在受限进程树下被拒的老问题
    （会话早期也见过 `platform_channel.cc Check failed: 拒绝访问`）。
    因此本脚本只做注入与还原，Edge 交给 PowerShell 启动。

为什么用截图而不是把数据回传：
    --dump-dom 在 Edge 155 上已失效（输出恒为空）；
    同步 XHR 跨源且在无头下会把页面挂死；
    sendBeacon 是异步的，浏览器进程可能先退出；
    在 load 里做顶层导航回传又会让 --screenshot 不再产出文件。
    截图是唯一反复验证可靠的通道，指标以大字渲染在页面上，读图即可。

关于虚拟时间：
    --virtual-time-budget 在等待网络时暂停虚拟时间，而 performance.now() 返回的
    正是虚拟时间，于是网络等待被排除。因此读到的 FCP/LCP 只反映
    「字节到达之后」的渲染耗时，需与限速服务器实测的传输耗时合并判断。

用法：
    python tools/measure_perf.py --prepare --paths "/,/coins/01-空首布" --viewport 375x667
    #  → 按提示在 PowerShell 里逐条跑 Edge 截图
    python tools/measure_perf.py --restore
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "web" / "dist"
BACKUP = ROOT / ".tmp" / "perf" / "backup"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE = ROOT / ".tmp" / "edge-profile"

INSTRUMENT = """
<script>
(function () {
  var R = {
    url: location.pathname,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    lcp: 0, cls: 0, fcp: 0, nav: {}, reqs: 0, bytes: 0, byType: {}, entries: []
  };
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { R.lcp = Math.max(R.lcp, e.startTime); });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { if (!e.hadRecentInput) R.cls += e.value; });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }
  function collect() {
    var n = performance.getEntriesByType('navigation')[0];
    if (n) {
      R.nav = {
        ttfb: Math.round(n.responseStart),
        dcl: Math.round(n.domContentLoadedEventEnd),
        load: Math.round(n.loadEventEnd || n.duration),
        responseEnd: Math.round(n.responseEnd)
      };
    }
    performance.getEntriesByType('paint').forEach(function (p) {
      if (p.name === 'first-contentful-paint') R.fcp = Math.round(p.startTime);
      if (p.name === 'first-paint') R.fp = Math.round(p.startTime);
    });
    performance.getEntriesByType('resource').forEach(function (r) {
      R.reqs++;
      R.bytes += r.encodedBodySize || 0;
      var t = r.initiatorType || 'other';
      if (!R.byType[t]) R.byType[t] = { n: 0, b: 0 };
      R.byType[t].n++; R.byType[t].b += r.encodedBodySize || 0;
      R.entries.push([r.name.replace(location.origin, '').split('?')[0],
                      Math.round(r.duration), r.encodedBodySize || 0]);
    });
    R.lcp = Math.round(R.lcp);
    R.cls = Math.round(R.cls * 1000) / 1000;
    // 双 rAF 兜底：某些情况下 paint 条目在 load 时还没生成，
    // 用"下一帧再下一帧"的时间戳作为首帧代理
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!R.fcp) R.fcp = Math.round(performance.now());
        render();
      });
    });
  }
  function render() {
    var rows = [
      ['路径', R.url],
      ['视口', R.viewport],
      ['FCP', R.fcp + ' ms' + (R.fp ? ' (first-paint ' + R.fp + ')' : '')],
      ['LCP', R.lcp + ' ms'],
      ['TTFB', (R.nav.ttfb || 0) + ' ms'],
      ['responseEnd', (R.nav.responseEnd || 0) + ' ms'],
      ['DOMContentLoaded', (R.nav.dcl || 0) + ' ms'],
      ['load', (R.nav.load || 0) + ' ms'],
      ['CLS', String(R.cls)],
      ['请求数', String(R.reqs)],
      ['传输合计', kb(R.bytes)],
      ['构成', Object.keys(R.byType).map(function (k) {
        return k + ' ' + R.byType[k].n + '个/' + kb(R.byType[k].b);
      }).join('   ')]
    ];
    var top = R.entries.slice().sort(function (a, b) { return b[2] - a[2]; }).slice(0, 6);
    var html = '<div style="font:600 20px/1.55 monospace;padding:20px;background:#fff;color:#000">' +
      rows.map(function (r) {
        return '<div><span style="display:inline-block;width:210px;color:#888">' + r[0] +
               '</span>' + r[1] + '</div>';
      }).join('') +
      '<div style="margin-top:14px;color:#888">最大的 6 个资源</div>' +
      top.map(function (e) {
        return '<div>' + e[0].slice(0, 58) + '  ' + e[1] + 'ms  ' + kb(e[2]) + '</div>';
      }).join('') +
      '</div>';
    document.documentElement.innerHTML = '<body>' + html + '</body>';
  }
  if (document.readyState === 'complete') collect();
  else window.addEventListener('load', collect);
})();
</script>
"""


def target_of(path: str) -> Path:
    return DIST / "index.html" if path == "/" else DIST / path.strip("/") / "index.html"


def backup_name(path: str) -> str:
    return (path.strip("/").replace("/", "_") or "home") + ".html"


def prepare(paths: list[str], viewport: str, base: str) -> int:
    BACKUP.mkdir(parents=True, exist_ok=True)
    outdir = ROOT / ".tmp" / "perf" / viewport.replace("x", "_")
    outdir.mkdir(parents=True, exist_ok=True)
    cmds = []
    for p in paths:
        t = target_of(p)
        if not t.is_file():
            print(f"  ✗ 找不到 {t}")
            continue
        shutil.copy2(t, BACKUP / backup_name(p))
        html = t.read_text(encoding="utf-8")
        if "</head>" not in html:
            print(f"  ✗ {p} 没有 </head>，无法注入")
            continue
        t.write_text(html.replace("</head>", INSTRUMENT + "</head>", 1), encoding="utf-8")
        shot = outdir / (backup_name(p).replace(".html", "") + ".png")
        w, h = viewport.split("x")
        cmds.append(
            {
                "path": p,
                "shot": str(shot),
                "command": (
                    f'& "{EDGE}" --headless --disable-gpu --hide-scrollbars '
                    f"--no-first-run --no-default-browser-check --disable-extensions --disable-sync "
                    f'--user-data-dir="{PROFILE}" --window-size={w},{h} '
                    f"--virtual-time-budget=20000 "
                    f'--screenshot="{shot}" "{base}{p}"'
                ),
            }
        )
        print(f"  ✓ 已注入 {p}")

    (BACKUP / "manifest.json").write_text(
        json.dumps({"paths": paths, "viewport": viewport, "base": base}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if cmds:
        print("\n[perf] 请在 PowerShell 中依次执行（Edge 必须由 PowerShell 启动）：")
        for c in cmds:
            print(f'\n& {c["command"]}\n')
    print(f"[perf] 完成后执行：python tools/measure_perf.py --restore")
    return 0


def restore() -> int:
    if not BACKUP.is_dir():
        print("[perf] 没有备份目录，无需还原")
        return 1
    n = 0
    for f in BACKUP.glob("*.html"):
        path = "/" + f.stem.replace("_", "/").replace("home", "")
        t = target_of(path if f.stem != "home" else "/")
        shutil.copy2(f, t)
        n += 1
        print(f"  ✓ 已还原 {path}")
    shutil.rmtree(BACKUP, ignore_errors=True)
    print(f"[perf] 还原 {n} 个文件")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prepare", action="store_true")
    ap.add_argument("--restore", action="store_true")
    ap.add_argument("--paths", default="/")
    ap.add_argument("--viewport", default="375x667")
    ap.add_argument("--base", default="http://127.0.0.1:4174")
    args = ap.parse_args()

    if args.restore:
        return restore()
    if args.prepare:
        return prepare([p for p in args.paths.split(",") if p.strip()], args.viewport, args.base)
    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
