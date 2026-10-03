"""الأدوار الأساسية في الهجرة لا تستخدم إلا صلاحيات معرّفة، والمحاسبة لا ترى المنشآت والدعم لا يرى المالية."""
import re
import unittest
from pathlib import Path

from haseef.permissions import ALL, PERMISSIONS, catalog

SQL = (Path(__file__).resolve().parents[3] / "db/migrations/0010_admin_roles.sql").read_text()


def seeded() -> dict[str, set[str]]:
    out = {}
    for code, arr in re.findall(r"\('(\w+)', '[^']+', '[^']+',\s*ARRAY\[([^\]]*)\]", SQL):
        out[code] = set(re.findall(r"'([\w.]+)'", arr))
    return out


class PermissionTests(unittest.TestCase):
    def test_unique_codes(self):
        self.assertEqual(len(ALL), len(PERMISSIONS))
        self.assertEqual(len(catalog()), len(PERMISSIONS))

    def test_seeded_roles_use_known_permissions(self):
        roles = seeded()
        self.assertEqual(set(roles), {"SUPPORT", "BILLING"})
        for code, perms in roles.items():
            self.assertTrue(perms <= ALL, (code, perms - ALL))

    def test_separation_of_duties(self):
        roles = seeded()
        self.assertNotIn("finance.view", roles["SUPPORT"])
        self.assertNotIn("orgs.view", roles["BILLING"])
        for r in roles.values():
            self.assertNotIn("team.manage", r)


if __name__ == "__main__":
    unittest.main()
