// ── Web Push, sent from the worker (RFC 8291 payload encryption + RFC 8292 VAPID) ──
// Phone alerts for the Android app (a TWA around the site) and any browser that allows push.
// Built on Web Crypto only, so it runs in a Cloudflare Worker with no Node polyfills.
//
// One secret: VAPID_PRIVATE_JWK = the P-256 key as a JWK ({kty,crv,x,y,d}). Its public half is
// derived from it (x,y), so the browser key and the signing key can't drift apart. Unset = push off.
// Generate it with `node tools/push/vapid-keys.mjs` and set it with `npx wrangler secret put
// VAPID_PRIVATE_JWK` from workers/nexus-lab-api. Never commit it, never paste it in chat.

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Parse the VAPID secret. null when unset or malformed (push then stays off, never throws). */
export function parseVapidJwk(raw) {
  if (!raw) return null;
  let jwk;
  try { jwk = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || !jwk.d) return null;
  try {
    if (b64u.decode(jwk.x).length !== 32 || b64u.decode(jwk.y).length !== 32 || b64u.decode(jwk.d).length !== 32) return null;
  } catch { return null; }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d };
}

/** The applicationServerKey the browser subscribes with: 0x04 || x || y, base64url. */
export function vapidPublicKey(jwk) {
  return b64u.encode(concat(new Uint8Array([4]), b64u.decode(jwk.x), b64u.decode(jwk.y)));
}

/**
 * `Authorization: vapid t=<jwt>, k=<public key>` for one push service (RFC 8292). The JWT's
 * audience is the push service's origin; it expires in ≤12h (services refuse >24h).
 */
export async function vapidAuthorization(endpoint, jwk, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // Web Crypto's ECDSA signature is already r||s (64 bytes), which is what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${vapidPublicKey(jwk)}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/**
 * Encrypt one message for one subscription (RFC 8291, "aes128gcm", a single record).
 * `p256dh` / `auth` are the subscription's keys as the browser gives them (base64url).
 * `opts.salt` / `opts.serverKeys` exist for tests only; real sends use fresh random ones.
 * @returns {Promise<Uint8Array>} the request body
 */
export async function encryptPayload(plaintext, p256dh, auth, opts = {}) {
  const uaPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh key");
  if (authSecret.length !== 16) throw new Error("bad auth secret");

  const serverKeys = opts.serverKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const body = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  // One record: the data, then the 0x02 "last record" delimiter, no extra padding.
  const padded = concat(body, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, padded));

  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096, big-endian
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

// Push services cap the body at 4096 bytes; the header + tag + delimiter take 103 of them.
export const MAX_PUSH_JSON = 3000;

/**
 * Send one notification. Never throws: returns { ok, status, gone } where `gone` means the
 * subscription is dead (404/410) and should be deleted.
 */
export async function sendWebPush(sub, payload, { jwk, subject, ttl = 86400, urgency = "normal", topic, fetchImpl = fetch } = {}) {
  try {
    let text = JSON.stringify(payload);
    if (text.length > MAX_PUSH_JSON) text = JSON.stringify({ ...payload, body: String(payload.body || "").slice(0, 300) });
    const body = await encryptPayload(text, sub.keys.p256dh, sub.keys.auth);
    const headers = {
      Authorization: await vapidAuthorization(sub.endpoint, jwk, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    };
    // Topic collapses an undelivered older push with the same tag (≤32 url-safe chars).
    if (topic && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.Topic = topic;
    const res = await fetchImpl(sub.endpoint, { method: "POST", headers, body });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e?.message || e) };
  }
}
