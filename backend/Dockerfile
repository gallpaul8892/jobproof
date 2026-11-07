# syntax=docker/dockerfile:1

# ---- builder: resolve and install locked, production-only dependencies ----
# TODO(pin): floating tags (python:3.13-slim here and below, uv image). The exact tag/digest
# must be pinned on a machine with registry access; not verifiable offline.
FROM python:3.13-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /build
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ---- runtime ----
# TODO(pin): floating tag; pin the exact tag/digest on a machine with registry access.
FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin jobproof
COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--timeout-graceful-shutdown", "20"]
