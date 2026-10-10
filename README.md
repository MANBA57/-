# 数字钱币库 · 先秦馆

> 全国数字媒体大学生创新大赛作品 —— 先秦四大货币体系（布币 / 刀币 / 圜钱 / 贝币）的数字化展馆。
> 前后端分离（TypeScript + Python），同一套前端用 Capacitor 打包成安卓 APK，云端部署、公开免登录。

---

## 目录结构

```
coin-museum/
├─ apps/
│  └─ web/                    React 19 + Vite 8 + TypeScript 5.9 + Tailwind 4
│     ├─ src/
│     │  ├─ pages/            首页、设计规范对照页、各功能页
│     │  ├─ components/       通用组件
│     │  ├─ api/              后端接口封装
│     │  ├─ lib/              工具函数
│     │  └─ styles/index.css  ★ 设计 token 与组件规范（唯一来源）
│     ├─ scripts/             构建期预渲染（P3）
│     └─ dist/                构建产物
├─ services/api/              Python 3.12 + FastAPI + SQLModel + SQLite(FTS5)
│  ├─ app/                    应用代码
│  ├─ scripts/                数据管线（docx → 结构化 → 建库 → 图片处理）
│  ├─ content/                生成的 JSON 与数据库
│  ├─ static/images/          压缩后的钱币图片
│  └─ tests/                  pytest
├─ tools/
│  ├─ serve-dist.py                 静态托管构建产物（绕开沙箱限制）
│  ├─ install-android-toolchain.ps1 JDK21 + Android SDK + Gradle
│  └─ build-apk.ps1                 打 APK（含中文路径 subst 规避）
├─ deploy/                    Docker Compose + Caddy
├─ docs/design-system.md      ★ 设计系统（实测 token 与规范）
└─ data/                      原始钱币数据（docx）
```

---

## 环境要求与镜像

**本机对境外 TLS 不可达**（`registry.npmjs.org` / `pypi.org` 握手超时），所有依赖必须走国内镜像：

| 用途 | 镜像 | 配置位置 |
|---|---|---|
| npm / pnpm | 腾讯云 | `.npmrc`（仓库内，自动生效） |
| pip | **阿里云**（`https://mirrors.aliyun.com/pypi/simple/`） | 安装时显式带 `-i`，见下方命令 |
| JDK | 清华 Adoptium | `tools/install-android-toolchain.ps1` |
| Gradle | 腾讯云 | 同上 |

> ⚠️ **pip 不要用清华 TUNA**。实测其 TLS 证书已过期
> （`CERTIFICATE_VERIFY_FAILED: certificate has expired`，系统时钟正常），
> 会导致安装随机失败。阿里云 / 中科大 / 华为云均已验证可用。

已验证可达：腾讯/华为 npm、阿里云/中科大/华为 PyPI、`dl.google.com`、`repo1.maven.org`、`services.gradle.org`。

### pnpm 必须用扁平布局

`pnpm-workspace.yaml` 里设了 `nodeLinker: hoisted`。原因：本机上 pnpm 默认的 isolated + junction
布局会让 Node ESM 解析不到原生二进制包（`@typescript/typescript-win32-x64`、`rolldown`、
`@tailwindcss/oxide`），报 `ERR_MODULE_NOT_FOUND`。**改回默认布局会直接构建失败。**

---

## 快速开始

### 前端

```bash
pnpm install                 # 走腾讯镜像，约 12 秒
pnpm build                   # tsc 类型检查 + vite 构建
python tools/serve-dist.py   # 静态托管 dist 并把 /api、/images 反代到后端
```

打开 <http://127.0.0.1:4173/>。预览服务器**会反代 `/api` 与 `/images`**，
所以前端用同源相对路径访问后端，构建时不需要写死后端地址 —— 同一份 `dist`
既能本地预览，也能直接交给 Caddy 托管。

`/design` 是设计规范对照页，可逐项核验配色、字级、圆角、间距与组件。

### 页面

| 路由 | 页面 | 要点 |
|---|---|---|
| `/` | 首页 | 巨型标题 + 统计数字 + **深色四大体系轮播** + 精选钱币网格 |
| `/coins` | 钱币库 | 四维筛选（体系/时期/国别/材质）+ 排序 + 分页；**筛选状态全部同步到 URL**，可直接分享 |
| `/coins/:slug` | 钱币详情 | 左信息 / 右大图；参数表只显示**有值**的字段；`?image=N` 可深链到大图查看器 |
| `/timeline` | 时间轴 | 横向滚动，按时期分列，节点挂钱币 |
| `/evolution` | 体系演化 | 手绘 SVG：**深度即行、同层兄弟横向并排**，重心排序让父子上下对齐 |
| `/terms` | 术语词典 | 服务端检索（走 FTS5），附关联钱币 |
| `/compare` | 对比 | 2~3 枚并排，**差异字段高亮** |
| `/search` | 搜索 | 输入即搜（300ms 防抖），命中词高亮 |
| `/about` | 关于 | 作品定位、数据来源与推断标注说明、技术实现 |
| `/design` | 设计规范 | 开发用对照页，不对外 |

移动端：底部 4 Tab + 搜索；顶部导航在移动端收起，只留站名与搜索。

### Service Worker 与离线

`public/sw.js` 手写（不用 Workbox —— 策略就四条，手写更透明，也省一个依赖）：

| 资源 | 策略 | 理由 |
|---|---|---|
| HTML（导航请求） | network-first，断网回退缓存 | 优先拿新版本，离线仍可打开 |
| `/assets/*` | cache-first | Vite 产物带内容哈希，永不失效 |
| `/images/*` | cache-first + 400 条 LRU 上限 | 钱币图片；约 30 MB 封顶 |
| `/api/*` | network-first，断网回退上次响应 | 数据要新，离线可读旧数据 |

仅在 `PROD` 下注册（开发时 SW 会拦请求，让 HMR 行为难预测）。
「关于」页有**一键缓存全库**按钮（对应方案里"现场演示断网"的风险项），
会逐条抓取并从 SW 侧写入缓存，带进度条。

### SEO：预渲染 + sitemap

构建时（`pnpm build` 的第三步）为 **33 条路由**各生成一份静态 HTML，
每份带独立的 `<title>` / `description` / `canonical` / OG / Twitter / JSON-LD，
外加 `<noscript>` 正文；同时产出 `sitemap.xml` 与 `robots.txt`。

**刻意没做完整 SSR**：完整 SSR 要在构建期把 React 渲染成 HTML，必须预取接口数据，
于是前端构建就依赖后端正在运行 —— 构建变脆，而本站是展馆型内容，收益有限。
现在路由元数据由数据管线的 `build_db.py` 产出（`content/generated/prerender.json`），
**前端构建完全不依赖运行时服务**。

部署时用 `SITE_ORIGIN` 指定站点源，否则 canonical 与 sitemap 会写成 `localhost`：

```bash
SITE_ORIGIN=https://coin.example.com pnpm build
```

### 图标

`python tools/make_assets.py` 一次生成网站图标、PWA manifest 图标、
**安卓自适应图标（含前景安全区）与 11 张不同密度的启动屏**。
设计是青铜绿底 + 「泉」字——纯色加大字在 48px 下仍认得出。

### 性能实测

**首选方式：DevTools Protocol**（`tools/measure_cdp.py`）。

```powershell
# Edge 必须由 PowerShell 启动（见下方说明），保持运行
Start-Process -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  -WindowStyle Hidden -ArgumentList @(
    '--headless','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--user-data-dir=.tmp\edge-cdp','--remote-debugging-port=9222',
    '--remote-allow-origins=*','about:blank')

python tools/measure_cdp.py --base http://127.0.0.1:4173 --viewport 375x667 `
  --paths "/,/coins/01-空首布,/timeline,/evolution,/terms" `
  --kbps 9000 --latency 60 --shot --json .tmp/cdp/result.json
```

CDP 一次解决了此前所有的测量难题：

| 能力 | 解决的老问题 |
|---|---|
| `Runtime.evaluate` 取回结构化 JSON | 不用再靠读截图 OCR |
| `Network.emulateNetworkConditions` | 浏览器网络栈层的**真实**限速，就是 Lighthouse 用的那套，不需要自建限速服务器 |
| `Network.setBypassServiceWorker` | SW 的 `/assets/*` cache-first 会让 407 KB 的 JS 只花 2 ms，数据完全失真 |
| `Storage.clearDataForOrigin` | 清掉上一轮遗留的 SW 注册与缓存 |
| `Emulation.setDeviceMetricsOverride` | 精确视口，不再有 `--window-size` 与布局视口不一致导致的「内容被切」假象 |
| `Page.captureScreenshot` + `captureBeyondViewport` | **整页截图**，不再只截视口 |

实测结果（移动端 375×667，4G = 9 Mbps + 60 ms RTT，5 个页面）：

| 页面 | TTFB | **FCP** | LCP | DCL | 请求数 | 传输 |
|---|---|---|---|---|---|---|
| `/` | 3 ms | **640 ms** | 640 ms | 605 ms | 6 | 452.1 KB |
| `/coins/01-空首布` | 86 ms | **668 ms** | 924 ms | 643 ms | 7 | 521.4 KB |
| `/timeline` | 80 ms | **668 ms** | 668 ms | 646 ms | 23 | 651.9 KB |
| `/evolution` | 93 ms | **708 ms** | 708 ms | 686 ms | 3 | 441.7 KB |
| `/terms` | 93 ms | **704 ms** | 704 ms | 684 ms | 3 | 440.8 KB |

全部远低于验收标准「4G 首屏 < 2s」。数据自洽：407.6 KB 的 JS ÷ 9 Mbps = 371 ms，
加 60 ms RTT 得 431 ms，实测 475–494 ms（含连接开销）。

> 两套**互相独立**的方法交叉验证过：早期用「限速服务器 + 截图读图」测得首页 FCP 664 ms，
> 现在用 CDP 测得 640 ms，吻合。

<details>
<summary>备选方式：自建限速服务器 + 截图读图（在 CDP 不可用时使用）</summary>

```bash
python tools/serve-dist.py --port 4175 --throttle-kbps 9000 --throttle-rtt-ms 60
python tools/measure_perf.py --prepare --paths "/,/coins/01-空首布" --base http://127.0.0.1:4175
#   → 按提示在 PowerShell 里跑 Edge 截图，再 read_image 读数
python tools/measure_perf.py --restore
```

限速用**按累计字节自校正**的节流，不用「每块固定睡 N 毫秒」——
Windows 的 `time.sleep` 分辨率约 15 ms，按 16 KB 分块时每块只需睡 14.6 ms，
会被逐块向上取整累积成约 20% 误差（实测 7191 kbps vs 目标 9000）。

这套方式的踩坑记录（也是当初转向 CDP 的原因）：

| 尝试 | 结果 |
|---|---|
| `--dump-dom` 取数据 | **在 Edge 155 上已失效**，输出恒为空 |
| 页面用同步 XHR 回传 | 跨源且在无头下**把页面挂死**（实测卡住 90 秒） |
| `sendBeacon` 回传 | 异步，浏览器进程可能先退出 |
| 在 load 里顶层导航回传 | 导航导致 `--screenshot` **不再产出文件** |
| 加 `--virtual-time-budget` | 虚拟时间在等待网络时暂停，会低估网络耗时 |

</details>

**两条铁律**（本会话反复踩到）：

1. **Edge 必须由 PowerShell 启动，不能由 Python 启动。** Python 起的 Edge 即便
   WebSocket 能连上，CDP 命令也永远不响应（`Page.enable` 直接超时），
   连 `data:text/html,<h1>hi</h1>` 都打不开；同一条命令从 PowerShell 执行则一切正常。
   这是 Chromium 多进程 mojo 通道在受限进程树下的老问题。
2. **不要用全新的 `--user-data-dir`。** 实测新目录下 Edge 起不来；
   用已初始化过的目录（如 `.tmp/edge-cdp`）。

依赖：`websocket-client`（仅测量工具用，不在运行期依赖里）：

```bash
pip install -i https://mirrors.aliyun.com/pypi/simple/ websocket-client
```

### 后端

```bash
cd services/api
# 首次：创建 venv 并安装依赖（venv 创建与 pip 都需要非受限会话，见下方"已知限制"）
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt \
    -i https://mirrors.aliyun.com/pypi/simple/

# 启动
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

健康检查：<http://127.0.0.1:8000/api/v1/health>
接口文档：<http://127.0.0.1:8000/api/docs>

### API 一览（全部公开只读，前缀 `/api/v1`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 存活探针 + 数据就绪状态 |
| GET | `/coins` | 列表：`category` `period` `state` `material` `q` `sort` `page` `page_size` |
| GET | `/coins/{slug}` | 详情（图片、参数、相关钱币、字段来源标注） |
| GET | `/coins/compare?slugs=a,b` | 并排对比 2~3 枚 |
| GET | `/facets` | 各维度可选值与计数，驱动筛选面板 |
| GET | `/categories` | 四大货币体系（含导语与导语来源） |
| GET | `/timeline` | 按时期分组的时间轴 |
| GET | `/evolution` | 货币体系演化关系图（节点 + 边） |
| GET | `/terms?q=` | 术语词典，附关联钱币 |
| GET | `/search?q=&type=&limit=` | 全文检索（钱币 + 术语），带高亮片段 |
| GET | `/stats` | 首页统计数字 |

**刻意没用 SQLModel。** 库里是手工调过的 schema（FTS5 虚表 + 维度拆表），ORM 在这些
结构上只会碍事；改成裸 SQL + Pydantic 响应模型，更直白也更快。

安全与健壮性：连接建立后立刻 `PRAGMA query_only = ON`（只读，写错也改不了数据）；
API 走内存令牌桶限流（默认 20 req/s/IP，可用 `COIN_RATE_LIMIT` 调整）；
数据库缺失时返回 503 并给出「请先跑管线」的指引，而不是 500 堆栈。

### 测试

```bash
cd services/api
.venv/Scripts/python.exe -m pytest      # 65 项，覆盖接口契约 + 分词 + 限流
```

---

## 数据管线

一条命令重跑全流程（约 46 秒，其中图片压缩占 45 秒）：

```bash
cd services/api
.venv/Scripts/python.exe scripts/run_pipeline.py
```

四个步骤：

| 脚本 | 作用 | 输出 |
|---|---|---|
| `extract_docx.py` | 解析 docx：按编号切类别/条目，图片归属，正则抽取结构化字段 | `content/generated/raw.json` + `report.json` |
| `process_images.py` | 图片去重（sha256）、EXIF 旋转、剥元数据、输出 AVIF+WebP 双格式与 LQIP | `static/images/**` + `images.json` |
| `build_db.py` | 装配 SQLite（含 FTS5 全文索引）与人工校对表 | `content/app.db` + `content/review/coins.csv` |
| `validate.py` | 质量门禁，不通过则不允许部署 | 退出码 |

### 拿到新数据后怎么加

把新的 docx 放进 `data/`，或直接指定路径：

```bash
.venv/Scripts/python.exe scripts/run_pipeline.py --docx "C:/github/钱币数据/先秦(3).docx"
```

**不需要改任何代码**（`dynasty` 字段已预留其他朝代）。

### 字段来源标注

时期字段带 `period_source`，三档含义不同，前端应区别展示：

| 取值 | 含义 | 当前条数 |
|---|---|---|
| `auto` | 原文明确写了时期（如「战国中晚期魏国铸造」） | 15 |
| `inferred` | 原文只写「战国」这类泛称，或由公元前年份反推 | 8 |
| `editor` | 原文完全没提，由编辑在 `content/overrides/coin_fields.json` 补充 | 4 |

同样地，每条钱币还带 `overridden_fields`，记录哪些字段被人为改写。

**类别导语**也有 `intro_source`（`auto` / `editor`）：「贝币与原始货币类」在原文里
标题后面直接就是第一条钱币，没有导语段落，由 `content/overrides/category_intro.json`
按原文第 26 条内容补写，标为 `editor`。

### 中文全文检索

FTS5 内置分词器对中文都不好用：`unicode61` 会把一整串中文当成**单个 token**，
`trigram` 又要求**查询至少 3 个字**（「刀币」「青铜」这类双字词直接搜不到）。
本项目的做法见 `app/text_search.py`：**索引时把汉字逐个拆成 token**，检索时把
「青铜」拼成短语 `"青 铜"`。于是 1 字、2 字、任意长度的中文查询都能命中。

---

## 已知环境限制（DSH 沙箱）

项目开发过程中本会话先后处于 **workspace-write 受限模式**与**完全访问模式**。
下表的问题在受限模式下全部出现、在完全访问下全部消失，根因是同一个。
项目里的绕行措施**保留了下来**（而非删掉），因为它们让工具链自包含、可整体搬走，
换机器或交给评委复现时更省事。

| # | 现象 | 根因 | 绕行 |
|---|---|---|---|
| 1 | 无法写入工作区外的路径（如 `C:\github`） | 沙箱限制写入根 | 项目建在工作区内；或切到完全访问 |
| 2 | `vite build` / `vite dev` 抛 `spawn EPERM` | Vite 在 Windows 下调用 `child_process.exec("net use")` 探测网络驱动器，该调用**没有 try 包裹**（`node_modules/vite/dist/node/chunks/node.js:2481`），受限沙箱禁止子进程管道 | 在完全访问会话中执行；或用 `python tools/serve-dist.py` 托管已构建产物 |
| 3 | `python -m venv` 报 `ensurepip` 失败；`pip install` 报 `PermissionError [WinError 5]` | 受限沙箱拦截 `chmod`，`tempfile._resetperms` 失败 | 在完全访问会话中执行安装类命令 |
| 4 | Edge / Chrome 无头模式报 `mojo platform_channel: 拒绝访问` | Chromium 多进程依赖命名管道 | 截图验证在完全访问会话中执行 |
| 5 | pytest 报 `PytestCacheWarning: could not create cache path` | 同上，pytest 写缓存目录要 chmod | `pytest.ini` 已加 `-p no:cacheprovider` |

**结论**：涉及构建、安装、打包的命令请在完全访问模式下运行；日常看页面用
`tools/serve-dist.py` 即可，无需提权。

---

## 阶段进度

- [x] **P0** 脚手架 + 设计系统（前端可构建、设计规范对照页、后端骨架、安卓工具链脚本）
- [x] **P1** 数据管线：docx → 结构化字段 → 图片压缩（AVIF/WebP）→ SQLite + FTS5
      （27 条钱币 / 4 大体系 / 48 张图 81.9 MB→7.1 MB / 中文全文检索可用）
- [x] **P2** 后端 API：11 个只读接口 + FTS5 全文检索 + 限流 + CORS；`pytest` 65 项全绿
- [x] **P3** 前端展馆：9 个页面 + 移动端适配 + 设计系统落地；Service Worker 离线、PWA manifest、33 条路由预渲染 + sitemap
- [x] **P4** Capacitor 安卓打包：debug 包 4.29 MB / 签名 release 包 3.09 MB，签名指纹已核对
      （含青铜绿自适应图标、启动屏、Service Worker 与 33 条预渲染路由）
- [x] **P5** 云端部署编排：Docker Compose + Caddy + 部署脚本；**用同一份 Caddyfile 在本机验证了完整生产拓扑（15/15 通过）**
- [ ] **上线**：等你提供服务器与域名（国内主机需先完成 ICP 备案）

> **P5 的边界**：编排、脚本、配置与本地拓扑验证都已完成且通过；
> **真正部署到云端服务器未执行**，因为没有服务器与域名。拿到服务器后按
> [`deploy/README.md`](deploy/README.md) 跑一条命令即可。

---

## 部署

完整手册见 [`deploy/README.md`](deploy/README.md)。要点：

```bash
# 本机验证生产拓扑（用与 compose 相同的 Caddyfile，不需要服务器）
python deploy/verify_local.py
```

```powershell
# 部署到服务器
& deploy/deploy.ps1 -Server root@1.2.3.4 -SiteAddress ':8443'      # 未备案：非标端口
& deploy/deploy.ps1 -Server root@coin.example.com -SiteAddress 'coin.example.com'  # 已备案：自动 HTTPS
```

拓扑：Caddy 托管前端静态产物与 `/images`，并把 `/api/*` 反代到不对外暴露端口的
FastAPI 容器；`app.db` 与图片以**只读卷**挂载，补数据不必重建镜像。

### 只读挂载已验证

生产把数据以只读卷挂进容器，这是条**本地测不出来**的假设——本地数据目录永远可写。
用 NTFS ACL 把数据目录设为不可写后跑了一遍真实接口：

```bash
python tools/readonly_mount_check.py --setup      # 复制数据并设为不可写
python tools/readonly_api_smoke.py                # 11 个接口 + 图片
python tools/readonly_mount_check.py --teardown   # 恢复权限并清理
```

结果：**11 个接口 + 图片全部 200**。

顺带纠正一个我一开始的错误判断：`sqlite3.connect()` 默认以读写方式打开，
我原以为只读挂载下会直接打不开库，并把 `db.py` 改成了 `mode=ro`。
实测发现 **SQLite 对写保护文件会自动回退为只读**（官方文档：
"reading only if the file is write protected by the operating system"），
所以旧写法其实也能跑。`mode=ro` 保留了下来，但理由是「把只读写成显式意图、
不依赖一条容易被忽略的回退规则」，而不是「修了一个不存在的 bug」。

> 顺带一提，第一次测出「打不开库」是因为我用的 ACL 权限串 `(W,D)` 把**读取**也封了
> （`os.listdir` 直接 WinError 5），那是过度拒绝、不是只读挂载。
> 正确的最小权限串是 `(WD,AD)`：能读能列、不能写。

---

## 安卓打包

### 一次性安装工具链（约 480 MB，全部走已验证可达的镜像）

```bash
python tools/install_android_toolchain.py
```

装到项目内 `.toolchain/`，**不改系统环境变量**：

| 组件 | 版本 | 来源 |
|---|---|---|
| JDK | Temurin 21.0.12.1+1 | 清华 Adoptium 镜像 |
| Android SDK | cmdline-tools + platform-35 + build-tools 35.0.0 + platform-tools | dl.google.com |
| Gradle | 8.11.1 | 腾讯云镜像 |

### 打包

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& tools/build-apk.ps1 -Mode debug -ApiBase 'http://<开发机局域网IP>:8000'
& tools/build-apk.ps1 -Mode release
```

产物：`apps/web/android/app/build/outputs/apk/{debug,release}/`。

> **脚本里两个容易踩的坑**（都已修，改脚本时别改回去）：
>
> 1. **调用原生命令必须包一层 `Invoke-Native`**。原生命令只要往 stderr 写东西，
>    在 `$ErrorActionPreference='Stop'` 下就会被提升成终止性错误；而 pnpm 每次都会
>    把命令行回显到 stderr，于是脚本会在构建**成功**的情况下中断。
>    `$PSNativeCommandUseErrorActionPreference` 管不了这个（它只管非零退出码）。
> 2. **`Invoke-Native` 里必须 `| Out-Host`**。PowerShell 函数会把写进成功流的内容
>    全部当作返回值，直接 `& $Exe @Args` 会让调用方拿到的 `$rc` 变成
>    「整段构建输出 + 退出码」的数组，于是 `$rc -ne 0` 永远成立，
>    构建明明成功也被判为失败。

### 工具链自包含（都是被沙箱逼出来的，但在别的机器上同样有用）

以下四个位置默认都落在工作区之外，本项目全部挪进了 `.toolchain/`：

| 环境变量 | 默认位置 | 挪到 | 不挪会怎样 |
|---|---|---|---|
| `GRADLE_USER_HOME` | `%USERPROFILE%\.gradle` | `.toolchain/gradle-home` | 报 `Could not create parent directory for lock file` |
| `ANDROID_USER_HOME` | `%USERPROFILE%\.android` | `.toolchain/android-home` | sdkmanager 报 `NoSuchFileException: ...\.android\cache\sdkbin-...`（看着像网络错误，其实是被拒写） |
| `TEMP` / `TMP` | `%LOCALAPPDATA%\Temp` | `.toolchain/tmp` | AGP 报 `AccessDeniedException: ...\Temp\tempdir_<n>` |
| `subst X:` | — | 项目根目录 | Gradle / aapt2 遇到中文路径可能出问题 |

另外 `local.properties` 里的 SDK 路径含中文，已按 **Java Properties 规范转义成 `\uXXXX`**
（该文件按 ISO-8859-1 读取，直接写中文会读错）。

### 签名

`apps/web/android/keystore.properties` 与 `keystore/*.jks` **都不入库**。

> ⚠️ **这两个文件必须单独备份。** 丢了密钥库或口令就无法对已发布的 APK 做覆盖升级，
> 只能换包名重新发布。口令在 `keystore.properties` 里，本项目的口令是随机生成的。

验证签名：

```powershell
& .toolchain/android-sdk/build-tools/35.0.0/apksigner.bat verify --print-certs <apk>
```

### 真机安装（P4 未验证项）

本机没有连接安卓设备，**真机安装与联网未经验证**。插上手机开启 USB 调试后：

```powershell
& .toolchain/android-sdk/platform-tools/adb.exe install -r `
    apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

联调时后端要监听 `0.0.0.0`（不是 `127.0.0.1`）：

```bash
.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

APK 里的 API 地址**在打包时注入**（WebView 里相对路径会解析到不存在的 `https://localhost`）：

```powershell
& tools/build-apk.ps1 -Mode debug -ApiBase 'http://<开发机局域网IP>:8000'
```

并把该 IP 加进 `apps/web/android/app/src/debug/res/xml/network_security_config.xml`
（仅调试包放行明文，release 包仍是 HTTPS-only）。

---

## 怎么验证前端真的渲染对了

不能只看「构建成功」。本项目用系统自带的 Edge 做无头渲染截图：

```powershell
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
& $edge --headless --disable-gpu --hide-scrollbars --virtual-time-budget=20000 `
  --window-size=1440,1500 --screenshot=out.png 'http://127.0.0.1:4173/coins'
```

注意两点：

1. `--virtual-time-budget` 是**虚拟**时间，不等真实网络。图片较大时要给足预算，
   否则会截到 LQIP 占位还没被真图替换的瞬间（曾据此误判为 bug）。
2. 判断移动端是否横向溢出，**不要靠看截图**。`--window-size` 的布局视口与截图宽度
   可能不一致，会造成「内容被切」的假象。可靠做法是页面内探针：

```html
<!-- 探针页：把测量结果渲染成页面上的大字，再截图读取 -->
<pre id="out" style="font:14px monospace">loading…</pre>
<iframe id="f" src="/coins" style="width:390px;height:1400px"></iframe>
<script>
  f.onload = () => setTimeout(() => {
    const d = f.contentDocument
    const de = d.documentElement
    const bad = [...d.querySelectorAll('body *')]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(x => x.r.right > 391 && x.r.width > 0)
      .sort((a, b) => b.r.right - a.r.right).slice(0, 8)
      .map(x => `${x.el.tagName}.${String(x.el.className||'').slice(0,44)} right=${Math.round(x.r.right)}`)
    out.textContent = `scrollWidth=${de.scrollWidth} clientWidth=${de.clientWidth}\n` + bad.join('\n')
  }, 3000)
</script>
```

**结果必须截图读取，不能写进 `document.title` 再取**：`--dump-dom` 在 Edge 155 上
已失效（输出恒为空）。同理，不要指望把数据回传到本地端口——同步 XHR 在无头下会把
页面挂死。完整踩坑清单见上文「性能实测」。

Edge 无头模式依赖命名管道（Mojo IPC），**在受限沙箱下无法启动**，需在非受限会话中执行。
另外：**Edge 必须由 PowerShell 启动，不能由 Python 启动**（Python 起的 Edge 一律挂死，
连 `data:` URL 都超时）；且不能使用全新的 `--user-data-dir`。

---

## 设计系统

见 [`docs/design-system.md`](docs/design-system.md)。核心铁律：

1. 零阴影、零渐变
2. 全站仅 1 个高饱和色 `#0071e3`
3. 层次只靠「圆角 + 1px 发丝线 + 底色差」
4. 层级靠极端字号差（主标题 : 正文 ≈ 7 : 1）

所有数值均为参考截图的**像素实测值**，不是目测。

---

## 数据来源

`先秦(2).docx`（85.9 MB）。实测：正文仅 103 KB / 124 段，48 张图占 81.9 MB，解析出
**27 条钱币、4 大体系**。原文开头写「35 种」，实际正文只到 27 条，「二、刀币类」序号漏写
—— 属未完成稿，后续批次补齐后重跑管线即可。

已知数据缺口（由 `validate.py` 每次自动报告）：

| 缺口 | 影响条目 | 处理 |
|---|---|---|
| 原文未写时期 | 三孔布、尖首刀、齐大刀、蚁鼻钱 | 已在覆盖层补，标记 `period_source=editor` |
| 原文无配图 | 明四 | 待补图；前端详情页需处理无图情况 |
| 仅写「战国」未细分 | 8 条 | 按战国中期归档，标记 `period_source=inferred` |
| 原文未给尺寸/重量 | 24 条无直径、24 条无通长、22 条无重量 | 前端只展示有值的字段，不留空白项 |
