"""طبقة قاعدة البيانات.

كل طلب لعميل يعمل داخل معاملة واحدة ضُبط فيها app.org_id و app.user_id
بـ set_config(..., true) أي على مستوى المعاملة فقط، فلا يتسرب السياق بين
الطلبات حتى مع إعادة استخدام الاتصالات في الـ pool.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from uuid import UUID

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine

from .config import get_settings


@lru_cache
def app_engine() -> Engine:
    return create_engine(get_settings().database_url_app, pool_pre_ping=True, pool_size=10)


@lru_cache
def platform_engine() -> Engine:
    return create_engine(get_settings().database_url_platform, pool_pre_ping=True, pool_size=5)


@contextmanager
def tenant_tx(org_id: UUID | str | None, user_id: UUID | str | None) -> Iterator[Connection]:
    """معاملة خاضعة لـ RLS ومقيّدة بمنشأة ومستخدم."""
    with app_engine().begin() as conn:
        conn.execute(
            text("SELECT set_config('app.org_id', :org, true), set_config('app.user_id', :usr, true)"),
            {"org": str(org_id) if org_id else "", "usr": str(user_id) if user_id else ""},
        )
        yield conn


@contextmanager
def platform_tx() -> Iterator[Connection]:
    """معاملة بصلاحيات المنصة (تتجاوز RLS) — للوحة الإدارة والعمّال وتسجيل الدخول فقط."""
    with platform_engine().begin() as conn:
        yield conn
