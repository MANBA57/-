<#
.SYNOPSIS
    把「数字钱币库」部署到云端服务器。

.DESCRIPTION
    流程：本地跑数据管线 → 构建前端 → 打包 → scp → 远端 docker compose 起服务。
    刻意不依赖境外 CI（GitHub Actions 在本网络不可达）。

    上传内容不含 node_modules / .venv / .toolchain / 安卓构建产物，
    服务器只需装好 Docker 与 Docker Compose 插件。

.PARAMETER Server
    SSH 目标，形如 user@1.2.3.4

.PARAMETER SiteAddress
    站点地址。域名（如 coin.example.com）会自动申请 HTTPS 证书；
    只有 IP 时用非标端口（如 :8443）。

.EXAMPLE
    & deploy/deploy.ps1 -Server root@1.2.3.4 -SiteAddress ':8443'
    & deploy/deploy.ps1 -Server root@coin.example.com -SiteAddress 'coin.example.com'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$RemoteDir = '/opt/coin-museum',
    [string]$SiteAddress = ':8443',
    [int]$RateLimit = 20,
    [switch]$SkipPipeline,
    [switch]$SkipWebBuild,
    [switch]$SkipData
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

function Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# 用系统 PATH 上的 node/pnpm（服务器部署阶段不依赖沙箱内路径）
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' }
$PnpmMjs = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$Py = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$ApiVenv = Join-Path $ProjectRoot 'services\api\.venv\Scripts\python.exe'
if (Test-Path $ApiVenv) { $Py = $ApiVenv }

if (-not $SkipPipeline) {
    Step '1/6 本地跑数据管线'
    & $Py (Join-Path $ProjectRoot 'services\api\scripts\run_pipeline.py')
    if ($LASTEXITCODE -ne 0) { throw '数据管线失败' }
}

if (-not $SkipWebBuild) {
    Step '2/6 构建前端（同源相对路径，不注入 API 地址）'
    Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue
    # 预渲染的 canonical 与 sitemap 需要绝对地址，否则会写成 localhost
    if ($SiteAddress -notlike ':*') {
        $env:SITE_ORIGIN = "https://$SiteAddress"
        Write-Host "  SITE_ORIGIN=$env:SITE_ORIGIN"
    } else {
        Write-Warning "SiteAddress 是非标端口（$SiteAddress），无法推断站点源；"
        Write-Warning '  canonical 与 sitemap 会写成 localhost。拿到域名后重新部署即可。'
    }
    & $Node $PnpmMjs --filter web build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
}

Step '3/6 打包'
$tar = Join-Path $env:TEMP 'coin-museum-deploy.tar.gz'
if (Test-Path $tar) { Remove-Item $tar -Force }
$excludes = @(
    '--exclude=*/node_modules', '--exclude=node_modules',
    '--exclude=*/.venv', '--exclude=.venv',
    '--exclude=*/.toolchain', '--exclude=.toolchain',
    '--exclude=*/.tmp', '--exclude=.tmp',
    '--exclude=*/__pycache__', '--exclude=*.pyc',
    '--exclude=*/app/build', '--exclude=*/android/build',
    '--exclude=*/.gradle', '--exclude=*/android/.gradle',
    '--exclude=*/android/local.properties',
    '--exclude=*/android/keystore', '--exclude=*/android/keystore.properties',
    '--exclude=*/content/review'
)
if ($SkipData) { $excludes += @('--exclude=*/services/api/content', '--exclude=*/services/api/static') }

$tarArgs = @('-czf', $tar) + $excludes + @(
    'apps/web/dist', 'services/api/app', 'services/api/scripts',
    'services/api/requirements.txt', 'services/api/Dockerfile', 'services/api/.dockerignore',
    'deploy', 'README.md'
)
if (-not $SkipData) { $tarArgs += @('services/api/content', 'services/api/static') }

& tar @tarArgs
if ($LASTEXITCODE -ne 0) { throw 'tar 打包失败' }
Write-Host ("  包大小: {0:N1} MB" -f ((Get-Item $tar).Length / 1MB))

Step "4/6 上传到 $Server"
& ssh $Server "mkdir -p $RemoteDir"
if ($LASTEXITCODE -ne 0) { throw "无法连接服务器 $Server（检查 SSH 与密钥）" }
& scp $tar "${Server}:$RemoteDir/deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw '上传失败' }

Step '5/6 远端解包并生成配置'
$remoteScript = @"
set -e
cd $RemoteDir
tar -xzf deploy.tar.gz
rm -f deploy.tar.gz
cat > deploy/.env <<'ENVEOF'
SITE_ADDRESS=$SiteAddress
COIN_RATE_LIMIT=$RateLimit
COIN_ALLOWED_ORIGINS=
ENVEOF
echo '  deploy/.env:'
sed 's/^/    /' deploy/.env
"@
& ssh $Server $remoteScript
if ($LASTEXITCODE -ne 0) { throw '远端解包失败' }

Step '6/6 远端构建并启动'
& ssh $Server "cd $RemoteDir && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build"
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'compose 启动失败。国内服务器拉不到 Docker Hub 时，先配置镜像加速：'
    Write-Warning '  /etc/docker/daemon.json: { "registry-mirrors": ["https://<你的加速地址>"] }'
    throw 'compose 启动失败'
}

Step '验证'
& ssh $Server "cd $RemoteDir && docker compose -f deploy/docker-compose.yml ps && curl -fsS -o /dev/null -w 'health: %{http_code}\n' http://127.0.0.1/api/v1/health || true"

Write-Host "`n完成。站点地址：http://$Server$SiteAddress" -ForegroundColor Green
Write-Host "若配置了域名与解析，Caddy 会自动签发 HTTPS 证书（国内主机需先完成 ICP 备案）。"