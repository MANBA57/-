# 数字钱币库 · 后端镜像
#
# 只装运行期依赖（requirements.txt 里的数据管线依赖 python-docx / Pillow 其实是
# 构建期用的，但体积不大、分开维护反而容易出错，故一并保留）。
#
# 数据（app.db 与图片）**不打进镜像**，而是由 compose 以只读卷挂载，
# 这样补新数据只需 rsync + restart，不必重建镜像。

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

# 非 root 运行
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# --proxy-headers + --forwarded-allow-ips 是必需的：
# 前面有 Caddy 反代，不限流中间件读到的是 Caddy 容器的 IP，
# 所有请求会被算成同一个客户端而互相挤占配额。
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
