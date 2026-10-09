"""بوابات الدفع. الاعتماد لا يكون إلا بعد سؤال البوابة نفسها عن حالة الفاتورة ومبلغها (لا نثق بمحتوى الإشعار)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol

import httpx

from ..config import Settings


@dataclass
class Checkout:
    ref: str
    url: str


class Gateway(Protocol):
    name: str

    def create(self, *, intent_id: str, amount_halalas: int, description: str, callback_url: str,
               success_url: str, back_url: str) -> Checkout: ...

    def fetch(self, ref: str) -> dict:
        """يُرجع {"status": "paid"|..., "amount": بالهللات}."""


class FakeGateway:
    """للتطوير ونسخة العرض: صفحة دفع تجريبية داخل حصيف، ولا يُقبل في الإنتاج."""

    name = "FAKE"

    def __init__(self, client_base_url: str):
        self.base = client_base_url
        self.paid: set[str] = set()

    def create(self, *, intent_id, amount_halalas, description, callback_url, success_url, back_url) -> Checkout:
        return Checkout(ref=f"fake-{uuid.uuid4().hex[:16]}", url=f"{self.base}/billing/pay/?intent={intent_id}&sandbox=1")

    def fetch(self, ref: str) -> dict:
        return {"status": "unknown"}


class Moyasar:
    """ميسّر (بوابة سعودية: مدى، فيزا، ماستركارد، Apple Pay). الفواتير المستضافة: POST /v1/invoices."""

    name = "MOYASAR"
    BASE = "https://api.moyasar.com/v1"

    def __init__(self, secret_key: str, client: httpx.Client | None = None):
        self._auth = (secret_key, "")
        self._client = client or httpx.Client(timeout=20)

    def create(self, *, intent_id, amount_halalas, description, callback_url, success_url, back_url) -> Checkout:
        r = self._client.post(f"{self.BASE}/invoices", auth=self._auth, json={
            "amount": amount_halalas, "currency": "SAR", "description": description[:255],
            "callback_url": callback_url, "success_url": success_url, "back_url": back_url})
        r.raise_for_status()
        d = r.json()
        return Checkout(ref=d["id"], url=d["url"])

    def fetch(self, ref: str) -> dict:
        r = self._client.get(f"{self.BASE}/invoices/{ref}", auth=self._auth)
        r.raise_for_status()
        d = r.json()
        return {"status": d.get("status"), "amount": d.get("amount"), "currency": d.get("currency")}


def build_gateway(s: Settings) -> Gateway:
    if s.payment_provider == "moyasar":
        if not s.moyasar_secret_key:
            raise RuntimeError("HASEEF_MOYASAR_SECRET_KEY مطلوب عند HASEEF_PAYMENT_PROVIDER=moyasar")
        return Moyasar(s.moyasar_secret_key)
    if s.env == "production":
        raise RuntimeError("بوابة الدفع التجريبية غير مسموحة في الإنتاج")
    return FakeGateway(s.client_base_url)
