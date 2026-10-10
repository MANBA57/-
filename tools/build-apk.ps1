<#
.SYNOPSIS
    构建安卓 APK。

.DESCRIPTION
    前置条件：
      1. python tools/install_android_toolchain.py 已执行
      2. apps/web 已 pnpm install
      3. apps/web/android 已由 pnpm --filter web run cap:add 生成

    环境限制（详见 README「已知环境限制」）：
      - Vite 在 Windows 下调用 child_process.exec("net use")，该调用没有 try 包裹，
        受限沙箱下抛 spawn EPERM。本脚本需在非受限（完全访问）会话中执行。
      - 本脚本是 .ps1 且含中文，必须带 UTF-8 BOM，否则 Windows PowerShell 按
        ANSI 代码页读取会解析失败。

.EXAMPLE
    Set-ExecutionPolicy -Scope Process Bypass -Force
    & tools/build-apk.ps1 -Mode debug
#>
[CmdletBinding()]
param(
    [ValidateSet('debug', 'release')]
    [string]$Mode = 'debug',
    [switch]$SkipWebBuild,
    [string]$ApiBase = ''
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$WebDir      = Join-Path $ProjectRoot 'apps\web'
$AndroidDir  = Join-Path $WebDir 'android'
$Toolchain   = Join-Path $ProjectRoot '.toolchain'
$JdkDir      = Join-Path $Toolchain 'jdk21'
$SdkDir      = Join-Path $Toolchain 'android-sdk'

$NodeExe = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$PnpmMjs = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

foreach ($p in @(
    @{ Path = (Join-Path $JdkDir 'bin\java.exe');     Name = 'JDK' },
    @{ Path = (Join-Path $AndroidDir 'gradlew.bat'); Name = 'Android 工程' },
    @{ Path = $NodeExe;                              Name = 'Node' }
)) {
    if (-not (Test-Path $p.Path)) {
        throw "缺少$($p.Name)：$($p.Path)`n请先跑 python tools/install_android_toolchain.py，再执行 pnpm --filter web run cap:add"
    }
}

$env:JAVA_HOME        = $JdkDir
$env:ANDROID_HOME     = $SdkDir
$env:ANDROID_SDK_ROOT = $SdkDir
# 把 Gradle 的用户目录也放进项目内：默认的 %USERPROFILE%\.gradle 在工作区之外，
# 本机沙箱会拒写，报「Could not create parent directory for lock file ...\.gradle\wrapper\dists\...」。
# 顺带让工具链自包含，可以直接整目录搬走。
$env:GRADLE_USER_HOME = Join-Path $Toolchain 'gradle-home'
New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME -Force | Out-Null
# sdkmanager 的清单缓存同样默认落在 %USERPROFILE%\.android，一并挪进项目
$env:ANDROID_USER_HOME = Join-Path $Toolchain 'android-home'
New-Item -ItemType Directory -Path $env:ANDROID_USER_HOME -Force | Out-Null
# JVM / AGP 的临时目录默认取系统 %TEMP%（工作区之外，沙箱拒写），会让
#  mergeDebugJavaResource 报 java.nio.file.AccessDeniedException: ...\Temp\tempdir_<n>。
#  指到项目内，Gradle fork 出的 daemon 会继承这个环境变量。
$gradleTmp = Join-Path $Toolchain 'tmp'
New-Item -ItemType Directory -Path $gradleTmp -Force | Out-Null
$env:TEMP = $gradleTmp
$env:TMP  = $gradleTmp
$env:PATH = "$(Join-Path $JdkDir 'bin');$(Join-Path $SdkDir 'platform-tools');$env:PATH"

# 中文路径规避：Gradle / aapt2 对非 ASCII 路径历史上会出问题。
$MappingDrive = 'X:'
$useSubst = $false
if ($ProjectRoot -match '[^\x00-\x7F]') {
    Write-Step "项目路径含非 ASCII 字符，映射 $MappingDrive"
    & subst $MappingDrive $ProjectRoot
    if ($LASTEXITCODE -eq 0) {
        $useSubst = $true
        $WebDir     = "$MappingDrive\apps\web"
        $AndroidDir = "$MappingDrive\apps\web\android"
        Write-Host "  $MappingDrive -> $ProjectRoot"
    } else {
        Write-Warning 'subst 失败，将直接用原路径构建'
    }
}

try {
    if (-not $SkipWebBuild) {
        Write-Step '构建前端产物'
        if ($ApiBase) {
            Write-Host "  VITE_API_BASE=$ApiBase"
            $env:VITE_API_BASE = $ApiBase
        }
        & $NodeExe $PnpmMjs --filter web build
        if ($LASTEXITCODE -ne 0) { throw '前端构建失败（若报 spawn EPERM，请改在完全访问会话中执行）' }

        Write-Step 'cap sync android'
        & $NodeExe $PnpmMjs --filter web run cap:sync
        if ($LASTEXITCODE -ne 0) { throw 'cap sync 失败' }
    }

    $task = if ($Mode -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
    Write-Step "Gradle $task"
    Push-Location $AndroidDir
    & '.\gradlew.bat' $task --no-daemon
    $gradleExit = $LASTEXITCODE
    Pop-Location
    if ($gradleExit -ne 0) { throw "Gradle $task 失败" }

    Write-Step '产物'
    $apkDir = Join-Path $AndroidDir 'app\build\outputs\apk'
    Get-ChildItem $apkDir -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  $($_.FullName)  ($([math]::Round($_.Length/1MB,2)) MB)"
    }
} finally {
    if ($useSubst) {
        & subst $MappingDrive /D
        Write-Host "`n已解除 $MappingDrive 映射"
    }
}