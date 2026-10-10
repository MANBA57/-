# 部署手册

## 0. 先明确三件事

| 事项 | 说明 |
|---|---|
| **ICP 备案** | 国内主机用 80/443 对外提供网站**必须先备案**（数周，非技术流程）。没备案就只能用非标端口，如 `:8443`。 |
| **Docker Hub 可达性** | 国内服务器常常拉不到 `caddy:2-alpine`。见 §2 的镜像加速。 |
| **数据从哪来** | `app.db` 与图片由数据管线生成，**不打进镜像**，以只读卷挂载。补数据只需重新同步 + restart。 |

## 1. 本机先验证（不需要服务器）

```bash
# 1) 跑数据管线（生成 app.db 与压缩后的图片）
python services/api/scripts/run_pipeline.py

# 2) 构建前端（同源相对路径，不要注入 VITE_API_BASE）
pnpm build

# 3) 起后端
cd services/api && .venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4) 用真实的 Caddyfile 验证生产拓扑
python deploy/verify_local.py
```

第 4 步会下载好的 Caddy 二进制起一个临时实例，用**和 docker compose 完全相同的
`deploy/Caddyfile`** 检查 15 项：SPA 回退、`/api` 反代、`/images` 托管与 MIME、
各类缓存头、安全头、gzip、404 处理。全部通过再上服务器，能省掉大量来回。

Caddy 二进制（约 50 MB）：

```bash
python -c "import urllib.request as u,pathlib; p=pathlib.Path('.toolchain/caddy/caddy.exe'); p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(u.urlopen('https://caddyserver.com/api/download?os=windows&arch=amd64').read())"
```

## 2. 服务器准备

推荐：国内轻量应用服务器（腾讯云 / 阿里云），Ubuntu 22.04，**2C2G 起**
（镜像里要装 Python 依赖、Caddy 要跑 TLS，1G 会紧张）。

```bash
# 安装 Docker（官方脚本；若拉不动改用发行版自带包）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # 重新登录生效

# 国内服务器：配镜像加速，否则拉不到 caddy 镜像
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com"
  ]
}
EOF
sudo systemctl restart docker
docker pull caddy:2-alpine        # 先单独试一下能不能拉动
```

> 镜像加速地址会失效，上面两个只是常见候选。拉不动时先 `docker pull hello-world`
> 判断是不是整体不通，再换地址。

## 3. 一键部署

在**本机**项目根目录：

```powershell
# 只有 IP、还没备案：用非标端口
& deploy/deploy.ps1 -Server root@1.2.3.4 -SiteAddress ':8443'

# 已备案且域名解析到该服务器：Caddy 自动签发并续期证书
& deploy/deploy.ps1 -Server root@coin.example.com -SiteAddress 'coin.example.com'
```

脚本做六件事：跑数据管线 → 构建前端 → 打包（7 MB 左右）→ scp →
远端生成 `deploy/.env` → `docker compose up -d --build`。

已有数据不想重跑管线时加 `-SkipPipeline`；只想更新代码不动数据时加
`-SkipPipeline -SkipWebBuild`。

## 4. 域名与 HTTPS

1. 域名 A 记录指向服务器公网 IP；
2. 国内主机先完成 ICP 备案（备案期间 Caddy 无法签发证书，因为它要走 80 端口验证）；
3. 备案通过后重跑部署，把 `SITE_ADDRESS` 改成域名，Caddy 会自动申请证书并续期。

## 5. 日常运维

```bash
cd /opt/coin-museum

docker compose -f deploy/docker-compose.yml ps          # 状态
docker compose -f deploy/docker-compose.yml logs -f caddy   # Caddy 日志（含证书签发）
docker compose -f deploy/docker-compose.yml logs -f api     # 后端日志
docker compose -f deploy/docker-compose.yml restart api     # 只重启后端
docker compose -f deploy/docker-compose.yml down            # 停服
```

证书与配置存在具名卷 `coin-museum_caddy_data`，`down` 不会删掉；只有
`down -v` 才会，那时 Caddy 会重新签发（注意 Let's Encrypt 的签发频率限制）。

### 补新钱币数据

```powershell
# 本机：把新 docx 放进 data/ 或指定路径，重跑管线
python services/api/scripts/run_pipeline.py --docx "C:/github/钱币数据/先秦(3).docx"
# 然后重新部署（会自动同步新的 db 与图片并重启后端）
& deploy/deploy.ps1 -Server root@<你的服务器> -SiteAddress '<你的地址>' -SkipWebBuild
```

前端不用重打包 —— 页面是从接口取数据的，新数据自动出现。

## 6. 架构与端口

```
公网 ──▶ Caddy (:80/:443)
           ├─ /              → /srv/web        （前端静态产物，SPA 回退到 index.html）
           ├─ /assets/*      → /srv/web        （带内容哈希，永久缓存）
           ├─ /images/*      → /srv/images     （钱币图片，7 天缓存）
           └─ /api/*         → api:8000        （FastAPI，仅内网暴露）
```

`api` 容器不映射端口到宿主机，只能被同一 compose 网络里的 Caddy 访问。

## 7. 排障

| 现象 | 原因与处理 |
|---|---|
| `docker compose up` 报拉不到 `caddy:2-alpine` | Docker Hub 不通，见 §2 配镜像加速 |
| 证书签发失败 | 域名没解析、80 端口被占用、或未备案。先 `curl -I http://<域名>/.well-known/acme-challenge/` 排查 |
| 页面打开但接口 502 | `api` 容器没起来。`docker compose logs api`；常见是 `content/app.db` 没同步上去 |
| 接口正常但图片 404 | `static/images` 没同步，或 compose 里的挂载路径写错 |
| 接口返回 429 | 触发限流。调大 `deploy/.env` 里的 `COIN_RATE_LIMIT` 后重启 |
| 数据看着是旧的 | 只读卷挂载的是宿主机文件，改完数据要 `restart api` 让连接重新打开 |

## 8. 安全边界

- 后端连接建立后立刻 `PRAGMA query_only = ON`，即使代码写错也改不了数据；
- `api` 不暴露端口，只能经 Caddy 访问；
- 容器内以非 root（uid 10001）运行；
- Caddy 自动申请并续期 HTTPS，生产环境强制 HTTPS（`network_security_config.xml`
  里只有 debug 包放行明文）；
- 全站响应头含 `X-Content-Type-Options: nosniff`、`Referrer-Policy`，
  并隐藏 `Server`；
- 公开接口有限流（令牌桶，默认 20 req/s/IP）。
