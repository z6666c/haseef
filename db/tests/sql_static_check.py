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
    "_DPIA_COLS": "d.id, d.project_name, r.activity_name AS related_activity, ua.full_name, uc.full_name",
    "_DPIA_FROM": "FROM dpia_assessments d LEFT JOIN pdpl_data_records r ON r.id = d.related_record_id "
                  "LEFT JOIN users ua ON ua.id = d.approved_by LEFT JOIN users uc ON uc.id = d.created_by",
    "_ITEM_COLS": "id, category, title, reference_number, issue_date, expiry_date, risk_level, "
                  "renewal_url, metadata, status, days_remaining, action_required, created_at",
    "_POLICY_COLS": "id, policy_type, title, version, approval_date, review_due_date, status, "
                    "effective_status, days_remaining",
    "cond": "target_id IS NULL",
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
