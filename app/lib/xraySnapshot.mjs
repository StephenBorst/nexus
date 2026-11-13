// ── /analyze (Wallet X-Ray), written into the HTML before the app boots ───────────────────────────
// The app takes seconds to boot on a phone (the Orderly SDK). A shared X-Ray link (/analyze?address=0x…) used
// to sit on the boot screen for all of it. The page's Function (functions/analyze/index.js → seoGate.mjs
// gateAnalyzePage) swaps the boot screen for this frame: the page's own header, the wallet from the link, and
// an "analyzing" line over empty placeholders. React replaces it on mount and runs the real read.
//
// Pure and network-free: the frame claims nothing about the wallet (no grade, no P&L, no count), so it needs no
// read and adds no wait. Only a well-formed 0x address is echoed; anything else gets the plain header.

import { BRAND } from "./brand.mjs";

// The live page's header (app/pages/analyze/index.tsx), one copy for both; xraySnapshot.test.mjs pins the page to it.
export const XRAY_EYEBROW = "WALLET X-RAY";
export const XRAY_TITLE = "X-ray any trader. Grade the tape.";
export const XRAY_NOTE = "NO LOGIN · PUBLIC DATA";

const ADDR = /^0x[a-fA-F0-9]{40}$/;
/** The wallet a link names, lower-cased, or null. */
export function xrayAddressFrom(search) {
  let a = null;
  try { a = new URLSearchParams(String(search || "")).get("address"); } catch { a = null; }
  a = String(a || "").trim();
  return ADDR.test(a) ? a.toLowerCase() : null;
}

const WINDOWS = ["24H", "7D", "30D", "ALL"];

/** The static frame for /analyze, with the wallet's "analyzing" block when the link names one. */
export function xraySnapshotHtml(address) {
  const B = BRAND;
  const a = ADDR.test(String(address || "")) ? String(address).toLowerCase() : null;
  const mono = "ui-monospace,Menlo,monospace";
  const bar = (w, h = 12) => `<div style="height:${h}px;width:${w};background:${B.surface};border-radius:3px;margin-top:10px"></div>`;
  const reading = a
    ? `<div style="margin-top:4px;padding:16px;border:1px solid ${B.border};border-radius:6px;background:${B.panel}">`
      + `<div style="font:12px/1.6 ${mono};color:${B.fog};word-break:break-all">$ ./xray.sh --wallet ${a}</div>`
      + `<div style="font:12px/1.6 ${mono};color:${B.bone};margin-top:2px">Analyzing… reading Hyperliquid + Orderly.</div>`
      + `<div class="nx-boot-line" style="margin-top:12px"></div>`
      + `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:16px">${WINDOWS.map((w) => `<span style="font:10.5px/1 ${mono};letter-spacing:.08em;color:${B.faint};border:1px solid ${B.border};border-radius:3px;padding:6px 9px">${w}</span>`).join("")}</div>`
      + bar("62%", 22) + bar("88%") + bar("74%") + bar("55%")
      + `</div>`
    : `<div style="font:12px/1.6 ${mono};color:${B.muted}">Loading the analyzer…</div><div class="nx-boot-line" style="margin-top:12px"></div>`;
  return `<div class="nx-xray-snapshot" style="min-height:100vh;background:${B.canvas};color:${B.bright};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">`
    + `<main style="max-width:1200px;margin:0 auto;padding:20px 16px 60px">`
    + `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:6px 16px;flex-wrap:wrap;margin-bottom:16px">`
    + `<div><div style="font:10px/1.4 ${mono};letter-spacing:.18em;text-transform:uppercase;color:${B.muted};margin-bottom:6px">${XRAY_EYEBROW}</div>`
    + `<h1 style="margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.15">${XRAY_TITLE}</h1></div>`
    + `<div style="font:11px ${mono};color:${B.muted};padding-bottom:3px">${XRAY_NOTE}</div></div>`
    + `<p style="font-size:13.5px;color:${B.fog};max-width:640px;line-height:1.65;margin:0 0 22px">Paste any wallet. We read its perp record from Hyperliquid and the Orderly network, straight off public data. No login.</p>`
    + reading
    + `</main></div>`;
}
