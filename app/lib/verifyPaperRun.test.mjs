// public/verify/paper-run.mjs is the standalone script anyone can download and run to re-check a paper run. It must
// judge exactly as the app does (copies, not imports: it runs with no repo), touch only public reads, fetch bars only
// from Orderly's public chart endpoint, and catch a tampered fill, R or house wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as V from "../../public/verify/paper-run.mjs";
import { judgeFill, judgeTrigger, TAPE_TOL_BPS } from "./paperTape.mjs";
import { HOUSE_PAPER_IDS, HOUSE_PAPER_TAG } from "./housePaper.mjs";
import { tradeR } from "./paperRun.mjs";

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("the script's rules are the app's: tolerance, tag, house ids, fill + trigger judging, R", () => {
  assert.equal(V.TAPE_TOL_BPS, TAPE_TOL_BPS);
  assert.equal(V.HOUSE_PAPER_TAG, HOUSE_PAPER_TAG);
  for (const [read, id] of Object.entries(HOUSE_PAPER_IDS)) assert.equal(V.houseId(read), id, read);
  const r = rng(20261127);
  for (let i = 0; i < 3000; i++) {
    const t0 = 1795600000 + Math.floor(r() * 1e5) * 60, px = 50 + r() * 50;
    const bars = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => {
      const o = px * (1 + (r() - 0.5) * 0.004), h = o * (1 + r() * 0.002), l = o * (1 - r() * 0.002);
      return [t0 - (k + Math.floor(r() * 2)) * 60, o, h, l, (h + l) / 2];
    });
    const tMs = (t0 + Math.floor(r() * 60)) * 1000;
    assert.deepEqual(V.judgeFill(px, tMs, bars), judgeFill(px, tMs, bars));
    const level = { side: r() < 0.5 ? "STOP" : "TARGET", long: r() < 0.5, px: px * (1 + (r() - 0.5) * 0.006) };
    assert.deepEqual(V.judgeTrigger(level, tMs, bars), judgeTrigger(level, tMs, bars));
    const row = { entry_price: px, exit_price: px * (1 + (r() - 0.5) * 0.08), direction: r() < 0.5 ? "SHORT" : "LONG", sl_percent: 0.5 + r() * 4, reason: "TIMEOUT" };
    const app = tradeR(row), mine = V.tradeR({ entry: row.entry_price, exit: row.exit_price, side: row.direction, slPct: row.sl_percent });
    assert.equal(mine.r, app.r); assert.equal(mine.movePct, app.movePct);
  }
});

test("no dependencies, public reads only, bars only from Orderly's chart endpoint", () => {
  const src = readFileSync(new URL("../../public/verify/paper-run.mjs", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["node:crypto", "node:url"]);
  assert.doesNotMatch(src, /method:\s*"(POST|PUT|DELETE)"|privateKey|signMessage|writeFile/);
  assert.equal(V.isOrderlySource("https://api-evm.orderly.org/tv/history?symbol=PERP_ETH_USDC&resolution=1&from=1&to=2"), true);
  for (const u of ["http://api-evm.orderly.org/tv/history", "https://evil.test/tv/history", "https://api-evm.orderly.org.evil.test/tv/history", "https://api-evm.orderly.org/v1/withdraw", "nonsense"]) assert.equal(V.isOrderlySource(u), false, u);
});

// A small world: a house run with one closed trade and its two fills, and Orderly's reply for each fill's window.
const API = "https://api.test";
const READ = "oi_div_reversal";
const WALLET = HOUSE_PAPER_IDS[READ];
const OPEN_MS = 1795683701752, CLOSE_MS = 1795690000000;
const src = (sym, t) => `https://api-evm.orderly.org/tv/history?symbol=${sym}&resolution=1&from=${Math.floor(t / 60000) * 60 - 120}&to=${Math.floor(t / 60000) * 60 + 120}`;
const world = (over = {}) => {
  const entrySrc = src("PERP_LINK_USDC", OPEN_MS), exitSrc = src("PERP_LINK_USDC", CLOSE_MS);
  const em = Math.floor(OPEN_MS / 60000) * 60, xm = Math.floor(CLOSE_MS / 60000) * 60;
  const run = { ok: true, axis: READ, wallet: WALLET, house: true, target: 30, count: 1,
    trades: [{ n: 1, coin: "LINK", side: "LONG", openedAt: new Date(OPEN_MS).toISOString(), closedAt: new Date(CLOSE_MS).toISOString(),
      entry: 9.233, exit: 9.0, reason: "SL", r: -1.01, rBasis: "fill", slPct: 2.5 }], ...over.run };
  const tape = { ok: true, fills: [
    { key: "e", kind: "entry", symbol: "PERP_LINK_USDC", t: OPEN_MS, px: 9.233, verdict: "ON_TAPE", bar: [em, 9.239, 9.239, 9.229, 9.23], source: entrySrc },
    { key: "x", kind: "exit", symbol: "PERP_LINK_USDC", t: CLOSE_MS, px: 9.0, verdict: "ON_TAPE", bar: [xm, 9.01, 9.02, 8.99, 9.0], source: exitSrc, trigger: { verdict: "TRADED", side: "STOP", level: 9.002175 } },
    ...(over.extraFills || []),
  ] };
  const orderly = {
    [entrySrc]: { s: "ok", t: [em], o: [9.239], h: [9.239], l: [9.229], c: [9.23] },
    [exitSrc]: { s: "ok", t: [xm - 120, xm - 60, xm], o: [9.05, 9.03, 9.01], h: [9.06, 9.04, 9.02], l: [9.03, 9.0, 8.99], c: [9.03, 9.01, 9.0] },
    ...over.orderly,
  };
  const fetched = [];
  const fetchJson = async (u) => {
    fetched.push(u);
    if (u === `${API}/signals/paper-run/${READ}`) return run;
    if (u === `${API}/agent/${run.wallet}/tape`) return tape;
    if (over.unreachable && u.startsWith("https://api-evm")) throw new Error("blocked");
    if (u in orderly) return orderly[u];
    throw new Error(`unexpected fetch ${u}`);
  };
  return { fetchJson, fetched, run, tape };
};
const go = (w) => V.verifyRun(READ, { api: API, fetchJson: w.fetchJson, pauseMs: 0 });

test("an honest run: keyless wallet confirmed, both fills and the trigger agree on Orderly's bars, R agrees", async () => {
  const res = await go(world());
  assert.equal(res.ok, true, res.lines.join("\n"));
  assert.match(res.lines.join("\n"), /keyless/);
  assert.match(res.lines.join("\n"), /2 of 2 fills re-judged on Orderly's own bars agree/);
  assert.match(res.lines.join("\n"), /1 of 1 trades: R re-derived/);
});

test("it catches a tampered fill, a tampered trigger, a tampered R and a wallet that isn't the house id", async () => {
  const w1 = world(); w1.tape.fills[0].px = 9.4; // outside the minute's range, still marked ON_TAPE
  assert.match((await go(w1)).problems.join("\n"), /LINK entry .* says ON_TAPE, Orderly's bar says OFF/);
  const w2 = world(); w2.tape.fills[1].trigger.level = 8.5; // a stop the tape never reached, still marked TRADED
  assert.match((await go(w2)).problems.join("\n"), /stop check says TRADED, Orderly's bars say MARK_ONLY/);
  const w3 = world(); w3.run.trades[0].r = -0.5;
  assert.match((await go(w3)).problems.join("\n"), /R re-derived -1\.01, served -0\.5/);
  const w4 = world({ run: { wallet: "0x" + "1".repeat(40) } });
  assert.match((await go(w4)).problems.join("\n"), /isn't 0x41783694/);
});

test("a check pointing anywhere but Orderly is never fetched; an unreachable Orderly falls back to the stored bar, named", async () => {
  const w = world({ extraFills: [{ key: "z", kind: "entry", symbol: "PERP_ETH_USDC", t: OPEN_MS, px: 1, verdict: "ON_TAPE", source: "https://evil.test/tv/history?x=1" }] });
  const res = await go(w);
  assert.ok(!w.fetched.some((u) => u.includes("evil.test")));
  assert.match(res.lines.join("\n"), /1 fills not checkable/);
  const u = world({ unreachable: true });
  const ru = await go(u);
  assert.equal(ru.ok, true);
  assert.match(ru.lines.join("\n"), /2 fills re-judged on the bar their check kept.*not the source/);
  const tampered = world({ unreachable: true }); tampered.tape.fills[0].px = 9.4;
  assert.match((await go(tampered)).problems.join("\n"), /its own stored bar says OFF/);
});
