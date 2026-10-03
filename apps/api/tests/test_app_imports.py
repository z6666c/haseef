"""يتأكد أن التطبيق وكل الموجّهات تُستورد وتُسجَّل (يكشف أخطاء الأسماء والاستيراد مبكراً)."""

import importlib.util
import os
import unittest


@unittest.skipUnless(importlib.util.find_spec("fastapi"), "fastapi غير مثبت")
class AppImports(unittest.TestCase):
    def test_routes_registered(self):
        os.environ["HASEEF_AUTO_MIGRATE"] = "false"      # لا قاعدة بيانات في هذا الاختبار
        from haseef.main import app
        paths = set(app.openapi()["paths"])
        for p in ("/pdpl/dpia", "/group", "/reports/board", "/alerts/overview", "/legal/rates", "/public/trial-requests", "/admin/trial-requests"):
            self.assertIn("/v1" + p, paths)


if __name__ == "__main__":
    unittest.main()
