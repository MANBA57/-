#!/usr/bin/env python3
"""安装本地安卓构建工具链：JDK 21 + Android cmdline-tools + Gradle。

为什么用 Python 而不是 PowerShell：
  本机沙箱拦截 Windows 加密栈（schannel），PowerShell 的 Invoke-WebRequest 一律报
  「基础连接已经关闭: 接收时发生错误」（curl 同理会报 SEC_E_NO_CREDENTIALS）。
  Python 的 urllib 自带 OpenSSL，不受影响 —— 项目里所有镜像可达性验证都是这么做的。
  另外 .ps1 在中文 Windows 上还要求 UTF-8 BOM 与执行策略放行，Python 都没这些坑。

全部装到项目内 .toolchain/，**不改系统环境变量**。

用法：
    python tools/install_android_toolchain.py
    python tools/install_android_toolchain.py --skip-sdk-packages
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TOOLCHAIN = PROJECT_ROOT / ".toolchain"
CACHE = TOOLCHAIN / "cache"
SDK_DIR = TOOLCHAIN / "android-sdk"
JDK_DIR = TOOLCHAIN / "jdk21"

JDK_ZIP_NAME = "OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip"
ADOPTIUM_BASE = "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/"
GRADLE_VERSION = "8.11"
GRADLE_BASE = "https://mirrors.cloud.tencent.com/gradle"
CMDLINE_TOOLS_ZIP = "commandlinetools-win-11076708_latest.zip"
ANDROID_BASE = "https://dl.google.com/android/repository"

COMPILE_SDK = "35"
BUILD_TOOLS = "35.0.0"

UA = {"User-Agent": "coin-museum-toolchain/1.0"}


def log(msg: str) -> None:
    print(msg, flush=True)


def step(msg: str) -> None:
    log(f"\n=== {msg} ===")


def download(url: str, dest: Path, *, retries: int = 3) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        log(f"  已存在，跳过下载: {dest.name} ({dest.stat().st_size/1048576:.1f} MB)")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            log(f"  下载 {url}")
            req = urllib.request.Request(url, headers=UA)
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=60) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                last_report = 0.0
                with tmp.open("wb") as fh:
                    while True:
                        chunk = resp.read(262144)
                        if not chunk:
                            break
                        fh.write(chunk)
                        done += len(chunk)
                        now = time.time()
                        if now - last_report > 2:
                            last_report = now
                            if total:
                                log(f"    {done/1048576:.1f}/{total/1048576:.1f} MB "
                                    f"({done*100//total}%)")
                            else:
                                log(f"    {done/1048576:.1f} MB")
            tmp.replace(dest)
            log(f"  完成: {dest.name} {dest.stat().st_size/1048576:.1f} MB "
                f"（{time.time()-t0:.0f}s）")
            return
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            log(f"  第 {attempt} 次失败: {type(exc).__name__}: {exc}")
            if attempt == retries:
                raise SystemExit(f"下载失败: {url}") from exc
            time.sleep(2 * attempt)


def extract_zip(zip_path: Path, dest: Path, *, flatten: bool = False) -> None:
    """解压。flatten=True 时把归档内唯一的一层目录内容提到 dest 下。"""
    if dest.exists() and any(dest.iterdir()):
        log(f"  已解压，跳过: {dest}")
        return
    log(f"  解压到 {dest}")
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)
    if flatten:
        entries = [p for p in dest.iterdir()]
        if len(entries) == 1 and entries[0].is_dir():
            inner = entries[0]
            for item in inner.iterdir():
                shutil.move(str(item), str(dest / item.name))
            inner.rmdir()


def run(cmd: list[str], *, env: dict[str, str], stdin_text: str | None = None) -> int:
    """注意用 subprocess.run 而不是 call：只有 run 支持 input=（喂 stdin）。
    call() 既没有 input，也不允许 stdin 与 input 同时给。"""
    proc = subprocess.run(
        cmd,
        env=env,
        input=stdin_text.encode() if stdin_text else None,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    return proc.returncode


def java_properties_escape(value: str) -> str:
    """按 Java Properties 规范转义。

    local.properties 由 Gradle 当作 java.util.Properties 读取，编码是 ISO-8859-1，
    非 ASCII 字符必须写成 \\uXXXX，否则含中文的路径会被读错（本机用户名就是中文）。
    另外 '\\'、':'、'=' 在属性值里也是特殊字符，需要转义。
    """
    out: list[str] = []
    for ch in value:
        if ch == "\\":
            out.append("\\\\")
        elif ch in (":", "="):
            out.append("\\" + ch)
        elif ord(ch) > 126 or ord(ch) < 32:
            out.append(f"\\u{ord(ch):04X}")
        else:
            out.append(ch)
    return "".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-sdk-packages", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    if args.force and TOOLCHAIN.exists():
        log(f"--force：清理 {TOOLCHAIN}")
        shutil.rmtree(TOOLCHAIN)
        CACHE.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- JDK 21
    step("JDK 21（清华 Adoptium 镜像）")
    java_exe = JDK_DIR / "bin" / "java.exe"
    if java_exe.exists() and not args.force:
        log("  已安装，跳过")
    else:
        jdk_zip = CACHE / JDK_ZIP_NAME
        download(f"{ADOPTIUM_BASE}{JDK_ZIP_NAME}", jdk_zip)
        extract_zip(jdk_zip, JDK_DIR, flatten=True)
    if not java_exe.exists():
        raise SystemExit(f"JDK 安装失败：找不到 {java_exe}")
    log(f"  JAVA_HOME = {JDK_DIR}")

    env = os.environ.copy()
    env["JAVA_HOME"] = str(JDK_DIR)
    env["PATH"] = f"{JDK_DIR / 'bin'}{os.pathsep}{env.get('PATH', '')}"
    subprocess.call([str(java_exe), "-version"])

    # ---------------------------------------------------------------- cmdline-tools
    step("Android cmdline-tools（dl.google.com）")
    ct_zip = CACHE / CMDLINE_TOOLS_ZIP
    download(f"{ANDROID_BASE}/{CMDLINE_TOOLS_ZIP}", ct_zip)
    latest = SDK_DIR / "cmdline-tools" / "latest"
    if (latest / "bin" / "sdkmanager.bat").exists() and not args.force:
        log("  已安装，跳过")
    else:
        if latest.exists():
            shutil.rmtree(latest)
        latest.parent.mkdir(parents=True, exist_ok=True)
        raw = TOOLCHAIN / "cmdline-tools-raw"
        if raw.exists():
            shutil.rmtree(raw)
        extract_zip(ct_zip, raw)
        src = raw / "cmdline-tools"
        shutil.move(str(src if src.exists() else raw), str(latest))
        shutil.rmtree(raw, ignore_errors=True)
    sdkmanager = latest / "bin" / "sdkmanager.bat"
    if not sdkmanager.exists():
        raise SystemExit(f"cmdline-tools 安装失败：找不到 {sdkmanager}")
    log(f"  {sdkmanager}")

    # ---------------------------------------------------------------- Gradle
    step(f"Gradle {GRADLE_VERSION}（腾讯云镜像）")
    gradle_dir = TOOLCHAIN / f"gradle-{GRADLE_VERSION}"
    if (gradle_dir / "bin" / "gradle.bat").exists() and not args.force:
        log("  已安装，跳过")
    else:
        gz = CACHE / f"gradle-{GRADLE_VERSION}-bin.zip"
        download(f"{GRADLE_BASE}/gradle-{GRADLE_VERSION}-bin.zip", gz)
        extract_zip(gz, TOOLCHAIN)
    log(f"  {gradle_dir}")

    # ---------------------------------------------------------------- SDK 组件
    # sdkmanager 默认把清单缓存写到 %USERPROFILE%\.android\cache。
    # 本机沙箱禁止写工作区之外的路径，会报
    #   java.nio.file.NoSuchFileException: C:\Users\...\.android\cache\sdkbin-...-repository2-3_xml
    # 看起来像网络错误，其实是被拒写。把 Android 用户目录也放进项目内即可，
    # 顺带让整套工具链自包含、可整体搬走。
    android_user_home = TOOLCHAIN / "android-home"
    android_user_home.mkdir(parents=True, exist_ok=True)
    env["ANDROID_USER_HOME"] = str(android_user_home)   # cmdline-tools 11+
    env["ANDROID_PREFS_ROOT"] = str(android_user_home)  # 旧版本兼容
    env["ANDROID_HOME"] = str(SDK_DIR)
    env["ANDROID_SDK_ROOT"] = str(SDK_DIR)
    log(f"  ANDROID_USER_HOME = {android_user_home}")

    if args.skip_sdk_packages:
        step("SDK 组件（按参数跳过）")
    else:
        packages = ["platform-tools", f"platforms;android-{COMPILE_SDK}", f"build-tools;{BUILD_TOOLS}"]
        step("SDK 组件：" + " / ".join(packages))
        log("  接受许可协议…")
        run([str(sdkmanager), f"--sdk_root={SDK_DIR}", "--licenses"], env=env, stdin_text="y\n" * 60)
        log("  安装组件…")
        rc = run([str(sdkmanager), f"--sdk_root={SDK_DIR}", *packages], env=env)
        if rc != 0:
            raise SystemExit(f"sdkmanager 返回 {rc}")

    # ---------------------------------------------------------------- local.properties
    step("写入 apps/web/android/local.properties（若工程已生成）")
    android_app = PROJECT_ROOT / "apps" / "web" / "android"
    if android_app.is_dir():
        lp = android_app / "local.properties"
        lp.write_text(f"sdk.dir={java_properties_escape(str(SDK_DIR))}\n", encoding="ascii")
        log(f"  sdk.dir={SDK_DIR}")
        log("  （含中文的字符已按 Java Properties 规范转义为 \\uXXXX）")
    else:
        log("  apps/android 尚未生成（执行 cap add android 后再跑本脚本即可）")

    step("完成")
    log(
        f"工具链（不改动系统环境变量，使用时按需注入）：\n"
        f"  JAVA_HOME    = {JDK_DIR}\n"
        f"  ANDROID_HOME = {SDK_DIR}\n"
        f"  GRADLE       = {gradle_dir / 'bin' / 'gradle.bat'}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
