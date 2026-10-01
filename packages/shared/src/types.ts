// أنواع استجابات الخادم (تطابق haseef/schemas.py)

export type ItemStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";
export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM";
export type ComplianceCategory =
  | "COMMERCIAL_REG" | "BALADY" | "CHI_INSURANCE" | "GOSI" | "QIWA_NITAQAT"
  | "WPS" | "ZATCA" | "CIVIL_DEFENSE" | "CHAMBER" | "OTHER";

export interface ComplianceItem {
  id: string;
  category: ComplianceCategory;
  title: string;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string;
  risk_level: RiskLevel;
  renewal_url: string | null;
  status: ItemStatus;
  days_remaining: number;
  action_required: boolean;
}

export type ComplianceItemInput = Pick<ComplianceItem, "category" | "title" | "expiry_date" | "risk_level"> &
  Partial<Pick<ComplianceItem, "reference_number" | "issue_date" | "renewal_url">>;

export type Pillar = "OPERATIONAL" | "GOVERNANCE_PDPL" | "CONTRACTS";

export interface ScoreReason {
  pillar: Pillar;
  severity: "critical" | "high" | "medium";
  text: string;
  points: number;
  points_label: string | null;
}

export interface Score {
  score: number | null;
  pillars: Partial<Record<Pillar, number | null>>;
  weights_used: Partial<Record<Pillar, number>>;
  capped_by_critical_expiry: boolean;
  reasons: ScoreReason[];
  computed_at: string | null;
}

export interface GovernanceSummary {
  available: boolean;
  last_meeting_title: string | null;
  last_meeting_date: string | null;
  last_meeting_status: string | null;
  doa_rules: number;
  doa_last_updated: string | null;
}

export interface PdplSummary {
  available: boolean;
  records: number;
  complete_records: number;
  completeness_pct: number | null;
  cross_border: number;
}

export interface Dashboard {
  org_name: string;
  cr_number: string;
  greeting_name: string;
  plan_tier: string | null;
  automation_active: boolean;
  score: Score;
  action_required: ComplianceItem[];
  counts: { active: number; expiring_soon: number; expired: number; policies_due: number };
  governance: GovernanceSummary;
  pdpl: PdplSummary;
}

export interface Membership { org_id: string; org_name: string; cr_number: string; role: string }
export interface Me {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  memberships: Membership[];
}
