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
    "_ITEM_COLS": "id, category, title, reference_number, issue_date, expiry_date, risk_level, "
                  "renewal_url, metadata, status, days_remaining, action_required, created_at",
    "_POLICY_COLS": "id, policy_type, title, version, approval_date, review_due_date, status, "
                    "effective_status, days_remaining",
    "cond": "target_id IS NULL",
    "sets": "id = id",          # تعديل ديناميكي: الأعمدة من نموذج Pydantic
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
