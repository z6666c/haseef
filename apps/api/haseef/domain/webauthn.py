"""تحقق WebAuthn (بصمة الجوال / Face ID) دون مكتبات إضافية غير cryptography.

نطلب attestation = "none" ولا نثق بشهادة الجهاز؛ ما يهمنا أن المفتاح الخاص لا يغادر الجهاز وأن كل تسجيل
يُوقَّع بعد تحقق المستخدم (UV) على نفس الجهاز المربوط. المرجع: W3C Web Authentication Level 2 §7.1 و§7.2.
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa


class WebAuthnError(ValueError):
    pass


def b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


# ---------------------------------------------------------------- CBOR (المجموعة اللازمة فقط)
def _cbor(b: bytes, i: int = 0):
    ib = b[i]; major, info = ib >> 5, ib & 31; i += 1
    if info < 24:
        val = info
    elif info == 24:
        val = b[i]; i += 1
    elif info == 25:
        val = struct.unpack(">H", b[i:i + 2])[0]; i += 2
    elif info == 26:
        val = struct.unpack(">I", b[i:i + 4])[0]; i += 4
    elif info == 27:
        val = struct.unpack(">Q", b[i:i + 8])[0]; i += 8
    else:
        raise WebAuthnError("CBOR غير مدعوم")
    if major == 0:
        return val, i
    if major == 1:
        return -1 - val, i
    if major == 2:
        return b[i:i + val], i + val
    if major == 3:
        return b[i:i + val].decode(), i + val
    if major == 4:
        out = []
        for _ in range(val):
            x, i = _cbor(b, i); out.append(x)
        return out, i
    if major == 5:
        out = {}
        for _ in range(val):
            k, i = _cbor(b, i); v, i = _cbor(b, i); out[k] = v
        return out, i
    if major == 7 and info in (20, 21, 22):
        return {20: False, 21: True, 22: None}[info], i
    raise WebAuthnError("CBOR غير مدعوم")


def cbor_loads(b: bytes):
    v, _ = _cbor(b)
    return v


def cbor_item_len(b: bytes) -> int:
    _, i = _cbor(b)
    return i


# ---------------------------------------------------------------- بيانات المصادقة
@dataclass
class AuthData:
    rp_id_hash: bytes
    flags: int
    sign_count: int
    credential_id: bytes | None = None
    cose_key: bytes | None = None

    @property
    def user_present(self) -> bool:
        return bool(self.flags & 0x01)

    @property
    def user_verified(self) -> bool:
        return bool(self.flags & 0x04)


def parse_auth_data(b: bytes) -> AuthData:
    if len(b) < 37:
        raise WebAuthnError("بيانات المصادقة ناقصة")
    ad = AuthData(b[:32], b[32], struct.unpack(">I", b[33:37])[0])
    if ad.flags & 0x40:                                   # AT: بيانات الاعتماد مرفقة (عند التسجيل)
        n = struct.unpack(">H", b[53:55])[0]
        ad.credential_id = b[55:55 + n]
        rest = b[55 + n:]
        ad.cose_key = rest[:cbor_item_len(rest)]
    return ad


def _client_data(cdj: bytes, typ: str, challenge: str, origin: str) -> None:
    try:
        c = json.loads(cdj)
    except ValueError as e:
        raise WebAuthnError("clientData غير صالح") from e
    if c.get("type") != typ:
        raise WebAuthnError("نوع العملية غير صحيح")
    if c.get("challenge") != b64u(challenge.encode()):     # المتصفح يرمّز بايتات التحدي بـ base64url
        raise WebAuthnError("رمز التحدي غير مطابق")
    if c.get("origin") != origin:
        raise WebAuthnError("مصدر الطلب غير مطابق")


def _check_flags(ad: AuthData, rp_id: str) -> None:
    if ad.rp_id_hash != hashlib.sha256(rp_id.encode()).digest():
        raise WebAuthnError("النطاق غير مطابق")
    if not ad.user_present or not ad.user_verified:
        raise WebAuthnError("يلزم التحقق ببصمة الجهاز أو رمزه")


def verify_registration(*, client_data_json: str, attestation_object: str, challenge: str, origin: str, rp_id: str) -> tuple[str, bytes, int]:
    """يُرجع (معرّف الاعتماد base64url، مفتاح COSE، العداد)."""
    cdj = b64u_decode(client_data_json)
    _client_data(cdj, "webauthn.create", challenge, origin)
    att = cbor_loads(b64u_decode(attestation_object))
    if not isinstance(att, dict) or "authData" not in att:
        raise WebAuthnError("attestation غير صالح")
    ad = parse_auth_data(att["authData"])
    _check_flags(ad, rp_id)
    if not ad.credential_id or not ad.cose_key:
        raise WebAuthnError("لا توجد بيانات اعتماد")
    load_public_key(ad.cose_key)                          # يرفض الخوارزميات غير المدعومة مبكراً
    return b64u(ad.credential_id), ad.cose_key, ad.sign_count


def load_public_key(cose: bytes):
    k = cbor_loads(cose)
    kty, alg = k.get(1), k.get(3)
    if kty == 2 and alg == -7 and k.get(-1) == 1:         # EC2 P-256 / ES256
        x, y = k[-2], k[-3]
        return ec.EllipticCurvePublicNumbers(int.from_bytes(x, "big"), int.from_bytes(y, "big"), ec.SECP256R1()).public_key()
    if kty == 3 and alg == -257:                          # RSA / RS256
        return rsa.RSAPublicNumbers(int.from_bytes(k[-2], "big"), int.from_bytes(k[-1], "big")).public_key()
    raise WebAuthnError("خوارزمية المفتاح غير مدعومة")


def verify_assertion(*, cose_key: bytes, client_data_json: str, authenticator_data: str, signature: str, challenge: str,
                     origin: str, rp_id: str, prev_sign_count: int) -> int:
    """يتحقق من توقيع الجهاز ويُرجع العداد الجديد. يرفض العداد المتراجع (مؤشر نسخ المفتاح)."""
    cdj = b64u_decode(client_data_json)
    _client_data(cdj, "webauthn.get", challenge, origin)
    adb = b64u_decode(authenticator_data)
    ad = parse_auth_data(adb)
    _check_flags(ad, rp_id)
    msg = adb + hashlib.sha256(cdj).digest()
    sig = b64u_decode(signature)
    key = load_public_key(cose_key)
    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(sig, msg, ec.ECDSA(hashes.SHA256()))
        else:
            key.verify(sig, msg, padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature as e:
        raise WebAuthnError("توقيع البصمة غير صحيح") from e
    if ad.sign_count and prev_sign_count and ad.sign_count <= prev_sign_count:
        raise WebAuthnError("عداد الجهاز متراجع")
    return ad.sign_count
