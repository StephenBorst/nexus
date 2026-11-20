// ── House paper runs: the setup job (rules app/lib/housePaper.mjs) ──────────────────────────────────────────────────
// Hourly, behind worker var HOUSE_PAPER_RUNS = "true". For each house run: no config stored ⇒ write the house config, a
// fresh state (started_at now, the record's start) and add the id to agent:users; a stored config that matches ⇒
// nothing; one that differs ⇒ reported, never rewritten (a changed config would cut the record in two). Writes only
// those three keys, only for the house ids. Moves no stage, signs nothing, trades nothing itself: exec runs the paper
// trades like any paper agent, the brain computes the read (registeredReadLive.mjs).
import { HOUSE_PAPER_IDS, housePaperPlan } from "../../app/lib/housePaper.mjs";

export async function ensureHousePaper(env, { now = Date.now() } = {}) {
  if (env.HOUSE_PAPER_RUNS !== "true") return { ok: true, off: true, created: [], issues: [] };
  const KV = env.NEXUS_AGENT;
  if (!KV) return { ok: false, error: "no NEXUS_AGENT binding", created: [], issues: [] };
  const created = [], issues = [], running = [];
  for (const [read, id] of Object.entries(HOUSE_PAPER_IDS)) {
    let stored;
    try { const raw = await KV.get(`agent:config:${id}`); stored = raw ? JSON.parse(raw) : null; }
    catch (e) { issues.push(`${read}: config unread (${String(e?.message || e).slice(0, 80)})`); continue; }
    const plan = housePaperPlan(read, stored);
    if (plan.action === "mismatch") { issues.push(plan.why); continue; }
    if (plan.action === "create") {
      await KV.put(`agent:config:${id}`, JSON.stringify(plan.config));
      // only a FRESH record: an existing state (there should be none) is left as it is
      if (!(await KV.get(`agent:state:${id}`))) {
        await KV.put(`agent:state:${id}`, JSON.stringify({ active: true, daily_pnl: 0, trades_today: 0, last_reset: now, started_at: now, current_position: null, last_signal: null }));
      }
      created.push(read);
    }
    running.push(id);
  }
  // agent:users: re-read right before the write, and write only when a house id is missing (the first run, normally)
  if (running.length) {
    const users = JSON.parse((await KV.get("agent:users")) || "[]");
    const missing = running.filter((id) => !users.includes(id));
    if (missing.length) {
      const fresh = JSON.parse((await KV.get("agent:users")) || "[]");
      for (const id of missing) if (!fresh.includes(id)) fresh.push(id);
      await KV.put("agent:users", JSON.stringify(fresh));
    }
  }
  return { ok: true, created, issues, running: running.length };
}
