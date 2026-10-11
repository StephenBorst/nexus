// Make the ONE secret phone alerts need (VAPID_PRIVATE_JWK) and hand it straight to wrangler, so the
// key is never shown on screen or pasted anywhere. Run from workers/nexus-lab-api:
//
//   node ../../tools/push/vapid-keys.mjs | npx wrangler secret put VAPID_PRIVATE_JWK
//
// stdout = the key (for the pipe), stderr = the public half (safe to share, and the app reads it from
// /push/config anyway). ⚠️ Make it ONCE. A new key silently breaks every device already subscribed
// (the push services check each push against the key the device signed up with); they'd all have to
// switch alerts off and on again.
import crypto from "node:crypto";

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
process.stderr.write(`VAPID public key (not secret): ${pub}\n`);
process.stdout.write(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
