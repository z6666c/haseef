/** WebAuthn في المتصفح: ربط الجوال ببصمته (Face ID / البصمة) والتوقيع عند كل تسجيل حضور. */
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const enc = (s: string) => new TextEncoder().encode(s);

export const webauthnSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

export async function registerDevice(o: { rp_id: string; rp_name: string; challenge: string; user_id: string; user_name: string }) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: enc(o.challenge), rp: { id: o.rp_id, name: o.rp_name },
      user: { id: enc(o.user_id), name: o.user_name, displayName: o.user_name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      attestation: "none", timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("أُلغي ربط الجهاز");
  const r = cred.response as AuthenticatorAttestationResponse;
  return { credential_id: b64u(cred.rawId), client_data_json: b64u(r.clientDataJSON), attestation_object: b64u(r.attestationObject) };
}

export async function signWithDevice(o: { rp_id: string; challenge: string; credential_id: string }) {
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: enc(o.challenge), rpId: o.rp_id, userVerification: "required", timeout: 60000,
      allowCredentials: [{ type: "public-key", id: fromB64u(o.credential_id), transports: ["internal"] }] },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("أُلغي التحقق بالبصمة");
  const r = cred.response as AuthenticatorAssertionResponse;
  return { credential_id: b64u(cred.rawId), client_data_json: b64u(r.clientDataJSON), authenticator_data: b64u(r.authenticatorData), signature: b64u(r.signature) };
}
