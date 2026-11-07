// The exchange-side backstop stop (backstop.mjs) and where exec places / cancels it (index.js, pinned
// by source position: index.js isn't importable without the worker runtime). No network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BACKSTOP_MULT, BACKSTOP_CLEANUP_TRIES, backstopWanted, backstopTrigger, backstopOrder, algoOrderIdFrom,
  cancelPath, algoTerminal, backstopHit, sweepStaleBackstops,
} from "./backstop.mjs";

const live = { symbol: "PERP_ETH_USDC", direction: "LONG", entry_price: 2000, slPercent: 1, paper: false };

test("the plan's number: 1.5× the stop distance (live-plan-level-reclaim.md §5)", () => {
  assert.equal(BACKSTOP_MULT, 1.5);
  const plan = readFileSync(new URL("../../docs/research/live-plan-level-reclaim.md", import.meta.url), "utf8");
  assert.match(plan, /at 1\.5× the graded stop/);
});

test("backstopWanted: live single-entry positions with an entry and a stop only", () => {
  assert.equal(backstopWanted(live), true);
  assert.equal(backstopWanted({ ...live, direction: "SHORT" }), true);
  assert.equal(backstopWanted({ ...live, paper: true }), false, "paper touches no exchange");
  assert.equal(backstopWanted({ ...live, dca: { maxSafetyOrders: 3 } }), false, "DCA ladders add below entry by design");
  for (const bad of [{ slPercent: 0 }, { slPercent: -1 }, { slPercent: undefined }, { entry_price: 0 }, { entry_price: "x" }, { direction: "NONE" }]) {
    assert.equal(backstopWanted({ ...live, ...bad }), false, JSON.stringify(bad));
  }
  assert.equal(backstopWanted(null), false);
});

test("backstopTrigger: 1.5× the stop beyond the entry, snapped AWAY from the entry", () => {
  assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 2000, slPercent: 1, quoteTick: 0.01 }), 1970);
  assert.equal(backstopTrigger({ direction: "SHORT", entryPrice: 2000, slPercent: 1, quoteTick: 0.01 }), 2030);
  // 101.37 × (1 − 0.0075) = 100.609725 → long floors to 100.6; short 102.130275 ceils to 102.14
  assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 101.37, slPercent: 0.5, quoteTick: 0.01 }), 100.6);
  assert.equal(backstopTrigger({ direction: "SHORT", entryPrice: 101.37, slPercent: 0.5, quoteTick: 0.01 }), 102.14);
  // a coarse tick (BTC 0.1) and a fine one
  assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 95000.05, slPercent: 0.75, quoteTick: 0.1 }), 93931.2);
  assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 0.123456, slPercent: 2, quoteTick: 0.000001 }), 0.119752);
  // never tighter than asked, whatever the rounding
  for (const entry of [1.23, 17.77, 333.3, 2999.99, 64123.4]) {
    for (const sl of [0.3, 0.75, 1.2, 4]) {
      const lo = backstopTrigger({ direction: "LONG", entryPrice: entry, slPercent: sl, quoteTick: 0.01 });
      const hi = backstopTrigger({ direction: "SHORT", entryPrice: entry, slPercent: sl, quoteTick: 0.01 });
      assert.ok(lo <= entry * (1 - 1.5 * sl / 100) + 1e-9, `long ${entry} ${sl}`);
      assert.ok(hi >= entry * (1 + 1.5 * sl / 100) - 1e-9, `short ${entry} ${sl}`);
    }
  }
  assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 2000, slPercent: 1 }), 1970, "no tick = unrounded");
  assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 2000, slPercent: 70 }), null, "a long stop at or below zero isn't a stop");
  for (const bad of [{ entryPrice: 0 }, { slPercent: 0 }, { direction: "FLAT" }, { mult: 0 }]) {
    assert.equal(backstopTrigger({ direction: "LONG", entryPrice: 2000, slPercent: 1, ...bad }), null, JSON.stringify(bad));
  }
});

test("backstopOrder: a position stop-loss exactly as Orderly's SDK builds one", () => {
  const b = backstopOrder({ symbol: "PERP_ETH_USDC", direction: "LONG", triggerPrice: 1970 });
  assert.deepEqual(b, {
    algo_type: "POSITIONAL_TP_SL", trigger_price_type: "MARK_PRICE", symbol: "PERP_ETH_USDC", margin_mode: "CROSS",
    child_orders: [{ algo_type: "STOP_LOSS", reduce_only: true, side: "SELL", type: "CLOSE_POSITION", trigger_price: 1970, trigger_price_type: "MARK_PRICE", symbol: "PERP_ETH_USDC", is_activated: true }],
  });
  assert.equal(backstopOrder({ symbol: "PERP_ETH_USDC", direction: "SHORT", triggerPrice: 2030 }).child_orders[0].side, "BUY");
  assert.equal(b.child_orders.length, 1, "a stop only: no take-profit on the exchange");
  assert.equal("quantity" in b, false, "a positional stop closes whatever is left (partials need no resize)");
});

// Pinned to the SDK version the lockfile installs (CLAUDE.md: SDK = 3.4.0). A stale local install
// (an older version on disk than yarn.lock) is skipped with a note; CI installs from the lockfile.
const sdkFile = (pkg) => {
  try {
    const root = new URL(`../../node_modules/@orderly.network/${pkg}/`, import.meta.url);
    const lock = readFileSync(new URL("../../yarn.lock", import.meta.url), "utf8");
    const want = lock.match(new RegExp(`"@orderly\\.network/${pkg}@npm:[^"]+":\\s*\\n\\s*version: ([^\\s]+)`))?.[1];
    const have = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
    if (want && have !== want) return { skip: `node_modules has @orderly.network/${pkg} ${have}, yarn.lock pins ${want}` };
    return { src: readFileSync(new URL("dist/index.mjs", root), "utf8") };
  } catch { return { skip: "SDK not installed (workers-only checkout)" }; }
};

test("the SDK still builds a position stop with these fields (re-check after an SDK bump)", (t) => {
  const { src: sdk, skip } = sdkFile("hooks");
  if (skip) return t.skip(skip);
  const creator = sdk.slice(sdk.indexOf("var TPSLPositionOrderCreator"), sdk.indexOf("crateUpdateOrder", sdk.indexOf("var TPSLPositionOrderCreator")));
  assert.ok(creator.length > 100, "TPSLPositionOrderCreator found");
  assert.match(creator, /algo_type: leg === "tp" \? AlgoOrderType\.TAKE_PROFIT : AlgoOrderType\.STOP_LOSS,\s*reduce_only: true,\s*side,\s*type,/);
  assert.match(creator, /trigger_price_type: TriggerPriceType\.MARK_PRICE,\s*symbol: values\.symbol,\s*is_activated: active/);
  assert.match(creator, /resolveTPSLOrderType\([^)]*,\s*true\s*\)/, "a full-position leg resolves to CLOSE_POSITION");
  assert.match(creator, /algo_type: values\.position_type === PositionType\.FULL \? AlgoOrderRootType\.POSITIONAL_TP_SL : AlgoOrderRootType\.TP_SL,\s*trigger_price_type: TriggerPriceType\.MARK_PRICE,\s*symbol: values\.symbol,\s*child_orders,\s*margin_mode: values\.margin_mode \|\| MarginMode\.CROSS/);
  assert.match(sdk, /algo_type === AlgoOrderRootType\.POSITIONAL_TP_SL && [^;]*root_algo_status === OrderStatus\.NEW \|\| order\.root_algo_status === OrderStatus\.REPLACED \|\| order\.root_algo_status === OrderStatus\.PARTIAL_FILLED\)/, "the statuses the SDK treats as live");
  assert.match(sdk, /useMutation\("\/v1\/algo\/order", "DELETE"\)/);
  assert.match(sdk, /doCancelAlgolOrder\(null, \{\s*\/\/ @ts-ignore\s*order_id: orderId,\s*symbol: symbol2,/, "cancel = order_id + symbol");
});

test("the SDK's own rules: CLOSE_POSITION for a full-position leg, and what counts as triggered", (t) => {
  const { src: u, skip } = sdkFile("utils");
  if (skip) return t.skip(skip);
  assert.match(u, /return limit \? OrderType2\.LIMIT : fullPosition \? OrderType2\.CLOSE_POSITION : OrderType2\.MARKET;/);
  const trig = u.slice(u.indexOf("function isTPSLTriggered("), u.indexOf("\nfunction ", u.indexOf("function isTPSLTriggered(") + 10));
  for (const part of ["is_triggered === true", "triggered === true", "trigger_time", '"TRIGGERING", "SUCCESS", "FAILED"', '"PARTIAL_FILLED", "FILLED"', "total_executed_quantity", "child_orders"]) {
    assert.ok(trig.includes(part), `isTPSLTriggered reads ${part} (backstopHit mirrors it)`);
  }
});

test("algoOrderIdFrom: the id from any reply shape Orderly uses; refusals = null", () => {
  assert.equal(algoOrderIdFrom({ success: true, data: { order_id: 77 } }), 77);
  assert.equal(algoOrderIdFrom({ success: true, data: { rows: [{ order_id: "78", algo_type: "POSITIONAL_TP_SL" }] } }), 78);
  assert.equal(algoOrderIdFrom({ success: true, data: { algo_order_id: 79 } }), 79);
  for (const r of [null, {}, { success: false, code: -1103, data: { order_id: 5 } }, { success: true, data: {} }, { success: true, data: { order_id: "x" } }, { success: true, data: { order_id: 0 } }]) {
    assert.equal(algoOrderIdFrom(r), null, JSON.stringify(r));
  }
});

test("cancelPath: the SDK's DELETE with order_id + symbol in the query", () => {
  assert.equal(cancelPath({ id: 77, symbol: "PERP_ETH_USDC" }), "/v1/algo/order?order_id=77&symbol=PERP_ETH_USDC");
});

test("algoTerminal / backstopHit read the order; an unreadable reply is neither", () => {
  for (const s of ["NEW", "REPLACED", "PARTIAL_FILLED"]) assert.equal(algoTerminal({ success: true, data: { root_algo_status: s } }), false, s);
  for (const s of ["CANCELLED", "FILLED", "REJECTED", "COMPLETED"]) assert.equal(algoTerminal({ success: true, data: { root_algo_status: s } }), true, s);
  assert.equal(algoTerminal({ success: true, data: { algo_status: "cancelled" } }), true, "algo_status fallback, any case");
  for (const r of [null, { success: false }, { success: true, data: {} }]) assert.equal(algoTerminal(r), false);

  assert.equal(backstopHit({ success: true, data: { root_algo_status: "NEW", is_triggered: false, child_orders: [{ is_triggered: true }] } }), true, "child triggered");
  assert.equal(backstopHit({ success: true, data: { root_algo_status: "FILLED" } }), true);
  assert.equal(backstopHit({ success: true, data: { is_triggered: true } }), true);
  assert.equal(backstopHit({ success: true, data: { root_algo_status: "CANCELLED", child_orders: [{ is_triggered: false, algo_status: "CANCELLED" }] } }), false);
  for (const d of [{ triggered: true }, { trigger_time: 1790000000000 }, { trigger_status: "SUCCESS" }, { algo_status: "PARTIAL_FILLED" }, { total_executed_quantity: 0.5 }, { child_orders: [{ executed: 1 }] }]) {
    assert.equal(backstopHit({ success: true, data: d }), true, JSON.stringify(d));
  }
  assert.equal(backstopHit({ success: true, data: { root_algo_status: "NEW", trigger_time: 0, total_executed_quantity: 0, child_orders: [{ trigger_status: "" }] } }), false);
  for (const r of [null, { success: false, data: { is_triggered: true } }]) assert.equal(backstopHit(r), false);
});

test("sweepStaleBackstops: cancelled or terminal = done, else counted, dropped at the cap", async () => {
  const list = [{ id: 1, symbol: "A" }, { id: 2, symbol: "B" }, { id: 3, symbol: "C", tries: BACKSTOP_CLEANUP_TRIES - 1 }, { id: 4, symbol: "D" }];
  const r = await sweepStaleBackstops(list, {
    cancel: async (it) => (it.id === 1 ? { success: true } : it.id === 4 ? Promise.reject(new Error("net")) : { success: false }),
    status: async (it) => (it.id === 2 ? { success: true, data: { root_algo_status: "CANCELLED" } } : { success: true, data: { root_algo_status: "NEW" } }),
  });
  assert.deepEqual(r.done.map((x) => x.id), [1, 2]);
  assert.deepEqual(r.left.map((x) => [x.id, x.tries]), [[4, 1]]);
  assert.deepEqual(r.dropped.map((x) => [x.id, x.tries]), [[3, BACKSTOP_CLEANUP_TRIES]]);
  assert.deepEqual(await sweepStaleBackstops(undefined, { cancel: async () => ({}), status: async () => ({}) }), { left: [], done: [], dropped: [] });
});

// ── where exec places and cancels it (index.js source) ──────────────────────────────────────────
const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const fnBody = (name) => { const i = src.indexOf(`async function ${name}(`); assert.ok(i > 0, name); return src.slice(i, src.indexOf("\nasync function ", i + 10)); };

test("entry: the backstop goes on after the fill, before state is saved; paper never places one", () => {
  const e = fnBody("enterPosition");
  const fill = e.indexOf("entryFill = await readFill(keyData, orderId, markPrice)");
  const place = e.indexOf("if (!paper) await ensureBackstop(address, state.current_position, keyData, env);");
  const save = e.indexOf("await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));");
  assert.ok(fill > 0 && place > fill && save > place, "fill → backstop → save");
  assert.match(e, /quote_tick: quoteTick,/);
});

test("entry: a stale backstop on the same market blocks the entry, checked before any order", () => {
  const e = fnBody("enterPosition");
  const sweep = e.indexOf("const stale = await sweepBackstops(address, state, keyData, env);");
  assert.ok(sweep > 0 && sweep < e.indexOf('"/v1/client/leverage"') && sweep < e.indexOf('"/v1/order"'));
  assert.match(e, /if \(stale\.has\(symbol\)\) \{ console\.error\([^\n]*\); return; \}/);
});

test("close: the backstop is cancelled only once exec's close is confirmed, live only", () => {
  const c = fnBody("closePosition");
  const guard = c.indexOf("if (!closeConfirmed) {");
  const cancel = c.indexOf("if (!paper) await cancelBackstop(address, state, pos, closeKey);");
  assert.ok(guard > 0 && cancel > guard, "an unconfirmed close keeps the backstop resting");
  assert.ok(cancel < c.indexOf("state.current_position = null;"));
  assert.match(c, /closeKey = keyData;/);
});

test("monitor: retries a missing backstop after the reconcile; a flat exchange checks whether it fired", () => {
  const m = fnBody("monitorPosition");
  const ensure = m.indexOf("if (liveKey && await ensureBackstop(address, pos, liveKey, env)) await env.NEXUS_AGENT.put(`agent:state:${address}`, JSON.stringify(state));");
  assert.ok(ensure > m.indexOf("liveKey = keyData;") && ensure < m.indexOf("evaluateExit("), "after the reconcile, before exits");
  const flat = m.slice(m.indexOf("position flat on exchange"), m.indexOf("state.current_position = null;"));
  assert.match(flat, /backstopHit\(await orderlyRequest\(keyData, "GET", `\/v1\/algo\/order\/\$\{pos\.backstop\.id\}`\)\)/);
  assert.match(flat, /await cancelBackstop\(address, state, pos, keyData\)/);
  assert.doesNotMatch(flat, /logAgentTrade\(/, "a backstop close is never booked with a reconstructed fill");
});

test("DELETE is sent form-encoded, like the SDK", () => {
  assert.match(fnBody("orderlyRequest"), /method === "GET" \|\| method === "DELETE"\s*\n\s*\? "application\/x-www-form-urlencoded"/);
});
