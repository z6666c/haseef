import hashlib
import json
import struct
import unittest
from datetime import datetime, time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from haseef.domain.attendance import distance_m, evaluate
from haseef.domain.webauthn import WebAuthnError, b64u, verify_assertion, verify_registration

RP, ORIGIN = "app.haseef.sa", "https://app.haseef.sa"
SITE = [{"id": "s1", "lat": 24.7136, "lng": 46.6753, "radius_m": 100, "max_accuracy_m": 100}]


def _cbor_bytes(b: bytes) -> bytes:
    return (bytes([0x58, len(b)]) if len(b) < 256 else bytes([0x59]) + struct.pack(">H", len(b))) + b


def _cose(pub) -> bytes:
    n = pub.public_numbers()
    x, y = n.x.to_bytes(32, "big"), n.y.to_bytes(32, "big")
    # {1: 2, 3: -7, -1: 1, -2: x, -3: y}
    return bytes([0xA5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]) + _cbor_bytes(x) + bytes([0x22]) + _cbor_bytes(y)


def _auth(flags: int, count: int, cred: bytes | None = None, cose: bytes | None = None, rp=RP) -> bytes:
    b = hashlib.sha256(rp.encode()).digest() + bytes([flags]) + struct.pack(">I", count)
    if cred:
        b += bytes(16) + struct.pack(">H", len(cred)) + cred + cose
    return b


def _cdj(typ: str, ch: str, origin=ORIGIN) -> bytes:
    return json.dumps({"type": typ, "challenge": b64u(ch.encode()), "origin": origin}).encode()


def _cd(typ: str, ch: str, origin=ORIGIN) -> str:
    return b64u(_cdj(typ, ch, origin))


class WebAuthnTest(unittest.TestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cose = _cose(self.key.public_key())
        att = {"fmt": "none", "attStmt": {}, "authData": _auth(0x45, 0, b"cred-123", self.cose)}
        # CBOR map {"fmt": "none", "attStmt": {}, "authData": bytes}
        ad = att["authData"]
        self.att_obj = b64u(bytes([0xA3, 0x63]) + b"fmt" + bytes([0x64]) + b"none" + bytes([0x67]) + b"attStmt" + bytes([0xA0])
                            + bytes([0x68]) + b"authData" + _cbor_bytes(ad))

    def test_register_and_assert(self):
        cred, cose, cnt = verify_registration(client_data_json=_cd("webauthn.create", "abc"), attestation_object=self.att_obj,
                                              challenge="abc", origin=ORIGIN, rp_id=RP)
        self.assertEqual((cred, cnt), (b64u(b"cred-123"), 0))
        adb = _auth(0x05, 7)
        cdj = _cd("webauthn.get", "xyz")
        sig = self.key.sign(adb + hashlib.sha256(_cdj("webauthn.get", "xyz")).digest(),
                            ec.ECDSA(hashes.SHA256()))
        n = verify_assertion(cose_key=cose, client_data_json=cdj, authenticator_data=b64u(adb), signature=b64u(sig),
                             challenge="xyz", origin=ORIGIN, rp_id=RP, prev_sign_count=3)
        self.assertEqual(n, 7)
        with self.assertRaises(WebAuthnError):          # تحدٍ مختلف
            verify_assertion(cose_key=cose, client_data_json=cdj, authenticator_data=b64u(adb), signature=b64u(sig),
                             challenge="other", origin=ORIGIN, rp_id=RP, prev_sign_count=0)
        with self.assertRaises(WebAuthnError):          # عداد متراجع
            verify_assertion(cose_key=cose, client_data_json=cdj, authenticator_data=b64u(adb), signature=b64u(sig),
                             challenge="xyz", origin=ORIGIN, rp_id=RP, prev_sign_count=9)
        with self.assertRaises(WebAuthnError):          # توقيع مزوّر
            verify_assertion(cose_key=cose, client_data_json=cdj, authenticator_data=b64u(adb), signature=b64u(b"0" * 70),
                             challenge="xyz", origin=ORIGIN, rp_id=RP, prev_sign_count=0)

    def test_rejects_wrong_origin_and_no_uv(self):
        with self.assertRaises(WebAuthnError):
            verify_registration(client_data_json=_cd("webauthn.create", "abc", "https://evil.example"), attestation_object=self.att_obj,
                                challenge="abc", origin=ORIGIN, rp_id=RP)
        adb = _auth(0x01, 1)                            # بلا UV
        cdj = _cd("webauthn.get", "q")
        sig = self.key.sign(adb + hashlib.sha256(_cdj("webauthn.get", "q")).digest(),
                            ec.ECDSA(hashes.SHA256()))
        with self.assertRaises(WebAuthnError):
            verify_assertion(cose_key=self.cose, client_data_json=cdj, authenticator_data=b64u(adb), signature=b64u(sig),
                             challenge="q", origin=ORIGIN, rp_id=RP, prev_sign_count=0)


class EvaluateTest(unittest.TestCase):
    """نفس الحالات في packages/shared/src/attendance.test.ts."""

    def ev(self, lat, acc=20, when=datetime(2026, 10, 11, 8, 30), **kw):
        return evaluate(lat=lat, lng=46.6753, accuracy=acc, sites=SITE, kind=kw.get("kind", "IN"), now_local=when,
                        work_start=time(8), grace_minutes=15, work_days=[0, 1, 2, 3, 4], last=kw.get("last"))

    def test_cases(self):
        self.assertEqual(round(distance_m(24.7136, 46.6753, 24.7138, 46.6753)), 22)
        r = self.ev(24.7140)
        self.assertEqual((r["status"], r["distance_m"], r["late_minutes"]), ("ACCEPTED", 44, 15))
        self.assertEqual(self.ev(24.7200)["reason"], "OUTSIDE")
        self.assertEqual(self.ev(24.7140, acc=150)["reason"], "LOW_ACCURACY")
        edge = self.ev(24.71465, acc=40)                      # ≈117م: داخل الهامش
        self.assertEqual((edge["status"], edge["flags"]), ("ACCEPTED", ["FAR_ACCURACY"]))
        self.assertIn("OFF_DAY", self.ev(24.7140, when=datetime(2026, 10, 9, 8, 0))["flags"])   # الجمعة
        self.assertEqual(self.ev(24.7140, when=datetime(2026, 10, 11, 8, 10))["late_minutes"], 0)
        far = self.ev(24.7140, last={"at": datetime(2026, 10, 11, 8, 25), "lat": 21.4858, "lng": 39.1925})   # جدة قبل 5 دقائق
        self.assertIn("IMPOSSIBLE_TRAVEL", far["flags"])


if __name__ == "__main__":
    unittest.main()
