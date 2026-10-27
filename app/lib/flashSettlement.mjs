// ── Did a settled Flash order pay us? ───────────────────────────────────────────────────────────
// Two things ride on every Flash order and neither had been checked on a settled trade:
//   1. our integrator fee (FLASH_FEE_BPS, sent as flashIntegratorFeeBps on /quote + /order), and
//   2. our Base builder code (FLASH_ATTRIBUTION_CODE, sent as erc8021AttributionCode on /order),
//      which Flash appends to the settlement tx's calldata as an ERC-8021 suffix.
// Read-only: these rules only read Flash's order record and the settlement tx. Nothing is sent.
//
// ERC-8021 data suffix (schema 0), read from the END of the calldata:
//   codes (ASCII, comma-separated) ∥ codesLength (1 byte) ∥ schemaId (1 byte, 0x00) ∥ 0x8021 ×8 (16 bytes)
// Schema 1 adds a 20-byte registry address before the codes. Same layout as ox's
// erc8021/Attribution.ts (fromData / toDataSuffix); the test builds suffixes byte for byte that way.

export const ERC8021_MARKER = "80218021802180218021802180218021";

const strip0x = (h) => String(h || "").toLowerCase().replace(/^0x/, "");
const isHex = (h) => /^[0-9a-f]*$/.test(h) && h.length % 2 === 0;

function asciiFromHex(h) {
  let s = "";
  for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return s;
}

// Parse a suffix that ENDS at hex offset `end` (exclusive, marker included).
function parseEndingAt(h, end) {
  const markerStart = end - ERC8021_MARKER.length;
  if (markerStart < 4) return null;
  const schemaId = parseInt(h.slice(markerStart - 2, markerStart), 16);
  if (schemaId !== 0 && schemaId !== 1) return null;
  const len = parseInt(h.slice(markerStart - 4, markerStart - 2), 16);
  const codesEnd = markerStart - 4;
  const codesStart = codesEnd - len * 2;
  if (codesStart < (schemaId === 1 ? 40 : 0)) return null;
  const text = asciiFromHex(h.slice(codesStart, codesEnd));
  const codes = text.length ? text.split(",") : [];
  const out = { schemaId, codes };
  if (schemaId === 1) out.codeRegistryAddress = "0x" + h.slice(codesStart - 40, codesStart);
  return out;
}

/**
 * Read the ERC-8021 attribution in a tx's calldata.
 * @param {string} input tx input, 0x-hex
 * @returns {{ at: "end" | "inside" | "none", schemaId?: number, codes?: string[], codeRegistryAddress?: string }}
 *   "end" = where Base's indexers look. "inside" = a marker exists but something follows it (indexers
 *   reading the end won't see it); reported so a misplaced suffix isn't mistaken for a missing one.
 */
export function parseAttribution(input) {
  const h = strip0x(input);
  if (!isHex(h)) return { at: "none" };
  if (h.endsWith(ERC8021_MARKER)) {
    const p = parseEndingAt(h, h.length);
    if (p) return { at: "end", ...p };
  }
  for (let i = h.lastIndexOf(ERC8021_MARKER); i >= 0; i = h.lastIndexOf(ERC8021_MARKER, i - 1)) {
    if (i % 2 !== 0) continue;
    const p = parseEndingAt(h, i + ERC8021_MARKER.length);
    if (p) return { at: "inside", ...p };
    if (i === 0) break;
  }
  return { at: "none" };
}

/** Is this Flash asset/chain ref Base? (name, id or namespace carrying "base" / 8453) */
export function isBaseChain(chain) {
  if (!chain || typeof chain !== "object") return false;
  return [chain.id, chain.name, chain.namespace].some((v) => /(^|[^a-z])base([^a-z]|$)|8453/i.test(String(v ?? "")));
}

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** How far a fill's fee may sit from the asked rate and still pass: 1.5 bps, or 1 cent for rounding on small fills. */
export const FEE_TOLERANCE_BPS = 1.5;
export const FEE_TOLERANCE_USD = 0.01;

/**
 * The report for one order.
 * @param {{ order: object, fills: object[], txByHash: Record<string, {input?: string, status?: string} | null>,
 *           expectFeeBps: number, expectCode: string }} a
 *   txByHash: the settlement tx per transactionId (null = couldn't read it).
 */
export function settlementReport({ order, fills, txByHash = {}, expectFeeBps, expectCode }) {
  const o = order || {};
  const list = Array.isArray(fills) ? fills : [];
  const base = isBaseChain(o.targetAsset?.chain) || isBaseChain(o.contraAsset?.chain);
  const askedBps = num(o.integratorFeeBps);

  const rows = list.map((f) => {
    const notional = num(f.notional);
    const feeUsd = num(f.integratorFeeNotional);
    const impliedBps = notional && feeUsd != null ? (feeUsd / notional) * 10_000 : null;
    const expectedUsd = notional != null ? (notional * expectFeeBps) / 10_000 : null;
    let fee = "UNREAD";
    if (feeUsd != null && notional) {
      const close = Math.abs(impliedBps - expectFeeBps) <= FEE_TOLERANCE_BPS || Math.abs(feeUsd - expectedUsd) <= FEE_TOLERANCE_USD;
      fee = feeUsd > 0 && close ? "PASS" : "FAIL";
    }
    const tx = typeof f.transactionId === "string" ? f.transactionId : null;
    let code = "UNREAD", attribution = null;
    if (!base) code = "NOT_BASE";
    else if (tx && txByHash[tx]?.input) {
      attribution = parseAttribution(txByHash[tx].input);
      code = attribution.at === "end" && (attribution.codes || []).includes(expectCode) ? "PASS" : "FAIL";
    }
    return {
      tx, chainStatus: f.status ?? null, filledAt: f.filledAt ?? null,
      notionalUsd: notional, integratorFeeUsd: feeUsd, integratorFeeAmount: f.integratorFeeAmount ?? null,
      feeTicker: f.feeTicker ?? null, impliedBps: impliedBps == null ? null : Math.round(impliedBps * 100) / 100,
      fee, code, attribution,
    };
  });

  const roll = (key) => {
    if (!rows.length) return "PENDING";
    if (rows.some((r) => r[key] === "FAIL")) return "FAIL";
    if (rows.every((r) => r[key] === "PASS")) return "PASS";
    if (rows.every((r) => r[key] === "NOT_BASE")) return "NOT_BASE";
    return "UNREAD";
  };
  const feeRequested = askedBps === expectFeeBps;
  return {
    orderId: o.orderId ?? null, status: o.status ?? null, orderType: o.orderType ?? null, onBase: base,
    expected: { feeBps: expectFeeBps, code: expectCode },
    fee: { verdict: !feeRequested && rows.length ? "FAIL" : roll("fee"), requestedBps: askedBps, requestedOk: feeRequested },
    code: { verdict: roll("code") },
    fills: rows,
  };
}
