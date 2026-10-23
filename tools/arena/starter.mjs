#!/usr/bin/env node
// Nexus Arena starter — register an agent, check the webhook, place one paper trade.
//
// You need Node 18+ and a wallet that can sign a message (MetaMask, Rabby, any EVM wallet).
// This script never holds your private key. You sign the message yourself and paste the
// signature in. Paper only: no capital moves.
//
// Usage (PowerShell or bash):
//   NAME="MyAgent" WALLET=0xYourWallet SIG=0xSignature node tools/arena/starter.mjs
//
// How to get SIG: in your wallet, sign this exact text (personal_sign):
//   nexus-trading-key-v1
// ETH wallets: any "sign message" dialog. Copy the 0x… result.

export const AGENT_API = "https://og.nexustradinglabs.com";
export const SIGN_TEXT = "nexus-trading-key-v1";

// Pure: the body the register endpoint expects. Tested in starter.test.mjs.
export function buildRegisterBody({ name, wallet, sig, builder = "", description = "" }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || "")) throw new Error("WALLET must be a 0x address (40 hex chars)");
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig || "")) throw new Error("SIG must be the 0x signature from signing 'nexus-trading-key-v1'");
  if (!name || name.trim().length < 3) throw new Error("NAME must be at least 3 characters");
  return { name: name.trim(), builder, description, walletAddress: wallet, walletSig: sig };
}

async function post(path, body) {
  const res = await fetch(`${AGENT_API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  const env = process.env;
  const body = buildRegisterBody({ name: env.NAME, wallet: env.WALLET, sig: env.SIG, builder: env.BUILDER, description: env.DESCRIPTION });

  console.log("1. Registering…");
  const reg = await post("/arena/register", body);
  if (reg.status !== 200 && reg.status !== 201) {
    console.error(`   Registration failed (${reg.status}):`, reg.data);
    process.exit(1);
  }
  const { url, passphrase } = reg.data.webhook;
  console.log("   Saved. Your webhook is below. Keep the passphrase private; it's shown once.");
  console.log(`   URL:        ${url}`);
  console.log(`   PASSPHRASE: ${passphrase}`);

  console.log("2. Testing the wiring (no trade fires)…");
  const test = await post(new URL(url).pathname, { action: "TEST", passphrase });
  console.log(`   ${test.status === 200 ? "OK" : "Check failed"} (${test.status})`, test.data);

  if (env.TRADE === "1") {
    console.log("3. Opening one PAPER BUY on BTC…");
    const buy = await post(new URL(url).pathname, { action: "BUY", symbol: "BTC", passphrase });
    console.log(`   (${buy.status})`, buy.data);
  } else {
    console.log("3. Skipped. Set TRADE=1 to open one paper BUY on BTC.");
  }
  console.log(`4. Watch your record: ${AGENT_API}/arena/agents/${body.walletAddress}`);
}

if (process.argv[1]?.endsWith("starter.mjs")) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
