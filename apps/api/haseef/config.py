from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="HASEEF_", extra="ignore")

    env: str = "development"

    # اتصالان منفصلان: العملاء عبر دور خاضع لـ RLS، والمنصة/العمّال عبر دور يتجاوزه.
    database_url_app: str = "postgresql+psycopg://haseef_app:dev@localhost:5432/haseef"
    database_url_platform: str = "postgresql+psycopg://haseef_platform:dev@localhost:5432/haseef"

    # مالك المخطط: للتحديثات فقط، لا يُستخدم في الطلبات.
    database_url_migrate: str = "postgresql+psycopg://haseef_owner:dev@localhost:5432/haseef"
    auto_migrate: bool = True                   # يُطفأ في الإنتاج: التحديث خطوة نشر صريحة

    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = Field(default="change-me-in-production", min_length=16)
    jwt_ttl_minutes: int = 8 * 60

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    client_base_url: str = "https://app.haseef.sa"

    # الإرسال
    alert_send_hour: int = 9                    # بتوقيت الرياض
    whatsapp_provider: str = "console"          # console | unifonic | meta
    unifonic_app_sid: str | None = None
    unifonic_sender: str | None = None
    meta_phone_number_id: str | None = None
    meta_access_token: str | None = None
    whatsapp_template_lang: str = "ar"

    # الذكاء الاصطناعي — يجب أن يكون داخل المملكة (انظر الوثيقة §1.1)
    llm_provider: str = "disabled"              # disabled | openai_compatible
    llm_base_url: str | None = None             # نقطة نهاية مستضافة داخل المملكة
    llm_api_key: str | None = None
    llm_model: str | None = None
    llm_region: str | None = None               # يُسجَّل مع كل تدقيق لإثبات مكان المعالجة
    embedding_model: str = "bge-m3"
    embedding_dim: int = 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
