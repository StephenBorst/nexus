// ── No new v1 keys (auth v2 build step 3c, docs/auth-v2-spec.md) ────────────────────────────────────
// Worker var AUTH_V1_REGISTER_OFF === "true" stops Nexus making new keys from the static signature:
//   • POST /proxy/bankr-register → the v2 Bankr registration (POST /v2/key/bankr-register, routes-key.mjs);
//   • POST /derive-key, POST /proxy/register-key → 410 v1_registration_off;
//   • GET /register-orderly-key → the v2 page below (session → begin → AddOrderlyKey → challenge → complete).
// It is its OWN switch, not AUTH_V2_KEYS, because the Bankr skill still trades with walletSig until build
// step 4: a v2-only registration leaves walletSig trading with no key at Orderly. Flip it when the skill
// PR (step 4) merges. It needs AUTH_V2_KEYS on (else registration answers 503: nothing could register).
// Keys already registered keep working: this only stops new v1 keys.
//
// The parked mini app (/mini) registers through /derive-key + /proxy/register-key: flipping this
// switch stops its ENABLE step until it moves to v2.

export const v1RegisterOff = (env) => env?.AUTH_V1_REGISTER_OFF === "true";

/** The routes this switch retires outright. null = not one of them, or the switch is off. */
export function v1RegistrationRefusal(parts, method, env) {
  if (!v1RegisterOff(env) || method !== "POST") return null;
  const retired = (parts.length === 1 && parts[0] === "derive-key") || (parts.length === 2 && parts[0] === "proxy" && parts[1] === "register-key");
  if (!retired) return null;
  return {
    status: 410,
    body: {
      error: "v1_registration_off",
      hint: "Nexus no longer makes trading keys from a signature. Register a random key: POST /v2/key/begin with a trading session (or /v2/key/bankr-register), or use /register-orderly-key.",
    },
  };
}

/** /proxy/bankr-register while the switch is on: refuse unless v2 keys are on (the caller delegates). */
export function bankrRegisterV2Refusal(env) {
  if (env?.AUTH_V2_KEYS === "true") return null;
  return { status: 503, body: { error: "registration_unavailable", hint: "v1 registration is off and v2 keys aren't switched on yet." } };
}

/** The register page, v2: three wallet prompts, nothing derived, the key never reaches the browser. */
export function registerPageV2Html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexus - Connect Trading Wallet</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:monospace;background:#0a0a0b;color:#a1a1aa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.wrap{max-width:560px;width:100%}
h1{color:#f4f4f5;font-size:1.1rem;border-top:3px solid #ededf0;padding-top:14px;letter-spacing:2px;margin-bottom:6px}
p.sub{color:#71717a;font-size:.75rem;margin-bottom:24px;line-height:1.7}
button{width:100%;background:#ededf0;color:#0a0a0b;border:none;padding:14px;border-radius:6px;font-family:monospace;font-size:.9rem;font-weight:bold;cursor:pointer;margin:8px 0;letter-spacing:1px}
button:disabled{opacity:.3;cursor:not-allowed}
.status{padding:13px 16px;border-radius:6px;font-size:.82rem;margin:10px 0;line-height:1.7;word-break:break-word}
.ok{background:#141416;border:1px solid #ededf0;color:#f4f4f5}
.err{background:#141416;border:1px solid #fbbf24;color:#fbbf24}
.info{background:#141416;border:1px solid #33333a;color:#a1a1aa}
</style>
</head>
<body>
<div class="wrap">
  <h1>NEXUS - CONNECT TRADING WALLET</h1>
  <p class="sub">Registers a random trading key for this wallet at Orderly.<br>
  It can trade. It can't withdraw. It expires at Orderly in 30 days.<br>
  Three wallet prompts. Nothing is derived from your signature.</p>
  <button id="btn">Connect wallet &amp; register</button>
  <div id="out"></div>
</div>
<script>
function st(h,c){document.getElementById("out").innerHTML='<div class="status '+c+'">'+h+'</div>';}
async function post(path,body){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error+(j.reason?" ("+j.reason+")":"")+(j.hint?" - "+j.hint:""));return j;}
async function get(path){const r=await fetch(path);const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||("HTTP "+r.status));return j;}
async function go(){
  const btn=document.getElementById("btn");
  btn.disabled=true;
  try{
    if(!window.ethereum) throw new Error("No wallet found in this browser.");
    st("Step 1 / 4 - Connecting wallet...","info");
    const [acct] = await ethereum.request({method:"eth_requestAccounts"});
    const wallet = acct.toLowerCase();
    try{await ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:"0xa4b1"}]});}catch(_){}

    st("Step 2 / 4 - Sign in for 24 hours (wallet prompt). This proves the wallet; it derives nothing.","info");
    const s = await get("/v2/session/new?wallet="+wallet);
    const ssig = await ethereum.request({method:"personal_sign",params:[s.message,acct]});
    const session = {session:s.session,issued:s.issued,expires:s.expires,sig:ssig};
    const begun = await post("/v2/key/begin",{wallet,session});

    st("Step 3 / 4 - Approve the key at Orderly (wallet prompt). Scope read,trading, 30 days.","info");
    const eip712Sig = await ethereum.request({method:"eth_signTypedData_v4",params:[acct,JSON.stringify(begun.typedData)]});

    st("Step 4 / 4 - Confirm this registration (wallet prompt).","info");
    const ch = await get("/auth/challenge?wallet="+wallet+"&action=key.register");
    const v2Sig = await ethereum.request({method:"personal_sign",params:[ch.challenge,acct]});
    const done = await post("/v2/key/complete",{wallet,session,pendingId:begun.pendingId,nonce:ch.nonce,v2Sig,eip712Sig});
    if(!done.ok) throw new Error(JSON.stringify(done));
    st("Registered.<br><br>Wallet: <b>"+wallet+"</b><br>Key: <b>"+String(done.orderlyKey).slice(0,30)+"...</b><br>Expires: <b>"+new Date(done.expiresAt).toISOString().slice(0,10)+"</b>","ok");
    btn.textContent="Registered";
  }catch(e){
    st("Error: "+(e&&e.message||e),"err");
    btn.disabled=false; btn.textContent="Retry";
  }
}
document.getElementById("btn").addEventListener("click",go);
</script>
</body>
</html>`;
}
