# خادم حصيف (FastAPI) والعمّال (Celery) — صورة واحدة بأوامر تشغيل مختلفة.
# يُبنى من جذر المستودع:  docker build -f apps/api/Dockerfile .
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 TZ=Asia/Riyadh
WORKDIR /app/apps/api

COPY apps/api/pyproject.toml ./
RUN mkdir haseef && touch haseef/__init__.py && pip install . && pip uninstall -y haseef-api

COPY apps/api/ ./
COPY db/migrations/ /app/db/migrations/
# الحزمة تُشغَّل من مكانها (لا تُثبَّت) حتى يجد migrate.py مجلد db/migrations بمساره في المستودع
RUN useradd --system --uid 10001 --home /app haseef \
 && mkdir -p /app/storage && chown haseef /app/storage
USER haseef

ENV PYTHONPATH=/app/apps/api HASEEF_ENV=production HASEEF_AUTO_MIGRATE=false HASEEF_STORAGE_DIR=/app/storage
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
# --proxy-headers: عنوان المستخدم الحقيقي من Caddy يُسجَّل في سجل التدقيق
CMD ["uvicorn", "haseef.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
