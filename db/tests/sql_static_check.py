"""يستخرج كل استعلام text(...) من كود الخادم ويشغّل عليه EXPLAIN في PostgreSQL،
بعد استبدال المعاملات (:name) بـ NULL. يكشف أسماء الأعمدة الخاطئة وأخطاء الصياغة
دون الحاجة لتثبيت SQLAlchemy أو تشغيل الخادم.

    DB=haseef_test python3 db/tests/sql_static_check.py apps/api/haseef
"""
import ast
import os
import pathlib
import re
import subprocess
import sys

FRAGMENTS = {
    "EVENT_COLS": "id, code, name, event_date, kind, is_holiday, holiday_days, greeting, notify_subscribers, is_active",
    "PLAN_COLS": 'p.id, p.org_id, o.name AS org_name, p.plan_tier, p.total_net, p.installments, p.starts_on, p.ends_on, p.status, p.note, p.created_at, COALESCE(sum(i.amount_net) FILTER (WHERE i.paid_at IS NOT NULL), 0) AS paid_net, COALESCE(sum(i.amount_net) FILTER (WHERE i.paid_at IS NULL), 0) AS remaining_net, count(*) FILTER (WHERE i.paid_at IS NOT NULL) AS paid_count, min(i.due_date) FILTER (WHERE i.paid_at IS NULL) AS next_due, count(*) FILTER (WHERE i.paid_at IS NULL AND i.due_date < :today) AS overdue_count',
    "_DUE": "SELECT i.id, i.seq, i.due_date, i.amount_net, p.org_id, p.installments, o.name AS org_name FROM plan_installments i JOIN payment_plans p ON p.id = i.plan_id JOIN organizations o ON o.id = p.org_id WHERE i.paid_at IS NULL AND p.status = 'ACTIVE' AND o.is_active AND o.suspended_at IS NULL",
    "_DPIA_COLS": "d.id, d.project_name, r.activity_name AS related_activity, ua.full_name, uc.full_name",
    "_DPIA_FROM": "FROM dpia_assessments d LEFT JOIN pdpl_data_records r ON r.id = d.related_record_id "
                  "LEFT JOIN users ua ON ua.id = d.approved_by LEFT JOIN users uc ON uc.id = d.created_by",
    "_ITEM_COLS": "id, category, title, reference_number, issue_date, expiry_date, risk_level, "
                  "renewal_url, metadata, status, days_remaining, action_required, created_at",
    "_POLICY_COLS": "id, policy_type, title, version, approval_date, review_due_date, status, "
                    "effective_status, days_remaining",
    "cond": "target_id IS NULL",
    "EMP_COLS": "id, full_name, nationality, job_title, start_date, gosi_system, basic_wage, housing_allowance, gosi_registered, qiwa_contract_documented, contract_end_date, probation_end_date, iqama_expiry, work_permit_expiry, is_active, left_on, mobile",
    "EMP_INS_COLS": "full_name, nationality, job_title, start_date, gosi_system, basic_wage, housing_allowance, gosi_registered, qiwa_contract_documented, contract_end_date, probation_end_date, iqama_expiry, work_permit_expiry, mobile",
    "EMP_INS_VALS": ":full_name, :nationality, :job_title, :start_date, :gosi_system, :basic_wage, :housing_allowance, :gosi_registered, :qiwa_contract_documented, :contract_end_date, :probation_end_date, :iqama_expiry, :work_permit_expiry, :mobile",
    "EMP_SETS": "full_name = :full_name, basic_wage = :basic_wage",
    "sets": "id = id",          # تعديل ديناميكي: الأعمدة من نموذج Pydantic
    "', '.join(PROFILE_FIELDS)": "employees_count, fiscal_year_end_month, processes_personal_data, vat_registered, "
                                 "has_bylaws, bylaws_updated_on, auditor_name, auditor_appointed_on, "
                                 "beneficial_owners_filed_on, last_assembly_on, last_fs_filed_on",
    "_LIB_COLS": "id, kind, category, title, summary, url, file_name, file_mime, file_size, policy_type, "
                 "applies_legal_types, related_codes, review_status, version, updated_at",
    "_LIB_ADMIN_COLS": "d.id, d.slug, d.kind, d.title, cu.full_name AS created_by_name, uu.full_name AS updated_by_name",
    "_plan_ok(t)": "true",
    "_REC_COLS": "r.id, r.activity_name, u.full_name AS owner_name",
    "_REC_FROM": "FROM pdpl_data_records r LEFT JOIN memberships m ON m.id = r.owner_membership_id LEFT JOIN users u ON u.id = m.user_id",
    "_REQ_COLS": "id, requester_name, (due_on - app.today_riyadh()) AS days_left",
    "_INC_COLS": "id, title, discovered_at + interval '72 hours' AS notify_deadline",
    "NOTIFY_HOURS": "72",
    "_C_COLS": "c.id, r.title AS topic_title, l.full_name AS lawyer_name",
    "_C_FROM": "FROM legal_consultations c JOIN legal_rates r ON r.topic = c.topic LEFT JOIN legal_lawyers l ON l.id = c.lawyer_id",
    "profile_sets": "employees_count = employees_count",
    "table": "gov_standards",   # تعديل عام لكتالوجات المحتوى
    "key_col": "code",
    "', '.join(cols)": "title = title",
}
PSQL = os.environ.get("PSQL", "psql")


def statements(root: pathlib.Path):
    for p in sorted(root.rglob("*.py")):
        for node in ast.walk(ast.parse(p.read_text())):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "text" and node.args):
                continue
            a = node.args[0]
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                yield f"{p}:{node.lineno}", a.value
            elif isinstance(a, ast.JoinedStr):
                sql = "".join(v.value if isinstance(v, ast.Constant) else FRAGMENTS.get(ast.unparse(v.value), "NULL")
                              for v in a.values)
                yield f"{p}:{node.lineno}", sql


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "apps/api/haseef")
    ok = fail = 0
    for loc, sql in statements(root):
        s = re.sub(r"(?<![:\w]):([a-z_]+)", "NULL", sql).strip().rstrip(";")
        s = s.replace("ANY(NULL)", "ANY(NULL::text[])")
        body = s + ";" if s.upper().startswith("SELECT SET_CONFIG") else f"EXPLAIN {s};"
        q = f"BEGIN; SET LOCAL ROLE haseef_platform; {body} ROLLBACK;"
        r = subprocess.run([PSQL, "-X", "-v", "ON_ERROR_STOP=1", "-q", "-d", os.environ["DB"], "-c", q],
                           capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
        if r.returncode:
            fail += 1
            print("FAIL", loc, "→", (r.stderr.strip().splitlines() or ["?"])[0])
        else:
            ok += 1
    print(f"{ok} SQL statements OK, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
