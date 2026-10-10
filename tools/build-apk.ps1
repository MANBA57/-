<#
.SYNOPSIS
    构建安卓 APK。

.DESCRIPTION
    前置条件：
      1. python tools/install_android_toolchain.py 已执行
      2. apps/web 已 pnpm install
      3. apps/web/android 已由 pnpm --filter web run cap:add 生成

    环境限制（详见 README）：
      - Vite 在 Windows 下调用 child_process.exec("net use") 探测网络驱动器，
        该调用没有 try 包裹，受限沙箱下抛 spawn EPERM。
      - 本脚本是 .ps1 且含中文，必须带 UTF-8 BOM，否则 Windows PowerShell 会按
        ANSI 代码页读取导致解析失败。edit/write 工具产出的是无 BOM UTF-8，
        改完记得补：见 README「已知环境限制」。

.EXAMPLE
    Set-ExecutionPolicy -Scope Process Bypass -Force
    & tools/build-apk.ps1 -Mode debug -ApiBase 'http://192.168.1.23:8000'
#>
[CmdletBinding()]
param(
    [ValidateSet('debug', 'release')]
    [string]$Mode = 'debug',
    [switch]$SkipWebBuild,
    [string]$ApiBase = ''
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$WebDir      = Join-Path $ProjectRoot 'apps\web'
$AndroidDir  = Join-Path $WebDir 'android'
$Toolchain   = Join-Path $ProjectRoot '.toolchain'
$JdkDir      = Join-Path $Toolchain 'jdk21'
$SdkDir      = Join-Path $Toolchain 'android-sdk'

$NodeExe = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$PnpmMjs = 'C:\Users\单铂然\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'

function Write-Step([string]$m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

<#
调用原生命令并返回退出码。

必须这样包一层：原生命令只要往 stderr 写东西，在 $ErrorActionPreference='Stop'
下就会被提升成终止性错误；而 pnpm 每次执行都会把命令行回显到 stderr，
于是脚本会在构建**成功**的情况下中断。$PSNativeCommandUseErrorActionPreference
管不了这个（它只管非零退出码变成错误，不管 stderr）。
这里临时把 ErrorActionPreference 降级，成败一律以 $LASTEXITCODE 判断。
#>
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # 必须 Out-Host：函数会把写进成功流的内容全部当作返回值，
        # 直接 `& $Exe @Arguments` 会让调用方拿到的 $rc 变成「整段输出 + 退出码」的数组，
        # 于是 `$rc -ne 0` 永远成立，构建明明成功也被判为失败。
        & $Exe @Arguments | Out-Host
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
}

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
# 把 Gradle 的用户目录放进项目内：默认的 %USERPROFILE%\.gradle 在工作区之外，
# 受限沙箱会拒写，报「Could not create parent directory for lock file」。
$env:GRADLE_USER_HOME = Join-Path $Toolchain 'gradle-home'
New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME -Force | Out-Null
# sdkmanager 的清单缓存同样默认落在 %USERPROFILE%\.android，一并挪进项目
$env:ANDROID_USER_HOME = Join-Path $Toolchain 'android-home'
New-Item -ItemType Directory -Path $env:ANDROID_USER_HOME -Force | Out-Null
# JVM / AGP 的临时目录默认取系统 %TEMP%（工作区之外，沙箱拒写），会让
# mergeDebugJavaResource 报 AccessDeniedException。指到项目内，daemon 会继承。
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
    $rc = Invoke-Native 'subst' @($MappingDrive, $ProjectRoot)
    if ($rc -eq 0) {
        $useSubst = $true
        $WebDir     = "$MappingDrive\apps\web"
        $AndroidDir = "$MappingDrive\apps\web\android"
        Write-Host "  $MappingDrive -> $ProjectRoot"
    } else {
        Write-Warning 'subst 失败，将直接用原路径构建（可能触发 aapt2 路径问题）'
    }
}

try {
    if (-not $SkipWebBuild) {
        Write-Step '构建前端产物'
        if ($ApiBase) {
            Write-Host "  VITE_API_BASE=$ApiBase"
            $env:VITE_API_BASE = $ApiBase
        }
        $rc = Invoke-Native $NodeExe @($PnpmMjs, '--filter', 'web', 'build')
        if ($rc -ne 0) { throw "前端构建失败（exit $rc）。若报 spawn EPERM，请改在完全访问会话中执行" }

        Write-Step 'cap sync android'
        $rc = Invoke-Native $NodeExe @($PnpmMjs, '--filter', 'web', 'run', 'cap:sync')
        if ($rc -ne 0) { throw "cap sync 失败（exit $rc）" }
    }

    $task = if ($Mode -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
    Write-Step "Gradle $task"
    Push-Location $AndroidDir
    try {
        $rc = Invoke-Native '.\gradlew.bat' @($task, '--no-daemon')
    } finally {
        Pop-Location
    }
    if ($rc -ne 0) { throw "Gradle $task 失败（exit $rc）" }

    Write-Step '产物'
    $apkDir = Join-Path $AndroidDir 'app\build\outputs\apk'
    $apks = Get-ChildItem $apkDir -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match $Mode }
    foreach ($a in $apks) {
        Write-Host ("  {0}  {1:N2} MB" -f $a.FullName, ($a.Length / 1MB))
    }
    if (-not $apks) { Write-Warning "没有找到 $Mode 产物" }
} finally {
    if ($useSubst) {
        Invoke-Native 'subst' @($MappingDrive, '/D') | Out-Null
        Write-Host "`n已解除 $MappingDrive 映射"
    }
}