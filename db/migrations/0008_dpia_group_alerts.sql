-- =====================================================================
-- 0008 — تقييم الأثر (DPIA)، المنشآت المتعددة، تقارير المجلس، شاشة التنبيهات
-- =====================================================================

-- ---------- تقييم الأثر: الاعتماد ورأي مسؤول حماية البيانات والخطر المتبقي ----------
ALTER TABLE dpia_assessments
    ADD COLUMN description      text,
    ADD COLUMN residual_score   smallint CHECK (residual_score BETWEEN 0 AND 100),
    ADD COLUMN residual_level   varchar(10) CHECK (residual_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    ADD COLUMN dpo_opinion      text,
    ADD COLUMN approved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN approved_at      timestamptz;
ALTER TABLE dpia_assessments
    ADD CONSTRAINT dpia_approved_has_approver CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
    ADD CONSTRAINT dpia_completed_has_date    CHECK (status = 'IN_PROGRESS' OR completed_at IS NOT NULL);

-- ---------- المنشآت المتعددة: الفروع والشركات التابعة ----------
-- parent_org_id موجود منذ 0001. مستوى واحد فقط: التابعة لا يكون لها تابعة.
CREATE INDEX IF NOT EXISTS idx_organizations_parent ON organizations(parent_org_id) WHERE parent_org_id IS NOT NULL;
ALTER TABLE organizations ADD COLUMN entity_relation varchar(12)
    CHECK (entity_relation IN ('SUBSIDIARY','BRANCH','AFFILIATE'));
ALTER TABLE organizations ADD CONSTRAINT org_relation_needs_parent
    CHECK ((parent_org_id IS NULL) = (entity_relation IS NULL));
ALTER TABLE organizations ADD CONSTRAINT org_not_own_parent CHECK (parent_org_id IS DISTINCT FROM id);

-- ---------- تقارير مجلس الإدارة: لقطة محفوظة لكل سنة عند الاعتماد ----------
CREATE TABLE board_reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    year            smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
    snapshot        jsonb NOT NULL,            -- بيانات التقرير كما كانت وقت الحفظ
    notes           text,                      -- تعليق الإدارة / خطاب الرئيس
    saved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    saved_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, year)
);
ALTER TABLE board_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON board_reports
    USING (org_id = app.current_org_id()) WITH CHECK (org_id = app.current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON board_reports TO haseef_app, haseef_platform;
