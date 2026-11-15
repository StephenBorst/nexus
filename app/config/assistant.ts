/**
 * Nexus Assistant — config + provider plumbing (single source of truth).
 *
 * v1 is BYOK, CLIENT-SIDE ONLY: the user's API key lives in localStorage and the
 * browser calls the model provider directly. The key NEVER touches a Nexus
 * server, so we carry zero key-custody liability. Hosted inference (pay in
 * $NEXUS / USDC) is a later iteration that routes through a worker.
 *
 * No SDKs — we hit the providers' REST APIs with fetch to keep the bundle light.
 */

export type ProviderId = "anthropic" | "openai";

export interface ProviderDef {
  id: ProviderId;
  label: string;
  endpoint: string;
  defaultModel: string;
  models: string[];
  keyHint: string;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    endpoint: "https://api.anthropic.com/v1/messages",
    // Placeholders shown before a key is entered; the live /v1/models list
    // (fetched from the user's key) replaces these once available — so any model
    // the user's account can access appears regardless of this list.
    defaultModel: "claude-opus-4-8",
    models: ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
    keyHint: "sk-ant-…",
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4.1", "gpt-4o"],
    keyHint: "sk-…",
  },
};

// localStorage keys (client-side only).
export const LS_PROVIDER = "nexus_ai_provider";
export const LS_MODEL = (p: ProviderId) => `nexus_ai_model_${p}`; // per-provider model
export const LS_KEY = (p: ProviderId) => `nexus_ai_key_${p}`;     // per-provider key
export const LS_HOSTED_MODEL = "nexus_ai_hosted_model";           // PRO hosted-tier choice

// ── Hosted (PRO) model tiers ────────────────────────────────────────────────
// PRO users pick which model our proxy runs; each tier has its own daily cap of QUESTIONS (a
// question's tool rounds ride on one slot) so our spend scales with model cost — stronger model
// = lower cap. ⚠️ MUST mirror the worker's hostedCaps()/resolveHostedModel in
// workers/nexus-lab-api/logic.mjs (ids + cap numbers) or the UI will advertise a cap the server
// doesn't enforce. The current model of each family (2026-11-15); Sonnet is the everyday default.
export interface HostedTier { id: string; label: string; cap: number; note: string; }
export const HOSTED_TIERS: HostedTier[] = [
  { id: "claude-haiku-5-5",  label: "Haiku 5.5",  cap: 100, note: "fastest · highest cap" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", cap: 40,  note: "balanced · default" },
  { id: "claude-opus-5-5",   label: "Opus 5.5",   cap: 12,  note: "strong · lower cap" },
  { id: "claude-fable-5-2",  label: "Fable 5.2",  cap: 5,   note: "most capable · lowest cap" },
];
export const HOSTED_DEFAULT_MODEL = "claude-sonnet-5-5";

// Load the stored hosted tier, validated against the current tier list (a stale
// id — e.g. a previously-default Opus — snaps back to the default).
export function loadHostedModel(): string {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem(LS_HOSTED_MODEL) : null;
  return HOSTED_TIERS.some((t) => t.id === stored) ? (stored as string) : HOSTED_DEFAULT_MODEL;
}

import { anthropicTools, openaiTools, TOOL_BY_NAME, type ToolCtx } from "@/config/assistantTools";
import { requestLimits, textOf, emptyTurnText, createStreamAssembler, streamErrorText, trimHistory, systemBlocks, CONTEXT_MARKER } from "@/lib/anthropicTurn.mjs";
import { createWalletClient, custom } from "viem";
import { bareTicker } from "@/utils/utils";

// ── Hosted inference (PRO) — route the Anthropic format through our authed proxy
// so PRO users need no API key of their own (we inject ours server-side). ──────
export interface HostedAuth { addr: string; ts: number; sig: string; }
const HOSTED_BASE = "https://og.nexustradinglabs.com";
const aiAccessMessage = (address: string, ts: number) =>
  `Nexus AI Access\nAddress: ${address.toLowerCase()}\nTimestamp: ${ts}`;

// Sign-once (cached ~25 min) wallet challenge proving PRO wallet ownership. `provider` = the
// wallet the app is connected through (useLabWallet: WalletConnect, the Android app, an
// extension). It used to read window.ethereum only, so a phone / WalletConnect user got "No
// wallet found" with a wallet connected.
export async function getHostedAccess(address: string, provider?: unknown): Promise<HostedAuth> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Hosted AI signs in with an EVM wallet. Connect one, or use your own API key in ⚙.");
  const key = `nexus_ai_access_${address.toLowerCase()}`;
  try {
    const c = JSON.parse(sessionStorage.getItem(key) || "null");
    if (c && Date.now() - c.ts < 25 * 60 * 1000) return c;
  } catch { /* ignore */ }
  const eth = provider ?? (window as unknown as { ethereum?: unknown }).ethereum;
  if (!eth) throw new Error("No wallet found. Connect your wallet to use hosted AI.");
  const client = createWalletClient({ transport: custom(eth as Parameters<typeof custom>[0]) });
  const ts = Date.now();
  const sig = await client.signMessage({ account: address as `0x${string}`, message: aiAccessMessage(address, ts) });
  const access: HostedAuth = { addr: address.toLowerCase(), ts, sig };
  try { sessionStorage.setItem(key, JSON.stringify(access)); } catch { /* ignore */ }
  return access;
}

/** A random id naming one question, so its tool rounds share one hosted cap slot (server: takeHostedSlot). */
function newQuestionId(): string {
  try { return crypto.randomUUID().replace(/-/g, ""); } catch { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; }
}

// Anthropic-format request target: direct provider (BYOK) or our PRO proxy (hosted). One target
// per question: its `_q` stays the same across that question's tool rounds.
function anthropicTarget(apiKey: string, hosted?: HostedAuth) {
  if (hosted) return {
    endpoint: `${HOSTED_BASE}/ai/chat`,
    headers: { "content-type": "application/json" } as Record<string, string>,
    authBody: { _addr: hosted.addr, _ts: hosted.ts, _sig: hosted.sig, _q: newQuestionId() } as Record<string, unknown>,
    cacheBody: {} as Record<string, unknown>,
  };
  return {
    endpoint: PROVIDERS.anthropic.endpoint,
    // Your own key: cache the repeated prefix (tools + system + earlier turns), so each tool
    // round and follow-up bills that part at ~0.1x. The hosted proxy places its own breakpoints.
    cacheBody: { cache_control: { type: "ephemeral" } } as Record<string, unknown>,
    headers: {
      "content-type": "application/json", "x-api-key": apiKey,
      "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    } as Record<string, string>,
    authBody: {} as Record<string, unknown>,
  };
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface RunResult {
  text: string;
  toolsUsed: string[];
}

const MAX_TOOL_ROUNDS = 5; // bound the agentic loop

/**
 * System prompt — the assistant's identity + the advice/Howey guardrail. Trading
 * commentary stays analytical and educational; never a personalized "buy/sell"
 * directive. Nexus-specific context is appended at call time.
 */
export const SYSTEM_PROMPT = `You are Nexus, the AI analyst built into Nexus Trading Labs — a perpetual DEX trading terminal on Arbitrum (powered by Orderly Network).

Your job: help the trader understand the market, reason about their own theses, agent, and track record, and become a better, more disciplined trader. You have access to live context about the user's session (current page, their planned theses, autonomous agent state, market regime) which is provided below.

HARD RULES:
- You are NOT a licensed financial advisor. Never give personalized investment advice or direct "buy/sell/hold this now" instructions. Frame everything as analysis, education, and helping the user reason — the decision is always theirs.
- Be precise and concise. This is a terminal; traders want signal, not fluff.
- When you reference the user's data, use the context provided — don't invent positions or numbers.
- If asked about something outside the provided context or your knowledge, say so plainly.
- GRADES: a read is "graded" only when the scoreboard grades that EXACT rule; otherwise say "not graded" (get_market_read and get_signal_scoreboard carry the grades). Never add ungraded inputs up into a conviction, score or verdict. PREDICTIVE is not an edge; an edge = BEATS_RANDOM on its side. Never suggest inverting a read.
- CAUSATION DISCIPLINE (for explain_move / "why is X moving"): news headlines are candidate context, not proof. Give the most LIKELY drivers, cite the specific headlines by title/source, and label them as hypotheses ("possible drivers"). Never state a headline caused a move as fact, and if the headlines don't explain the move, say so instead of inventing a narrative. This mirrors the Nexus "verify, don't trust" ethos.
- Match the terminal's voice: sharp, technical, no hype.
- The chat panel is NARROW (~380px). Keep answers compact. Prefer short paragraphs and tight bullet lists. Narrow markdown tables (2-3 columns, e.g. Metric | Value) render fine and are good for snapshots; avoid very wide tables. Use **bold** for key labels/numbers.

You have TOOLS:
- Read live data (each tool's own description says what it returns; call one whenever a question needs current numbers, never guess prices or stats). Routing:
  · "how am I doing" / "what should I work on" → get_operator_profile FIRST (the same synthesis the Lab shows; honour its tier: FORMING = small sample, say so); get_my_edge and get_my_performance supplement it.
  · weighing a trade or drafting a thesis → get_call_advice (it runs the functions that will grade the call).
  · "read X for me" → get_market_read (the default; each lens with its grade); get_read for a deeper look at one coin; get_conviction for the market-wide funding scan.
  · "what's setting up" → get_mispriced, get_smart_money, get_conviction, get_arena; who to trust → get_verified_callers, get_contested, get_contrarians.
  · any wallet address in play → xray_wallet. Their book → get_open_positions, get_book_risk (liquidation, stops, funding a day, concentration).
  · funding vs other venues → get_funding_venues (an input, never "arbitrage"); what's coming up → get_calendar.
- Take actions (navigation + planning only, NEVER order execution): open_symbol (open a coin's trade page), open_trader, open_xray (open the wallet x-ray), open_leaderboard, open_mispriced (funding-edge board, now in Smart Money), open_conviction (the market-wide Conviction Scanner), open_autocopy (set up copy-trading a leader), draft_thesis (pre-fill the Thesis Engine with a trade plan), draft_directive (pre-fill the autonomous agent's DIRECTIVE panel with an EXACT directional trade for it to run), and get_agent_directive (read the agent's current directive). When you draft a thesis or directive, base the levels on real data (fetch the market first if needed) and make the risk/reward sane; tell the user you've drafted it and that they must review + confirm before it does anything — you never place or arm the order yourself. If a directive draft returns an edge_note (the user's own record on that symbol/direction), relay it and coach position size toward their proven strengths — as analysis, never a hard sizing instruction.

CAPABILITIES you can guide the user to (all in The Lab, /lab):
- Directional agent mode: from a thesis or a chat, the user can hand the agent their EXACT trade — it enters THEIR direction and manages the exit (scale-out, trailing stop, breakeven, timeout), one-shot. MARKET (fill now) or a resting LIMIT at their price. Defaults to PAPER. Different from the signal bot, which picks its own direction from funding/OI. Use draft_directive to tee it up.
- Guided thesis entry: the Thesis Engine can auto-fill entry from live mark, snap the stop by %, and set targets as R-multiples (1R/2R/3R) — coach in R:R, not raw prices.
- Telegram alerts: the agent can DM the user on every open/close (non-custodial). Point them to "Link Telegram" on the Agent tab for passive updates.
- Nexus PRO is the premium tier (advanced agent strategies, hosted AI, backtesting), unlocked by holding $NEXUS or subscribing.`;

/** Build the per-request context block injected after the system prompt. */
export function buildContextBlock(ctx: {
  page: string;
  wallet: string | null;
  theses: { symbol: string; direction: string; status: string; riskReward?: number }[];
  agent: { mode?: string; active?: boolean; hasPosition?: boolean } | null;
  regime?: string | null;
}): string {
  const lines: string[] = [CONTEXT_MARKER];
  lines.push(`Current page: ${ctx.page}`);
  lines.push(`Wallet: ${ctx.wallet ? ctx.wallet : "not connected"}`);
  if (ctx.regime) lines.push(`Market regime: ${ctx.regime}`);
  if (ctx.agent) {
    lines.push(
      `Agent: ${ctx.agent.active ? "ACTIVE" : "inactive"}` +
        (ctx.agent.mode ? ` (${ctx.agent.mode})` : "") +
        (ctx.agent.hasPosition ? " — holding a position" : "")
    );
  }
  if (ctx.theses.length) {
    lines.push(`User's theses (${ctx.theses.length}):`);
    for (const t of ctx.theses.slice(0, 12)) {
      const sym = bareTicker(t.symbol);
      lines.push(`  • ${sym} ${t.direction} — ${t.status}${t.riskReward ? ` (R:R 1:${t.riskReward.toFixed(2)})` : ""}`);
    }
  } else {
    lines.push("User has no saved theses yet.");
  }
  lines.push("--- END CONTEXT ---");
  return lines.join("\n");
}

/**
 * Agentic chat: runs a bounded tool-use loop so the model can pull live Nexus
 * data (market, agent status, leaderboards) before answering. Same BYOK,
 * client-side, both providers. Returns the final text + which tools were used.
 */
export async function runChat(opts: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  system: string;
  history: ChatMsg[];
  ctx: ToolCtx;
  signal?: AbortSignal;
  hosted?: HostedAuth;
}): Promise<RunResult> {
  return (opts.provider === "anthropic" || opts.hosted) ? runAnthropic(opts) : runOpenAI(opts);
}

async function runAnthropic(opts: {
  model: string; apiKey: string; system: string; history: ChatMsg[]; ctx: ToolCtx; signal?: AbortSignal; hosted?: HostedAuth;
}): Promise<RunResult> {
  const { model, apiKey, system, history, ctx, signal, hosted } = opts;
  const messages: { role: string; content: unknown }[] = trimHistory(history).map((m: ChatMsg) => ({ role: m.role, content: m.content }));
  const toolsUsed: string[] = [];
  const t = anthropicTarget(apiKey, hosted);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(t.endpoint, {
      method: "POST",
      headers: t.headers,
      body: JSON.stringify({ model, ...requestLimits(model), system: systemBlocks(system), tools: anthropicTools(), messages, ...t.cacheBody, ...t.authBody }),
      signal,
    });
    if (!res.ok) throw new Error(await errText(res));
    const data = await res.json();
    const content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] = data?.content ?? [];

    if (data?.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content });
      const results: unknown[] = [];
      for (const block of content) {
        if (block.type !== "tool_use" || !block.name) continue;
        toolsUsed.push(block.name);
        const out = await runTool(block.name, block.input ?? {}, ctx);
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // The assistant turn above goes back verbatim (thinking blocks included), as these models require.
    return { text: textOf(content) || emptyTurnText(data?.stop_reason), toolsUsed };
  }
  return { text: "Stopped after too many tool calls — try narrowing the question.", toolsUsed };
}

async function runOpenAI(opts: {
  model: string; apiKey: string; system: string; history: ChatMsg[]; ctx: ToolCtx; signal?: AbortSignal;
}): Promise<RunResult> {
  const { model, apiKey, system, history, ctx, signal } = opts;
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...trimHistory(history).map((m: ChatMsg) => ({ role: m.role, content: m.content })),
  ];
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(PROVIDERS.openai.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: openaiTools(), tool_choice: "auto" }),
      signal,
    });
    if (!res.ok) throw new Error(await errText(res));
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    const toolCalls: { id: string; function: { name: string; arguments: string } }[] = msg?.tool_calls ?? [];

    if (toolCalls.length) {
      messages.push(msg);
      for (const tc of toolCalls) {
        toolsUsed.push(tc.function.name);
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep {} */ }
        const out = await runTool(tc.function.name, args, ctx);
        messages.push({ role: "tool", tool_call_id: tc.id, content: out });
      }
      continue;
    }
    return { text: msg?.content ?? "(empty response)", toolsUsed };
  }
  return { text: "Stopped after too many tool calls — try narrowing the question.", toolsUsed };
}

// ── STREAMING ──────────────────────────────────────────────────────────────
// Same bounded tool loop, but text streams to onDelta token-by-token. The
// non-streaming runChat above stays as an instant fallback.

export async function runChatStream(opts: {
  provider: ProviderId; model: string; apiKey: string; system: string;
  history: ChatMsg[]; ctx: ToolCtx; signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  hosted?: HostedAuth;
}): Promise<RunResult> {
  return (opts.provider === "anthropic" || opts.hosted) ? runAnthropicStream(opts) : runOpenAIStream(opts);
}

// Read an SSE response body line-by-line and hand each parsed `data:` JSON to cb.
async function readSSE(res: Response, cb: (json: Record<string, unknown>) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try { cb(JSON.parse(data)); } catch { /* keep-alive / partial */ }
    }
  }
}

async function runAnthropicStream(opts: {
  model: string; apiKey: string; system: string; history: ChatMsg[]; ctx: ToolCtx; signal?: AbortSignal;
  onDelta: (c: string) => void; hosted?: HostedAuth;
}): Promise<RunResult> {
  const { model, apiKey, system, history, ctx, signal, onDelta, hosted } = opts;
  const messages: { role: string; content: unknown }[] = trimHistory(history).map((m: ChatMsg) => ({ role: m.role, content: m.content }));
  const toolsUsed: string[] = [];
  let fullText = "";
  const t = anthropicTarget(apiKey, hosted);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(t.endpoint, {
      method: "POST",
      headers: t.headers,
      body: JSON.stringify({ model, ...requestLimits(model), system: systemBlocks(system), tools: anthropicTools(), messages, stream: true, ...t.cacheBody, ...t.authBody }),
      signal,
    });
    if (!res.ok) throw new Error(await errText(res));

    // Rebuilds the turn with thinking blocks (text + signature) intact, so the tool loop can send
    // it back unchanged (app/lib/anthropicTurn.mjs).
    const turn = createStreamAssembler((chunk: string) => { fullText += chunk; onDelta(chunk); });
    await readSSE(res, (ev) => turn.push(ev));
    const failed = streamErrorText(turn.error);
    if (failed) throw new Error(failed);
    const stopReason = turn.stopReason as string | null;
    const content = turn.content() as { type: string; id?: string; name?: string; input?: Record<string, unknown> }[];

    if (stopReason === "tool_use") {
      messages.push({ role: "assistant", content });
      const results: unknown[] = [];
      for (const b of content) {
        if (b.type !== "tool_use" || !b.name) continue;
        toolsUsed.push(b.name);
        const out = await runTool(b.name, (b as { input?: Record<string, unknown> }).input ?? {}, ctx);
        results.push({ type: "tool_result", tool_use_id: b.id, content: out });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    return { text: fullText.trim() || emptyTurnText(stopReason), toolsUsed };
  }
  return { text: fullText.trim() || "Stopped after too many tool calls.", toolsUsed };
}

async function runOpenAIStream(opts: {
  model: string; apiKey: string; system: string; history: ChatMsg[]; ctx: ToolCtx; signal?: AbortSignal;
  onDelta: (c: string) => void;
}): Promise<RunResult> {
  const { model, apiKey, system, history, ctx, signal, onDelta } = opts;
  const messages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...trimHistory(history).map((m: ChatMsg) => ({ role: m.role, content: m.content })),
  ];
  const toolsUsed: string[] = [];
  let fullText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(PROVIDERS.openai.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: openaiTools(), tool_choice: "auto", stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(await errText(res));

    const calls: Record<number, { id: string; name: string; args: string }> = {};
    let finish: string | null = null;
    let roundText = "";
    await readSSE(res, (ev) => {
      const ch = (ev.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0];
      if (!ch) return;
      const d = (ch.delta || {}) as { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
      if (d.content) { roundText += d.content; fullText += d.content; onDelta(d.content); }
      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const c = calls[tc.index] || { id: "", name: "", args: "" };
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
          calls[tc.index] = c;
        }
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    });

    const callList = Object.keys(calls).map(Number).sort((a, b) => a - b).map((k) => calls[k]);
    if (finish === "tool_calls" && callList.length) {
      messages.push({ role: "assistant", content: roundText || null, tool_calls: callList.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) });
      for (const c of callList) {
        toolsUsed.push(c.name);
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.args || "{}"); } catch { /* empty */ }
        const out = await runTool(c.name, args, ctx);
        messages.push({ role: "tool", tool_call_id: c.id, content: out });
      }
      continue;
    }
    return { text: fullText.trim() || "(empty response)", toolsUsed };
  }
  return { text: fullText.trim() || "Stopped after too many tool calls.", toolsUsed };
}

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const tool = TOOL_BY_NAME[name];
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });
  try {
    return await tool.run(input, ctx);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "tool failed" });
  }
}

/**
 * List the models the given key can actually access, so the UI never offers a
 * stale/retired model id (the cause of 404s). Best-effort: returns [] on failure
 * and the UI falls back to the static defaults + the free-text model field.
 */
export async function listModels(provider: ProviderId, apiKey: string): Promise<string[]> {
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data?.data ?? []).map((m: { id: string }) => m.id).filter(Boolean);
    }
    // openai — filter the (large) list to chat-capable model families.
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => /^(gpt-|chatgpt|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id))
      .sort();
  } catch {
    return [];
  }
}

// A failed request in plain words. Our hosted proxy answers { error, hint } (daily_limit,
// question_rounds, too_long, pro_required, busy): the hint is the sentence to show. A provider
// answers { error: { type, message } }.
async function errText(res: Response): Promise<string> {
  let j: { error?: unknown; hint?: unknown } | null = null;
  let raw = "";
  try { raw = await res.text(); j = JSON.parse(raw); } catch { j = null; }
  if (j && typeof j.hint === "string" && j.hint) return j.hint;
  const err = j?.error as { type?: string; message?: string } | string | undefined;
  const msg = typeof err === "string" ? err : err?.message || "";
  const type = typeof err === "object" ? err?.type : undefined;
  if (res.status === 401) return "Invalid API key (401). Check your key in settings.";
  if (res.status === 529 || type === "overloaded_error") return "The model is overloaded right now (529). Try again in a minute, or pick another model in ⚙.";
  if (res.status === 429) return msg ? `Rate limited (429): ${msg}` : "Rate limited (429). Wait a moment and try again.";
  return `Request failed (${res.status}). ${msg || raw.slice(0, 200)}`.trim();
}
