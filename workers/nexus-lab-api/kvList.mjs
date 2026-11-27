// ── Every key under a prefix (2026-11-27) ──
// One KV list() call returns at most 1000 keys; anything after that needs the cursor. Callers that read
// `list({ prefix }).keys` once silently stop at record 1000 (found in the Holders Room audit: the room, the
// public feed, the grader and the boards all did it). This pages to the end.
/** @returns {Promise<{ name: string }[]>} */
export async function listAllKeys(kv, prefix, { maxPages = 100 } = {}) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    out.push(...(page?.keys || []));
    if (!page || page.list_complete !== false || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}
