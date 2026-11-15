// What the Messages page shows from an XMTP conversation (pure rules, tested).
//
// A DM's history holds more than chat: the conversation's own setup ("group updated"
// membership messages), read receipts and reactions. The page listed every one of them
// as a bubble reading "[unsupported content]", and the inbox preview asked for one
// message in the SDK's default (ascending) order, i.e. the OLDEST: a setup message.
// Now the hook asks for application messages only, newest first for previews, and the
// page renders only what has text: plain text, the text inside a reply, else the
// sender's own fallback line. Anything else is skipped, never shown as a placeholder.

// Numeric values of the SDK's wasm enums (the SDK loads lazily, so the page can't import
// them statically). Pinned against node_modules/@xmtp/wasm-bindings by the test.
export const XMTP_SORT_ASC = 0;          // SortDirection.Ascending
export const XMTP_SORT_DESC = 1;         // SortDirection.Descending
export const XMTP_KIND_APPLICATION = 0;  // GroupMessageKind.Application
export const XMTP_ORDER_LAST_ACTIVITY = 1; // ListConversationsOrderBy.LastActivity

/** The text a message carries, or null when it has none to show. */
export function messageText(msg) {
  if (!msg) return null;
  const c = msg.content;
  if (typeof c === "string") return c;
  // a reply decodes to { content, reference }: show what was said
  if (c && typeof c === "object" && typeof c.content === "string") return c.content;
  if (typeof msg.fallback === "string" && msg.fallback.trim()) return msg.fallback;
  return null;
}

/** Messages worth a bubble: application messages with text. Keeps order. */
export function visibleMessages(msgs) {
  return (msgs || []).filter((m) => m && (m.kind == null || m.kind === XMTP_KIND_APPLICATION) && messageText(m) != null);
}

/** One line for the inbox list. */
export function previewText(msg, max = 60) {
  const t = messageText(msg);
  if (t == null) return null;
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

/**
 * A message arrived on the live stream: it replaces the matching optimistic placeholder,
 * a duplicate id is skipped, anything with nothing to show is skipped.
 */
export function mergeStreamed(prev, msg) {
  const list = prev || [];
  if (!msg || visibleMessages([msg]).length === 0) return list;
  // the real copy of a message we sent replaces its placeholder (same sender, same text);
  // a message from the other side leaves our pending one where it is
  const text = messageText(msg);
  const base = list.filter((m) => !(String(m?.id ?? "").startsWith("optimistic_")
    && m.senderInboxId === msg.senderInboxId && messageText(m) === text));
  if (msg.id && base.some((m) => m.id === msg.id)) return base;
  return [...base, msg];
}

const ADDR = /^0x[a-fA-F0-9]{40}$/;

/**
 * Who a `/messages?dm=` link (or the new-DM box) points at. Returns { addr } or { error }.
 * The deep link used to call openDM with whatever the URL held and swallow the failure,
 * so a bad address, your own, or a wallet not on XMTP opened nothing and said nothing.
 */
export function dmTarget(raw, myAddress, { fromLink = false } = {}) {
  const addr = String(raw ?? "").trim();
  if (!addr) return { error: null };
  if (!ADDR.test(addr)) return { error: fromLink ? "That link’s address isn’t a valid 0x wallet (42 characters)." : "Enter a valid 0x wallet address (42 characters)." };
  if (myAddress && addr.toLowerCase() === String(myAddress).toLowerCase()) return { error: "That’s your own wallet. Pick someone else to message." };
  return { addr: addr.toLowerCase() };
}

/** The `re=` draft a call link seeds: one line, no control characters, capped. */
export function draftFromLink(raw) {
  if (raw == null) return undefined;
  // eslint-disable-next-line no-control-regex
  const s = String(raw).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
  return s.trim() ? s : undefined;
}

/** "5m" style age of a message (sentAtNs = bigint nanoseconds). */
export function relativeAge(sentAtNs, now = Date.now()) {
  if (sentAtNs == null) return "";
  const ms = Number(BigInt(sentAtNs) / 1_000_000n);
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
