"""يتأكد أن التطبيق وكل الموجّهات تُستورد وتُسجَّل (يكشف أخطاء الأسماء والاستيراد مبكراً)."""

import importlib.util
import unittest


@unittest.skipUnless(importlib.util.find_spec("fastapi"), "fastapi غير مثبت")
class AppImports(unittest.TestCase):
    def test_routes_registered(self):
        from haseef.main import app
        paths = {r.path for r in app.routes}
        for p in ("/pdpl/dpia", "/group", "/reports/board", "/alerts/overview", "/legal/rates"):
            self.assertIn("/v1" + p, paths)


if __name__ == "__main__":
    unittest.main()
