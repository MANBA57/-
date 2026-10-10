#!/usr/bin/env python3
"""基于 DevTools Protocol 的首屏性能实测与整页截图。

为什么改用 CDP（而不是此前的 --screenshot + 人工读图）：
    此前那套是被逼出来的：--dump-dom 在 Edge 155 上失效、同步 XHR 回传会把页面挂死、
    sendBeacon 异步不可靠、在 load 里做顶层导航又会让截图不产出。最后只能把指标
    渲染成页面大字再靠人眼读图，既慢又容易读错。

    CDP 一次解决全部问题：
      - Runtime.evaluate 直接取回结构化 JSON，不用 OCR；
      - Network.emulateNetworkConditions 是浏览器网络栈层的真实限速，
        就是 Lighthouse 用的那一套，不需要自建限速服务器；
      - Network.setCacheDisabled 排除 HTTP 缓存与 Service Worker 污染；
      - Emulation.setDeviceMetricsOverride 给出精确视口，
        不会再出现 --window-size 与布局视口不一致导致的「内容被切」假象；
      - Page.captureScreenshot + captureBeyondViewport 支持整页截图。

关于进程：
    Edge 由本脚本以 Popen 启动并**保持运行**（CDP 要求进程存活），不使用
    subprocess.run —— 那会等进程退出，对常驻浏览器必然超时。

前置：
    Edge 需带 --remote-debugging-port 启动；本脚本可自己起，也可连已有的实例。

用法：
    python tools/measure_cdp.py --base http://127.0.0.1:4173 --viewport 375x667 \
        --paths "/,/coins/01-空首布,/timeline" --outdir .tmp/cdp
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

# 页面脚本执行前注入：观察 LCP 与布局偏移。
# 必须用 addScriptToEvaluateOnNewDocument 提前注入，否则 LCP 观察者会错过早期候选。
OBSERVER_JS = """
window.__perf = { lcp: 0, cls: 0, lcpEl: '' };
try {
  new PerformanceObserver(function (list) {
    var es = list.getEntries();
    var last = es[es.length - 1];
    if (last) {
      window.__perf.lcp = last.startTime;
      window.__perf.lcpEl = (last.element && last.element.tagName) || '';
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(function (list) {
    list.getEntries().forEach(function (e) {
      if (!e.hadRecentInput) window.__perf.cls += e.value;
    });
  }).observe({ type: 'layout-shift', buffered: true });
} catch (e) {}
"""

COLLECT_JS = """
(function () {
  var p = window.__perf || {};
  var n = performance.getEntriesByType('navigation')[0] || {};
  var paints = {};
  performance.getEntriesByType('paint').forEach(function (e) { paints[e.name] = e.startTime; });
  var res = performance.getEntriesByType('resource').map(function (r) {
    return {
      url: r.name.replace(location.origin, '').split('?')[0],
      ms: Math.round(r.duration),
      bytes: r.encodedBodySize || 0,
      type: r.initiatorType || 'other',
      start: Math.round(r.startTime)
    };
  });
  var by = {};
  res.forEach(function (r) {
    by[r.type] = by[r.type] || { n: 0, b: 0 };
    by[r.type].n++; by[r.type].b += r.bytes;
  });
  return JSON.stringify({
    url: location.pathname,
    title: document.title,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    ttfb: Math.round(n.responseStart || 0),
    responseEnd: Math.round(n.responseEnd || 0),
    dcl: Math.round(n.domContentLoadedEventEnd || 0),
    load: Math.round(n.loadEventEnd || 0),
    fcp: Math.round(paints['first-contentful-paint'] || 0),
    fp: Math.round(paints['first-paint'] || 0),
    lcp: Math.round(p.lcp || 0),
    lcpEl: p.lcpEl || '',
    cls: Math.round((p.cls || 0) * 1000) / 1000,
    requests: res.length,
    bytes: res.reduce(function (a, r) { return a + r.bytes; }, 0),
    byType: by,
    slowest: res.sort(function (a, b) { return b.bytes - a.bytes; }).slice(0, 6)
  });
})()
"""


class CDP:
    """极简 DevTools Protocol 客户端（够用即可）。"""

    def __init__(self, ws_url: str) -> None:
        import websocket  # 延迟导入，未连接时不必依赖

        self.ws = websocket.create_connection(ws_url, timeout=60, max_size=64 * 1024 * 1024)
        self._id = 0

    def send(self, method: str, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def wait_event(self, name: str, timeout: float = 60.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                self.ws.settimeout(max(0.5, deadline - time.monotonic()))
                msg = json.loads(self.ws.recv())
            except Exception:  # noqa: BLE001
                break
            if msg.get("method") == name:
                return msg.get("params", {})
        return {}

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:  # noqa: BLE001
            pass


def http_json(url: str, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        body = r.read().decode("utf-8", "ignore")
    return json.loads(body) if body.strip() else None


def require_edge(port: int, profile: Path) -> None:
    """要求已有一个带调试端口的 Edge 实例。

    本脚本**不自己启动 Edge**：实测由 Python 启动的 Edge 即便 WebSocket 能连上，
    命令也永远不响应（`Page.enable` 直接超时）；而同一条启动命令从 PowerShell 执行
    则一切正常。这是 Chromium 多进程 mojo 通道在受限进程树下的老问题，
    本会话中已多次遇到。因此 Edge 必须由 PowerShell 启动，本脚本只负责连接与测量。
    """
    try:
        v = http_json(f"http://127.0.0.1:{port}/json/version")
        print(f"[cdp] 已连接 {v.get('Browser')}（协议 {v.get('Protocol-Version')}）")
        return
    except Exception as exc:  # noqa: BLE001
        print(f"[cdp] ✗ 端口 {port} 上没有可用的调试实例：{exc}")
        print("\n请先在 PowerShell 中启动 Edge（保持运行）：\n")
        print(
            f'  Start-Process -FilePath "{EDGE}" -WindowStyle Hidden -ArgumentList @(\n'
            f"    '--headless','--disable-gpu','--no-first-run','--no-default-browser-check',\n"
            f"    '--user-data-dir={profile}','--remote-debugging-port={port}',\n"
            f"    '--remote-allow-origins=*','about:blank')\n"
        )
        raise SystemExit(2)


def human(n: float) -> str:
    return f"{n/1024:.1f} KB" if n < 1024 * 1024 else f"{n/1024/1024:.2f} MB"


def measure_one(cdp: CDP, url: str, viewport: str, latency: int, kbps: int, settle: float) -> dict:
    w, h = (int(x) for x in viewport.split("x"))

    cdp.send("Page.enable")
    cdp.send("Network.enable")
    cdp.send("Runtime.enable")

    # 精确视口：不再有 --window-size 与布局视口不一致的问题
    cdp.send(
        "Emulation.setDeviceMetricsOverride",
        width=w,
        height=h,
        deviceScaleFactor=2,
        mobile=True,
    )
    # 关掉缓存与 Service Worker 干扰。
    # setCacheDisabled 只管 HTTP 缓存，管不到 SW 的 Cache Storage ——
    # 不显式绕过 SW 的话，首屏之后的所有页面都会被 /assets/* 的 cache-first
    # 命中，407 KB 的 JS 只花 2 ms，测出来的数完全失真。
    cdp.send("Network.setCacheDisabled", cacheDisabled=True)
    cdp.send("Network.setBypassServiceWorker", bypass=True)
    if kbps:
        cdp.send(
            "Network.emulateNetworkConditions",
            offline=False,
            latency=latency,
            downloadThroughput=kbps * 1000 / 8,
            uploadThroughput=kbps * 1000 / 8,
        )
    else:
        cdp.send(
            "Network.emulateNetworkConditions",
            offline=False,
            latency=0,
            downloadThroughput=-1,
            uploadThroughput=-1,
        )

    cdp.send("Page.addScriptToEvaluateOnNewDocument", source=OBSERVER_JS)

    cdp.send("Page.navigate", url=url)
    cdp.wait_event("Page.loadEventFired", timeout=90)
    # 等 LCP 稳定（Lighthouse 同样需要静置窗口）
    time.sleep(settle)

    result = cdp.send(
        "Runtime.evaluate", expression=COLLECT_JS, returnByValue=True, awaitPromise=False
    )
    raw = result.get("result", {}).get("value")
    return json.loads(raw) if raw else {"error": "取不到指标"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:4173")
    ap.add_argument("--viewport", default="375x667")
    ap.add_argument("--paths", default="/")
    ap.add_argument("--outdir", default="")
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--latency", type=int, default=60, help="RTT 毫秒")
    ap.add_argument("--kbps", type=int, default=9000, help="下行 kbps；0 表示不限速")
    ap.add_argument("--settle", type=float, default=2.5, help="load 后静置秒数，等 LCP 稳定")
    ap.add_argument("--shot", action="store_true", help="同时输出整页截图")
    ap.add_argument("--json", default="", help="把结果写入该 JSON 文件")
    args = ap.parse_args()

    outdir = Path(args.outdir) if args.outdir else ROOT / ".tmp" / "cdp"
    outdir.mkdir(parents=True, exist_ok=True)

    require_edge(args.port, ROOT / ".tmp" / "edge-cdp")
    try:
        targets = http_json(f"http://127.0.0.1:{args.port}/json/list")
        page = next((t for t in targets if t.get("type") == "page"), None)
        if not page:
            print("[cdp] 没有可用的页面目标")
            return 1
        cdp = CDP(page["webSocketDebuggerUrl"])
    except Exception as exc:  # noqa: BLE001
        print(f"[cdp] 连接失败: {exc}")
        return 1

    # 每次测量前清掉该源的存储，避免上一轮遗留的 SW 注册与缓存影响本轮
    origin = args.base.rstrip("/")
    try:
        cdp.send("Storage.clearDataForOrigin", origin=origin, storageTypes="all")
        print(f"[cdp] 已清理 {origin} 的存储（SW 注册与缓存）")
    except Exception as exc:  # noqa: BLE001
        print(f"[cdp] 清理存储失败（继续）: {exc}")

    net = "不限速" if not args.kbps else f"{args.kbps} kbps + {args.latency} ms RTT"
    print(f"[cdp] {args.base}  视口 {args.viewport}  网络 {net}")
    print(f"[cdp] {'路径':<24}{'TTFB':>7}{'FCP':>8}{'LCP':>8}{'DCL':>8}{'请求':>6}{'传输':>11}")
    print("-" * 74)

    results = []
    try:
        for p in args.paths.split(","):
            p = p.strip()
            if not p:
                continue
            r = measure_one(cdp, args.base + p, args.viewport, args.latency, args.kbps, args.settle)
            results.append(r)
            if "error" in r:
                print(f"  {p:<22}{r['error']}")
                continue
            print(
                f"  {p:<22}{r['ttfb']:>6}ms{r['fcp']:>7}ms{r['lcp']:>7}ms"
                f"{r['dcl']:>7}ms{r['requests']:>6}{human(r['bytes']):>11}"
            )

            if args.shot:
                name = (p.strip("/").replace("/", "_") or "home") + ".png"
                shot = cdp.send("Page.captureScreenshot", format="png", captureBeyondViewport=True)
                data = shot.get("data")
                if data:
                    (outdir / name).write_bytes(base64.b64decode(data))
    finally:
        cdp.close()

    ok = [r for r in results if "error" not in r]
    if not ok:
        print("\n[cdp] ✗ 没有取到任何数据")
        return 1

    print("\n[cdp] 明细")
    for r in ok:
        print(f"  {r['url']}   {r['title'][:40]}")
        print(f"    构成 " + "  ".join(f"{k} {v['n']}个/{human(v['b'])}" for k, v in sorted(r["byType"].items(), key=lambda kv: -kv[1]["b"])))
        for s in r["slowest"][:4]:
            print(f"    {s['ms']:>5}ms {human(s['bytes']):>10}  {s['url'][:56]}")
        print(f"    LCP 元素 {r['lcpEl'] or '—'}   CLS {r['cls']}")

    if args.json:
        Path(args.json).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[cdp] 结果已写入 {args.json}")

    worst = max(r["fcp"] for r in ok)
    print(f"\n[cdp] 最慢页面 FCP = {worst} ms")
    print(f"[cdp] {'✓' if worst < 2000 else '✗'} 验收标准「4G 首屏 < 2000ms」")
    return 0 if worst < 2000 else 1


if __name__ == "__main__":
    sys.exit(main())
