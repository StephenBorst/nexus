import { test } from "node:test";
import assert from "node:assert";
import { okxOnce, okxGetAll, okxBackoffMs } from "./okx.mjs";

// A fake Response: status, a headers.get, and text(). `body` = object (JSON) or string (raw).
const resp = (body, { status = 200, headers = {} } = {}) => ({
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const OK = (data = [{ last: "100" }]) => resp({ code: "0", data });
const LIMITED = () => resp({ code: "50011", msg: "Too Many Requests" });

// Scripted fetch: per-URL queues of responses (the last one repeats); counts calls per URL.
function scripted(map) {
  const calls = {};
  const fetchImpl = async (url) => {
    calls[url] = (calls[url] || 0) + 1;
    const q = map[url];
    if (!q) throw new Error(`unexpected url ${url}`);
    const r = q.length > 1 ? q.shift() : q[0];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchImpl, calls };
}
const noRandom = () => 0;

test("okxOnce: code 0 is ok; a non-zero code is retryable and names the code", async () => {
  const a = await okxOnce("u", async () => OK());
  assert.equal(a.ok, true);
  const b = await okxOnce("u", async () => LIMITED());
  assert.equal(b.ok, false);
  assert.equal(b.retryable, true);
  assert.match(b.reason, /okx 50011 Too Many Requests/);
});

test("okxOnce: 51001 (no such instrument) is NOT retryable", async () => {
  const r = await okxOnce("u", async () => resp({ code: "51001", msg: "Instrument ID does not exist" }));
  assert.equal(r.retryable, false);
});

test("okxOnce: HTTP 429, an HTML page and a thrown fetch are all retryable, with a reason", async () => {
  const r429 = await okxOnce("u", async () => resp("slow down", { status: 429, headers: { "retry-after": "2" } }));
  assert.deepEqual([r429.ok, r429.retryable, r429.retryAfter], [false, true, "2"]);
  const html = await okxOnce("u", async () => resp("<html>challenge</html>", { status: 403 }));
  assert.match(html.reason, /HTTP 403 non-JSON/);
  assert.equal(html.retryable, true);
  const net = await okxOnce("u", async () => { throw new Error("connection reset"); });
  assert.match(net.reason, /network: connection reset/);
  assert.equal(net.retryable, true);
});

test("okxGetAll: retries a rate limit with growing backoff, then succeeds", async () => {
  const { fetchImpl, calls } = scripted({ u: [LIMITED(), LIMITED(), OK()] });
  const slept = [];
  const r = await okxGetAll(["u"], { fetchImpl, sleep: async (ms) => slept.push(ms), random: noRandom });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.equal(calls.u, 3);
  assert.deepEqual(slept, [500, 1000], "exponential, outside OKX's 2s window by the 3rd try");
});

test("okxGetAll: a retry re-fetches the WHOLE group (spot is never paired stale with a fresh perp)", async () => {
  const { fetchImpl, calls } = scripted({ spot: [OK()], perp: [LIMITED(), OK()] });
  const r = await okxGetAll(["spot", "perp"], { fetchImpl, sleep: async () => {}, random: noRandom });
  assert.equal(r.ok, true);
  assert.equal(calls.spot, 2, "spot was fine the first time and is still re-read with the perp");
  assert.equal(calls.perp, 2);
});

test("okxGetAll: a permanent code stops at once; exhausted tries return the last reason", async () => {
  const perm = scripted({ u: [resp({ code: "51001", msg: "nope" })] });
  const p = await okxGetAll(["u"], { fetchImpl: perm.fetchImpl, sleep: async () => {}, random: noRandom });
  assert.deepEqual([p.ok, p.attempts, perm.calls.u], [false, 1, 1]);

  const dead = scripted({ u: [LIMITED()] });
  const d = await okxGetAll(["u"], { tries: 4, fetchImpl: dead.fetchImpl, sleep: async () => {}, random: noRandom });
  assert.deepEqual([d.ok, d.attempts, dead.calls.u], [false, 4, 4]);
  assert.match(d.reason, /50011/);
});

test("okxGetAll: Retry-After wins (capped at 4s)", async () => {
  const { fetchImpl } = scripted({ u: [resp("x", { status: 429, headers: { "retry-after": "2" } }), OK()] });
  const slept = [];
  await okxGetAll(["u"], { fetchImpl, sleep: async (ms) => slept.push(ms), random: noRandom });
  assert.deepEqual(slept, [2000]);
  assert.equal(okxBackoffMs(0, "60", noRandom), 4000);
});

test("okxGetAll: never sleeps past the deadline — it stops and says so", async () => {
  const { fetchImpl, calls } = scripted({ u: [LIMITED()] });
  const slept = [];
  const r = await okxGetAll(["u"], {
    fetchImpl, sleep: async (ms) => slept.push(ms), random: noRandom, now: () => 1000, deadline: 1200,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /out of time/);
  assert.deepEqual(slept, []);
  assert.equal(calls.u, 1);
});
