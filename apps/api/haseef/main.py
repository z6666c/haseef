from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import admin, auth, compliance, dashboard, reminders

logging.basicConfig(level=logging.INFO)


def create_app() -> FastAPI:
    s = get_settings()
    if s.env == "production" and s.jwt_secret == "change-me-in-production":
        raise RuntimeError("HASEEF_JWT_SECRET must be set in production")
    if s.env == "production" and s.llm_provider != "disabled" and not s.llm_region:
        raise RuntimeError("HASEEF_LLM_REGION is required: AI processing must be documented as in-Kingdom")

    app = FastAPI(title="Haseef API", version="0.1.0", docs_url=None if s.env == "production" else "/docs")
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["Authorization", "Content-Type", "X-Org-Id"])
    for r in (auth.router, compliance.router, reminders.router, dashboard.router, admin.router):
        app.include_router(r, prefix="/v1")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
