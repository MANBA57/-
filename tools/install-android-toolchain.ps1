<#
.SYNOPSIS
    安装本地安卓构建工具链（JDK 21 + Android cmdline-tools + Gradle）。

.DESCRIPTION
    全部走本机实测可达的国内镜像 / Google 仓库，装到项目内 .toolchain/，
    **不修改系统环境变量**。

    P0 只负责提供脚本；实际执行在 P4（打 APK）阶段。

    已实测的源：
      JDK 21     清华 Adoptium 镜像
      Gradle     腾讯云 gradle 镜像
      cmdline-tools / SDK 组件   dl.google.com（可达）

.EXAMPLE
    pwsh -File tools/install-android-toolchain.ps1
    pwsh -File tools/install-android-toolchain.ps1 -SkipSdkPackages
#>
[CmdletBinding()]
param(
    [string]$JdkZipName  = 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip',
    [string]$GradleVersion = '8.11',
    [string]$CmdlineToolsZip = 'commandlinetools-win-11076708_latest.zip',
    [string]$CompileSdk  = '35',
    [string]$BuildTools  = '35.0.0',
    [switch]$SkipSdkPackages,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # 让 Invoke-WebRequest 快很多

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Toolchain   = Join-Path $ProjectRoot '.toolchain'
$Cache       = Join-Path $Toolchain 'cache'
$SdkDir      = Join-Path $Toolchain 'android-sdk'
$JdkDir      = Join-Path $Toolchain 'jdk21'
$GradleDir   = Join-Path $Toolchain "gradle-$GradleVersion"

$AdoptiumBase = 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/'
$GradleBase   = 'https://mirrors.cloud.tencent.com/gradle'
$AndroidBase  = 'https://dl.google.com/android/repository'

function Write-Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

function Get-File([string]$url, [string]$dest) {
    if ((Test-Path $dest) -and -not $Force) {
        Write-Host "  已存在，跳过下载: $(Split-Path $dest -Leaf)"
        return
    }
    Write-Host "  下载 $url"
    $tmp = "$dest.part"
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    Move-Item $tmp $dest -Force
    $mb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "  完成 ($mb MB)"
}

function Expand-Zip([string]$zip, [string]$dest) {
    if ((Test-Path $dest) -and -not $Force) {
        Write-Host "  已解压，跳过: $dest"
        return
    }
    Write-Host "  解压到 $dest"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Expand-Archive -Path $zip -DestinationPath $dest -Force
}

New-Item -ItemType Directory -Path $Cache -Force | Out-Null

# ---------------------------------------------------------------- JDK 21
Write-Step 'JDK 21（清华 Adoptium 镜像）'
if ((Test-Path (Join-Path $JdkDir 'bin\java.exe')) -and -not $Force) {
    Write-Host '  已安装，跳过'
} else {
    $jdkZip = Join-Path $Cache $JdkZipName
    Get-File "$AdoptiumBase$JdkZipName" $jdkZip
    Expand-Zip $jdkZip $JdkDir
    # Adoptium 的 zip 内多一层目录，把它提到 JdkDir 下
    $inner = Get-ChildItem $JdkDir -Directory | Select-Object -First 1
    if ($inner -and -not (Test-Path (Join-Path $JdkDir 'bin\java.exe'))) {
        Write-Host "  整理目录: $($inner.Name) -> ."
        Get-ChildItem $inner.FullName -Force | Move-Item -Destination $JdkDir -Force
        Remove-Item $inner.FullName -Recurse -Force
    }
}
$env:JAVA_HOME = $JdkDir
$javaExe = Join-Path $JdkDir 'bin\java.exe'
if (-not (Test-Path $javaExe)) { throw "JDK 安装失败：找不到 $javaExe" }
Write-Host "  JAVA_HOME = $JdkDir"
& $javaExe -version 2>&1 | ForEach-Object { Write-Host "  $_" }

# ---------------------------------------------------------------- Android cmdline-tools
Write-Step 'Android cmdline-tools（dl.google.com）'
$ctZip = Join-Path $Cache $CmdlineToolsZip
Get-File "$AndroidBase/$CmdlineToolsZip" $ctZip
$ctTmp = Join-Path $Toolchain 'cmdline-tools-raw'
Expand-Zip $ctZip $ctTmp

$cmakeToolsLatest = Join-Path $SdkDir 'cmdline-tools\latest'
if ((Test-Path $cmakeToolsLatest) -and $Force) { Remove-Item $cmakeToolsLatest -Recurse -Force }
New-Item -ItemType Directory -Path (Split-Path $cmakeToolsLatest -Parent) -Force | Out-Null
if (-not (Test-Path $cmakeToolsLatest)) {
    # zip 内是 cmdline-tools/，sdkmanager 要求放在 cmdline-tools/latest/
    $src = Join-Path $ctTmp 'cmdline-tools'
    if (-not (Test-Path $src)) { $src = $ctTmp }
    Move-Item $src $cmakeToolsLatest
}
Write-Host "  $cmakeToolsLatest"

# ---------------------------------------------------------------- Gradle
Write-Step "Gradle $GradleVersion（腾讯云镜像）"
if ((Test-Path (Join-Path $GradleDir 'bin\gradle.bat')) -and -not $Force) {
    Write-Host '  已安装，跳过'
} else {
    $gradleZip = Join-Path $Cache "gradle-$GradleVersion-bin.zip"
    Get-File "$GradleBase/gradle-$GradleVersion-bin.zip" $gradleZip
    Expand-Zip $gradleZip $Toolchain
}
Write-Host "  $GradleDir"

# ---------------------------------------------------------------- SDK 组件
$sdkmanager = Join-Path $cmakeToolsLatest 'bin\sdkmanager.bat'
if ($SkipSdkPackages) {
    Write-Step 'SDK 组件（已按参数跳过）'
} else {
    Write-Step "SDK 组件：platform-tools / platforms;android-$CompileSdk / build-tools;$BuildTools"
    # sdkmanager 会从 dl.google.com 拉取；已实测可达
    $packages = @(
        'platform-tools',
        "platforms;android-$CompileSdk",
        "build-tools;$BuildTools"
    )
    $env:ANDROID_HOME = $SdkDir
    $env:ANDROID_SDK_ROOT = $SdkDir

    # 先接受许可（sdkmanager 逐条询问，这里批量喂 y）
    Write-Host '  接受 SDK 许可协议…'
    $yes = ("y`n" * 30)
    $yes | & $sdkmanager --sdk_root="$SdkDir" --licenses 2>&1 |
        Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" }

    & $sdkmanager --sdk_root="$SdkDir" $packages 2>&1 |
        Select-Object -Last 12 | ForEach-Object { Write-Host "    $_" }
}

# ---------------------------------------------------------------- local.properties
Write-Step '写入 apps/android/local.properties'
$androidApp = Join-Path $ProjectRoot 'apps\android'
if (Test-Path (Split-Path $androidApp -Parent)) {
    if (Test-Path $androidApp) {
        $escaped = $SdkDir -replace '\\', '\\'
        Set-Content -Path (Join-Path $androidApp 'local.properties') `
            -Value "sdk.dir=$escaped" -Encoding ASCII
        Write-Host "  sdk.dir=$SdkDir"
    } else {
        Write-Host '  apps/android 尚未生成（P4 执行 cap add android 后再跑本脚本即可）'
    }
}

Write-Step '完成'
Write-Host @"
工具链位置（不改动系统环境变量，使用时按需注入）：

  JAVA_HOME   = $JdkDir
  ANDROID_HOME= $SdkDir
  GRADLE      = $(Join-Path $GradleDir 'bin\gradle.bat')

下一次进 P4 打 APK 时，直接跑 tools/build-apk.ps1。
"@
