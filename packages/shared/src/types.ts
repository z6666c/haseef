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

export interface Score {
  score: number | null;
  pillars: Partial<Record<Pillar, number | null>>;
  weights_used: Partial<Record<Pillar, number>>;
  capped_by_critical_expiry: boolean;
  computed_at: string | null;
}

export interface Dashboard {
  org_name: string;
  plan_tier: string | null;
  score: Score;
  action_required: ComplianceItem[];
  counts: { active: number; expiring_soon: number; expired: number; policies_due: number };
}

export interface Membership { org_id: string; org_name: string; role: string }
export interface Me {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  memberships: Membership[];
}
