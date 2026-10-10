// Web Push crypto, checked against an INDEPENDENT implementation (node:crypto's ECDH/HKDF/AES-GCM),
// so a bug in webpush.mjs can't hide behind the same bug in the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { b64u, encryptPayload, parseVapidJwk, vapidPublicKey, vapidAuthorization, sendWebPush } from "./webpush.mjs";

// A browser's subscription keys, made the way a browser makes them.
function fakeBrowser() {
  const ecdh = nodeCrypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return { ecdh, p256dh: b64u.encode(ecdh.getPublicKey()), auth: b64u.encode(auth), authBuf: auth };
}

// RFC 8291 decryption, written against the RFC with node:crypto only.
function decrypt(body, browser) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const ecdhSecret = browser.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), browser.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(nodeCrypto.hkdfSync("sha256", ecdhSecret, browser.authBuf, keyInfo, 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = nodeCrypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(padded[padded.length - 1], 2, "last-record delimiter");
  return padded.subarray(0, padded.length - 1).toString("utf8");
}

function makeJwk() {
  const { privateKey } = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ format: "jwk" });
}

test("a browser can decrypt what we send (RFC 8291 aes128gcm)", async () => {
  const br = fakeBrowser();
  const msg = JSON.stringify({ title: "Call graded", body: "BTC LONG hit target — +1.5R", url: "/feed" });
  const body = await encryptPayload(msg, br.p256dh, br.auth);
  assert.equal(decrypt(body, br), msg);
});

test("every send uses a fresh salt and server key", async () => {
  const br = fakeBrowser();
  const a = await encryptPayload("x", br.p256dh, br.auth);
  const b = await encryptPayload("x", br.p256dh, br.auth);
  assert.notDeepEqual(Buffer.from(a.subarray(0, 16)), Buffer.from(b.subarray(0, 16)));
  assert.notDeepEqual(Buffer.from(a.subarray(21, 86)), Buffer.from(b.subarray(21, 86)));
});

test("bad subscription keys are refused, not sent", async () => {
  const br = fakeBrowser();
  await assert.rejects(encryptPayload("x", "AAAA", br.auth), /p256dh/);
  await assert.rejects(encryptPayload("x", br.p256dh, b64u.encode(new Uint8Array(8))), /auth/);
});

test("VAPID: the JWT verifies with the public key we hand the browser", async () => {
  const jwk = parseVapidJwk(JSON.stringify(makeJwk()));
  assert.ok(jwk);
  const pub = b64u.decode(vapidPublicKey(jwk));
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 4);
  const now = 1_790_000_000;
  const h = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", jwk, "https://nexustradinglabs.com", now);
  const m = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, h);
  assert.equal(m[2], vapidPublicKey(jwk));
  const [hd, cl, sig] = m[1].split(".");
  const claims = JSON.parse(Buffer.from(b64u.decode(cl)).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "https://nexustradinglabs.com");
  assert.ok(claims.exp > now && claims.exp <= now + 24 * 3600, "push services refuse exp > 24h");
  const keyObj = nodeCrypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  const ok = nodeCrypto.verify("sha256", Buffer.from(`${hd}.${cl}`), { key: keyObj, dsaEncoding: "ieee-p1363" }, Buffer.from(b64u.decode(sig)));
  assert.ok(ok, "ES256 signature verifies");
});

test("a malformed or missing secret means push is off, never a crash", () => {
  assert.equal(parseVapidJwk(undefined), null);
  assert.equal(parseVapidJwk("not json"), null);
  assert.equal(parseVapidJwk(JSON.stringify({ kty: "EC", crv: "P-256", x: "a", y: "b" })), null);
  const pubOnly = makeJwk(); delete pubOnly.d;
  assert.equal(parseVapidJwk(JSON.stringify(pubOnly)), null);
});

test("sendWebPush: right headers, decryptable body, 410 = gone", async () => {
  const br = fakeBrowser();
  const jwk = parseVapidJwk(makeJwk());
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { status: 201 }; };
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", keys: { p256dh: br.p256dh, auth: br.auth } };
  const r = await sendWebPush(sub, { title: "t", body: "b" }, { jwk, subject: "https://nexustradinglabs.com", topic: "agent", fetchImpl });
  assert.deepEqual(r, { ok: true, status: 201, gone: false });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(seen.init.headers.TTL, "86400");
  assert.equal(seen.init.headers.Topic, "agent");
  assert.match(seen.init.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(seen.init.body, br)), { title: "t", body: "b" });

  const gone = await sendWebPush(sub, { title: "t" }, { jwk, subject: "x", fetchImpl: async () => ({ status: 410 }) });
  assert.equal(gone.gone, true);
  const boom = await sendWebPush(sub, { title: "t" }, { jwk, subject: "x", fetchImpl: async () => { throw new Error("net"); } });
  assert.equal(boom.ok, false);
  assert.equal(boom.gone, false);
});
