from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, model_validator

ComplianceCategory = Literal[
    "COMMERCIAL_REG", "BALADY", "CHI_INSURANCE", "GOSI", "QIWA_NITAQAT",
    "WPS", "ZATCA", "CIVIL_DEFENSE", "CHAMBER", "OTHER",
]
RiskLevel = Literal["CRITICAL", "HIGH", "MEDIUM"]
PolicyType = Literal[
    "PRIVACY_POLICY", "CONFLICT_OF_INTEREST", "WHISTLEBLOWING", "CODE_OF_CONDUCT",
    "DATA_RETENTION", "INFOSEC", "OTHER",
]


# ---------- المصادقة ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MembershipOut(BaseModel):
    org_id: UUID
    org_name: str
    cr_number: str
    role: str


class MeOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    is_platform_admin: bool
    memberships: list[MembershipOut]


# ---------- عناصر الامتثال ----------
class ComplianceItemIn(BaseModel):
    category: ComplianceCategory
    title: str = Field(min_length=2, max_length=255)
    reference_number: str | None = Field(default=None, max_length=100)
    issue_date: date | None = None
    expiry_date: date
    risk_level: RiskLevel = "HIGH"
    renewal_url: str | None = None
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _dates(self) -> "ComplianceItemIn":
        if self.issue_date and self.issue_date > self.expiry_date:
            raise ValueError("تاريخ الإصدار يجب أن يسبق تاريخ الانتهاء")
        return self


class ComplianceItemOut(ComplianceItemIn):
    id: UUID
    status: Literal["ACTIVE", "EXPIRING_SOON", "EXPIRED"]
    days_remaining: int
    action_required: bool
    created_at: datetime


class RenewIn(BaseModel):
    """التجديد يؤرشف العنصر القديم وينشئ عنصراً جديداً بتاريخ انتهاء جديد؛ يبقى السجل كاملاً."""
    new_expiry_date: date
    new_issue_date: date | None = None
    new_reference_number: str | None = None


# ---------- السياسات ----------
class PolicyIn(BaseModel):
    policy_type: PolicyType
    title: str = Field(min_length=2, max_length=255)
    version: str = "1.0"
    approval_date: date | None = None
    review_due_date: date
    status: Literal["DRAFT", "ACTIVE", "OBSOLETE"] = "ACTIVE"


class PolicyOut(PolicyIn):
    id: UUID
    effective_status: str
    days_remaining: int


# ---------- قواعد التنبيه ----------
class AlertRuleIn(BaseModel):
    target_type: Literal["COMPLIANCE_ITEM", "POLICY"]
    target_id: UUID | None = None
    days_before: list[int] = Field(min_length=1, max_length=12)
    channels: list[Literal["WHATSAPP", "EMAIL"]] = Field(min_length=1)
    is_enabled: bool = True

    @model_validator(mode="after")
    def _non_negative(self) -> "AlertRuleIn":
        if any(d < 0 or d > 365 for d in self.days_before):
            raise ValueError("العتبات بين 0 و365 يوماً")
        self.days_before = sorted(set(self.days_before), reverse=True)
        return self


# ---------- لوحة المنشأة ----------
class ScoreReason(BaseModel):
    pillar: str
    severity: Literal["critical", "high", "medium"]
    text: str
    points: int
    points_label: str | None


class ScoreOut(BaseModel):
    score: int | None
    pillars: dict[str, float | None]
    weights_used: dict[str, float]
    capped_by_critical_expiry: bool
    reasons: list[ScoreReason] = []
    computed_at: datetime | None


class GovernanceSummary(BaseModel):
    available: bool                         # الميزة ضمن الباقة
    last_meeting_title: str | None = None
    last_meeting_date: date | None = None
    last_meeting_status: str | None = None
    doa_rules: int = 0
    doa_last_updated: date | None = None


class PdplSummary(BaseModel):
    available: bool
    records: int = 0
    complete_records: int = 0
    completeness_pct: int | None = None      # None = لا سجلات بعد
    cross_border: int = 0


class DashboardOut(BaseModel):
    org_name: str
    cr_number: str
    greeting_name: str
    plan_tier: str | None
    automation_active: bool                 # اشتراك فعّال = التنبيهات التلقائية تعمل
    score: ScoreOut
    action_required: list[ComplianceItemOut]
    counts: dict[str, int]
    governance: GovernanceSummary
    pdpl: PdplSummary
