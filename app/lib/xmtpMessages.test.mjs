import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  XMTP_SORT_ASC, XMTP_SORT_DESC, XMTP_KIND_APPLICATION, XMTP_ORDER_LAST_ACTIVITY,
  messageText, visibleMessages, previewText, mergeStreamed, dmTarget, draftFromLink, relativeAge,
} from "./xmtpMessages.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("enum values match the installed XMTP wasm bindings", (t) => {
  const p = new URL("../../node_modules/@xmtp/wasm-bindings/dist/bindings_wasm.d.ts", import.meta.url);
  if (!existsSync(p)) return t.skip("bindings not installed");
  const d = readFileSync(p, "utf8");
  const val = (en, key) => Number(new RegExp(`export enum ${en} \\{[^}]*?\\b${key} = (\\d+)`).exec(d)?.[1]);
  assert.equal(val("SortDirection", "Ascending"), XMTP_SORT_ASC);
  assert.equal(val("SortDirection", "Descending"), XMTP_SORT_DESC);
  assert.equal(val("GroupMessageKind", "Application"), XMTP_KIND_APPLICATION);
  assert.equal(val("ListConversationsOrderBy", "LastActivity"), XMTP_ORDER_LAST_ACTIVITY);
});

test("messageText: text, a reply's text, the sender's fallback, else nothing", () => {
  assert.equal(messageText({ content: "gm" }), "gm");
  assert.equal(messageText({ content: { content: "agreed", reference: "abc" } }), "agreed");
  assert.equal(messageText({ content: { reference: "x", action: "added" }, fallback: "Reacted 👍" }), "Reacted 👍");
  assert.equal(messageText({ content: { addedInboxes: [] } }), null, "a setup message has no text");
  assert.equal(messageText({ content: undefined, fallback: "  " }), null);
  assert.equal(messageText(null), null);
});

test("visibleMessages: no '[unsupported content]' bubbles, order kept", () => {
  const msgs = [
    { id: "0", kind: 1, content: { addedInboxes: ["a"] } }, // the DM's setup message
    { id: "1", kind: 0, content: "hey" },
    { id: "2", kind: 0, content: { readReceipt: true } },
    { id: "3", kind: 0, content: { content: "re: hey", reference: "1" } },
  ];
  assert.deepEqual(visibleMessages(msgs).map((m) => m.id), ["1", "3"]);
  assert.deepEqual(visibleMessages(null), []);
});

test("previewText: one line, capped", () => {
  assert.equal(previewText({ content: "a\n\n b" }), "a b");
  assert.equal(previewText({ content: "x".repeat(80) }, 10), "x".repeat(9) + "…");
  assert.equal(previewText({ content: { addedInboxes: [] } }), null);
});

test("mergeStreamed: the real copy replaces its placeholder; the other side's message doesn't", () => {
  const mine = { id: "optimistic_1", senderInboxId: "me", content: "gm" };
  const theirs = { id: "t1", senderInboxId: "them", content: "yo" };
  let list = mergeStreamed([mine], theirs);
  assert.deepEqual(list.map((m) => m.id), ["optimistic_1", "t1"], "our pending bubble stays");
  list = mergeStreamed(list, { id: "r1", senderInboxId: "me", content: "gm" });
  assert.deepEqual(list.map((m) => m.id), ["t1", "r1"]);
  assert.equal(mergeStreamed(list, { id: "r1", senderInboxId: "me", content: "gm" }).length, 2, "duplicate id skipped");
  assert.equal(mergeStreamed(list, { id: "x", kind: 1, content: {} }).length, 2, "setup message skipped");
});

test("dmTarget: a link or a typed address names one other wallet, else says why", () => {
  const me = "0x" + "a".repeat(40);
  const them = "0x" + "B".repeat(40);
  assert.deepEqual(dmTarget(them, me), { addr: them.toLowerCase() });
  assert.match(dmTarget("0x123", me, { fromLink: true }).error, /link/);
  assert.match(dmTarget("vitalik.eth", me).error, /Enter a valid 0x/);
  assert.match(dmTarget(me.toUpperCase().replace("0X", "0x"), me).error, /your own wallet/);
  assert.deepEqual(dmTarget("", me), { error: null });
  assert.deepEqual(dmTarget(null, me), { error: null });
});

test("draftFromLink: one line, capped, no control characters", () => {
  assert.equal(draftFromLink(null), undefined);
  assert.equal(draftFromLink("   "), undefined);
  assert.equal(draftFromLink("Re: your ETH LONG call — "), "Re: your ETH LONG call — ");
  assert.equal(draftFromLink("a\u0000\nb"), "a b");
  assert.equal(draftFromLink("x".repeat(500)).length, 200);
});

test("relativeAge", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const ns = (ms) => BigInt(ms) * 1_000_000n;
  assert.equal(relativeAge(ns(now - 5e3), now), "now");
  assert.equal(relativeAge(ns(now + 60e3), now), "now", "clock skew never reads negative");
  assert.equal(relativeAge(ns(now - 5 * 60e3), now), "5m");
  assert.equal(relativeAge(ns(now - 3 * 3600e3), now), "3h");
  assert.equal(relativeAge(ns(now - 2 * 86400e3), now), "2d");
  assert.equal(relativeAge(null, now), "");
});

test("the hook asks for chat messages only, newest first for previews, by last activity", () => {
  const hook = read("../hooks/useXMTP.ts");
  assert.match(hook, /convo\.messages\(\{ direction: XMTP_SORT_ASC, kind: XMTP_KIND_APPLICATION \}\)/);
  assert.match(hook, /limit: 1n, direction: XMTP_SORT_DESC, kind: XMTP_KIND_APPLICATION/);
  assert.match(hook, /excludeSenderInboxIds: \[notFrom\]/);
  assert.match(hook, /list\(\{ orderBy: XMTP_ORDER_LAST_ACTIVITY \}\)/);
  assert.doesNotMatch(hook, /return convo\.messages\(\);/);
});

test("the badge syncs once and reads each thread's newest inbound message", () => {
  const nav = read("../components/MessagesNavButton.tsx");
  assert.match(nav, /getConversations\(\{ syncMessages: true \}\)/);
  assert.match(nav, /lastMessage\(c, myInboxId\)/);
  assert.doesNotMatch(nav, /getMessages\(/, "no per-thread full sync + full history read");
  assert.match(nav, /if \(running\.current\) \{ again\.current = true; return; \}/);
});

test("the page: no placeholder bubbles, the ?dm= link never fails silently", () => {
  const page = read("../pages/messages/index.tsx");
  assert.doesNotMatch(page, /\[unsupported content\]/);
  assert.doesNotMatch(page, /convo\.messages\(\{ limit: 1n \}\)/, "the oldest-message preview is gone");
  assert.doesNotMatch(page, /\.scrollIntoView\(/, "scroll the thread, not the page");
  const link = page.slice(page.indexOf("a ?dm= link opens"), page.indexOf("async function startDM()"));
  assert.match(link, /dmTarget\(dmParam, xmtp\.myAddress, \{ fromLink: true \}\)/);
  assert.match(link, /canMessage\(t\.addr\)\)\) \{ if \(!cancelled\) setInviteAddr\(t\.addr\)/);
  assert.match(link, /setDmError\(`Couldn’t open that conversation/);
  assert.doesNotMatch(link, /\.catch\(\(\) => \{\}\)/);
  assert.match(page, /draftFromLink\(reParam\)/);
  assert.match(page, /fontSize: 16, \/\/ 16px/);
});
