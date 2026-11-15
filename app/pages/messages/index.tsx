/**
 * /messages — XMTP encrypted wallet-to-wallet DMs
 *
 * URL: /messages          — inbox (conversation list)
 * URL: /messages?dm=0x…   — auto-opens a DM with that wallet address
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAccount } from "@orderly.network/hooks";
import { useXMTP } from "@/hooks/useXMTP";
import type { Conversation, DecodedMessage } from "@/hooks/useXMTP";
import { markConvoRead } from "@/utils/xmtpUnread";
import { pressKey } from "@/utils/a11y";
import { errText } from "@/pages/lab/helpers";
import { visibleMessages, mergeStreamed, previewText, messageText, dmTarget, draftFromLink, relativeAge } from "@/lib/xmtpMessages.mjs";

// ─── Responsive hook ───────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (addr.length === 42 && addr.startsWith("0x")) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  return `${addr.slice(0, 8)}…`;
}

// Resolve peer wallet address from conversation members
async function resolvePeer(convo: Conversation, myInboxId: string | null): Promise<string | null> {
  try {
    const members = await convo.members();
    const peer = members.find((m) => m.inboxId !== myInboxId);
    return peer?.accountIdentifiers?.[0]?.identifier ?? null;
  } catch {
    return null;
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  page: {
    background: "#0a0a0b",
    minHeight: "100svh",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    padding: "8px 16px",
    borderBottom: "1px solid #232327",
    background: "#0f0f11",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  headerLabel: {
    fontFamily: "var(--nx-font-mono)",
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "#52525b",
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#ededf0",
    fontFamily: "var(--nx-font-mono)",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
    padding: "2px 8px 2px 0",
    marginRight: 2,
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    height: "calc(100dvh - 42px)",
  },
  sidebar: {
    width: 260,
    borderRight: "1px solid #232327",
    display: "flex",
    flexDirection: "column" as const,
    background: "#0f0f11",
    flexShrink: 0,
  },
  sidebarHeader: {
    padding: "10px 14px",
    borderBottom: "1px solid #232327",
    fontFamily: "var(--nx-font-mono)",
    fontSize: 9,
    letterSpacing: "0.1em",
    color: "#52525b",
  },
  convoList: {
    flex: 1,
    overflowY: "auto" as const,
  },
  convoItem: (active: boolean): React.CSSProperties => ({
    padding: "12px 14px",
    borderBottom: "1px solid #141416",
    cursor: "pointer",
    background: active ? "#1a1a1e" : "transparent",
    borderLeft: active ? "2px solid #ededf0" : "2px solid transparent",
  }),
  convoName: {
    fontFamily: "var(--nx-font-mono)",
    fontSize: 12,
    color: "#a1a1aa",
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  convoPreview: {
    fontFamily: "var(--nx-font-ui, sans-serif)",
    fontSize: 11.5,
    color: "#71717a",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  thread: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  threadHeader: {
    padding: "10px 16px",
    borderBottom: "1px solid #232327",
    background: "#0f0f11",
    fontFamily: "var(--nx-font-mono)",
    fontSize: 11,
    color: "#a1a1aa",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  bubble: (isMine: boolean): React.CSSProperties => ({
    maxWidth: "72%",
    alignSelf: isMine ? "flex-end" : "flex-start",
    background: isMine ? "#1a1a1e" : "#0f0f11",
    border: `1px solid ${isMine ? "#33333a" : "#232327"}`,
    borderRadius: isMine ? "8px 8px 0 8px" : "8px 8px 8px 0",
    padding: "8px 12px",
  }),
  bubbleText: (isMine: boolean): React.CSSProperties => ({
    fontFamily: "var(--nx-font-ui, sans-serif)",
    fontSize: 13.5,
    color: isMine ? "#ededf0" : "#d4d4d8",
    lineHeight: 1.5,
    overflowWrap: "anywhere" as const,
    whiteSpace: "pre-wrap" as const,
  }),
  bubbleTime: {
    fontFamily: "var(--nx-font-mono)",
    fontSize: 9.5,
    color: "#71717a",
    marginTop: 4,
    textAlign: "right" as const,
  },
  compose: {
    padding: "10px 16px",
    borderTop: "1px solid #232327",
    background: "#0f0f11",
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    background: "#141416",
    border: "1px solid #232327",
    borderRadius: 4,
    color: "#ededf0",
    fontFamily: "var(--nx-font-ui, sans-serif)",
    fontSize: 16, // 16px: no zoom-on-focus on a phone, readable while typing
    padding: "8px 10px",
    outline: "none",
    resize: "none" as const,
    minHeight: 38,
    maxHeight: 120,
  },
  sendBtn: (disabled: boolean): React.CSSProperties => ({
    background: disabled ? "#0f0f11" : "#1a1a1e",
    border: `1px solid ${disabled ? "#232327" : "#ededf0"}`,
    borderRadius: 4,
    color: disabled ? "#33333a" : "#ededf0",
    fontFamily: "var(--nx-font-mono)",
    fontSize: 11,
    letterSpacing: "0.08em",
    padding: "8px 14px",
    minHeight: 40,
    cursor: disabled ? "default" : "pointer",
    flexShrink: 0,
    alignSelf: "flex-end",
  }),
  center: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 12,
    padding: 32,
  },
  centerLabel: {
    fontFamily: "var(--nx-font-mono)",
    fontSize: 12,
    color: "#71717a",
    textAlign: "center" as const,
    lineHeight: 1.6,
    maxWidth: 320,
  },
  enableBtn: {
    background: "#1a1a1e",
    border: "1px solid #ededf0",
    borderRadius: 4,
    color: "#ededf0",
    fontFamily: "var(--nx-font-mono)",
    fontSize: 10,
    letterSpacing: "0.1em",
    padding: "10px 24px",
    cursor: "pointer",
  },
  errText: {
    fontFamily: "var(--nx-font-mono)",
    fontSize: 11,
    color: "#f7525f",
    textAlign: "center" as const,
    maxWidth: 320,
  },
};

// ─── Conversation Item ────────────────────────────────────────────────────────

function ConvoItem({
  convo,
  active,
  myInboxId,
  lastMessage,
  onClick,
}: {
  convo: Conversation;
  active: boolean;
  myInboxId: string | null;
  lastMessage: (c: Conversation) => Promise<DecodedMessage | null>;
  onClick: () => void;
}) {
  const [lastMsg, setLastMsg] = useState<DecodedMessage | null>(null);
  const [peerDisplay, setPeerDisplay] = useState<string>("…");

  useEffect(() => {
    // The NEWEST chat message (the SDK's default order + limit 1 gave the oldest: a setup message)
    lastMessage(convo).then(setLastMsg).catch(() => {});
    // Resolve peer wallet address from conversation members
    resolvePeer(convo, myInboxId).then((addr) => {
      if (addr) setPeerDisplay(shortAddr(addr));
    });
  }, [convo, myInboxId, lastMessage]);

  const preview = previewText(lastMsg);
  return (
    <div role="button" tabIndex={0} style={S.convoItem(active)} onClick={onClick} onKeyDown={pressKey(onClick)}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <div style={{ ...S.convoName, flex: 1, minWidth: 0 }}>{peerDisplay}</div>
        {lastMsg && <span style={{ ...S.convoPreview, flexShrink: 0 }}>{relativeAge(lastMsg.sentAtNs)}</span>}
      </div>
      <div style={S.convoPreview}>{preview ?? "no messages yet"}</div>
    </div>
  );
}

// ─── Thread View ──────────────────────────────────────────────────────────────

function ThreadView({
  convo,
  myInboxId,
  getMessages,
  streamMessages,
  peerAddressHint,
  initialDraft,
}: {
  convo: Conversation;
  myInboxId: string | null;
  getMessages: (c: Conversation) => Promise<DecodedMessage[]>;
  streamMessages: (c: Conversation, onMessage: (msg: DecodedMessage) => void) => Promise<() => void>;
  peerAddressHint?: string;
  initialDraft?: string;
}) {
  const [messages, setMessages] = useState<DecodedMessage[]>([]);
  // Seed the composer with the "Re: your … call" draft when the thread was opened
  // from a call. ThreadView is keyed by convo.id, so this re-inits per thread.
  const [text, setText] = useState(initialDraft ?? "");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [peerDisplay, setPeerDisplay] = useState<string>(
    peerAddressHint ? shortAddr(peerAddressHint) : shortAddr(convo.id)
  );
  const listRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!peerAddressHint) {
      resolvePeer(convo, myInboxId).then((addr) => {
        if (addr) setPeerDisplay(shortAddr(addr));
      });
    }
  }, [convo, myInboxId, peerAddressHint]);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await getMessages(convo);
      // keep a just-sent placeholder until its real copy is in the list
      setMessages((prev) => {
        const shown = visibleMessages(msgs) as DecodedMessage[];
        const pending = prev.filter((m) => String((m as { id?: string }).id ?? "").startsWith("optimistic_")
          && !shown.some((x) => x.senderInboxId === m.senderInboxId && messageText(x) === messageText(m)));
        return [...shown, ...pending];
      });
    } catch {
      // silent — stale state is fine
    }
  }, [convo, getMessages]);

  useEffect(() => {
    loadMessages();
    // Slow safety-net poll — the live stream below handles real-time delivery,
    // this just reconciles if the stream ever drops.
    pollRef.current = setInterval(loadMessages, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMessages]);

  // Real-time message stream — near-instant inbound, no polling delay.
  useEffect(() => {
    let cancelled = false;
    let closer: (() => void) | null = null;
    streamMessages(convo, (msg) => {
      // drops our placeholders, skips duplicates and anything with no text (read receipts, setup)
      setMessages((prev) => mergeStreamed(prev, msg) as DecodedMessage[]);
    })
      .then((c) => { if (cancelled) c(); else closer = c; })
      .catch(() => { /* stream unavailable — safety-net poll covers it */ });
    return () => { cancelled = true; if (closer) closer(); };
  }, [convo, streamMessages]);

  // Mark this thread read while it's open (clears the nav unread badge)
  useEffect(() => {
    markConvoRead(convo.id);
  }, [convo.id, messages.length]);

  // Scroll the thread itself to the newest message. scrollIntoView moved the whole page on
  // a phone (the compose bar and header with it).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);

    // Optimistic render — show the message instantly, reconcile on next load.
    const optimistic = {
      id: `optimistic_${Date.now()}`,
      senderInboxId: myInboxId,
      content: trimmed,
      sentAtNs: BigInt(Date.now()) * 1_000_000n,
    } as unknown as DecodedMessage;
    setMessages((prev) => [...prev, optimistic]);
    setText("");

    try {
      await convo.sendText(trimmed);
      await loadMessages();
    } catch (e) {
      // Roll back the optimistic bubble and let the user retry
      setMessages((prev) => prev.filter((m) => (m as { id?: string }).id !== optimistic.id));
      setText(trimmed);
      setSendError(`Didn’t send: ${errText(e)}. Your text is back in the box.`);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <div style={S.threadHeader}>
        <span style={{ color: "#ededf0", fontSize: 10 }}>⬡</span>
        {peerDisplay}
        <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9.5, whiteSpace: "nowrap", color: "#71717a", marginLeft: "auto" }}>
          end-to-end encrypted · XMTP
        </span>
      </div>

      <div ref={listRef} style={S.messages}>
        {messages.length === 0 && (
          <div style={{ ...S.centerLabel, alignSelf: "center", marginTop: 40 }}>
            no messages yet — say something
          </div>
        )}
        {messages.map((msg, i) => {
          const isMine = msg.senderInboxId === myInboxId;
          const pending = String((msg as { id?: string }).id ?? "").startsWith("optimistic_");
          return (
            <div key={(msg as { id?: string }).id ?? i} style={S.bubble(isMine)}>
              <div style={S.bubbleText(isMine)}>{messageText(msg)}</div>
              <div style={S.bubbleTime}>{pending ? "sending…" : relativeAge(msg.sentAtNs)}</div>
            </div>
          );
        })}
      </div>

      {sendError && (
        <div style={{ padding: "5px 12px", fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#f7525f" }}>
          {sendError}
        </div>
      )}
      <div style={S.compose}>
        <textarea
          style={S.input}
          placeholder="message... (enter to send)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <button
          style={S.sendBtn(!text.trim() || sending)}
          onClick={send}
          disabled={!text.trim() || sending}
        >
          {sending ? "..." : "SEND →"}
        </button>
      </div>
    </>
  );
}

// ─── Messages Page ────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { state: accountState } = useAccount();
  const walletAddress = (accountState as { address?: string })?.address ?? null;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dmParam = searchParams.get("dm");
  const reParam = searchParams.get("re"); // "Re: your ZEC LONG call — " context seed

  const xmtp = useXMTP();
  const { ready, initializing, error, init, getConversations, lastMessage, getMessages, streamMessages, myInboxId, deviceLimit, revoking, revokeOldDevices } = xmtp;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const isMobile = useIsMobile();
  const [activePeerHint, setActivePeerHint] = useState<string | undefined>(undefined);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [dmAddress, setDmAddress] = useState("");
  const [openingDM, setOpeningDM] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [inviteAddr, setInviteAddr] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  // Back: on a phone, step out of an open thread first; else history; else the feed.
  const goBack = useCallback(() => {
    if (isMobile && activeConvo) { setActiveConvo(null); return; }
    if (typeof window !== "undefined" && window.history.length > 1) navigate(-1);
    else navigate("/feed");
  }, [navigate, isMobile, activeConvo]);

  // Load conversations once XMTP is ready; a ?dm= link opens (or offers an invite to) that wallet
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoadingConvos(true);
    (async () => {
      let convos: Conversation[] = [];
      try {
        convos = await getConversations();
        if (cancelled) return;
        setConversations(convos);
      } catch { /* the list stays empty; the DM box still works */ }
      finally { if (!cancelled) setLoadingConvos(false); }
      if (!dmParam) return;
      // The link used to call openDM with whatever it held and swallow any failure, so a bad
      // address, your own, or a wallet not on XMTP yet opened nothing and said nothing.
      const t = dmTarget(dmParam, xmtp.myAddress, { fromLink: true });
      if (!t.addr) { if (t.error) setDmError(t.error); return; }
      for (const c of convos) {
        const peer = await resolvePeer(c, myInboxId);
        if (cancelled) return;
        if (peer?.toLowerCase() === t.addr) { setActiveConvo(c); setActivePeerHint(t.addr); return; }
      }
      try {
        if (!(await xmtp.canMessage(t.addr))) { if (!cancelled) setInviteAddr(t.addr); return; }
        const convo = await xmtp.openDM(t.addr);
        if (cancelled) return;
        setActiveConvo(convo);
        setActivePeerHint(t.addr);
        setConversations((prev) => (prev.some((c) => c.id === convo.id) ? prev : [convo, ...prev]));
      } catch (e) {
        if (!cancelled) setDmError(`Couldn’t open that conversation: ${errText(e)}`);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function startDM() {
    const addr = dmAddress.trim();
    if (!addr || openingDM) return;
    setDmError(null);
    setInviteAddr(null);

    // Validate address shape before hitting the network (one rule with the ?dm= link)
    const t = dmTarget(addr, xmtp.myAddress);
    if (!t.addr) {
      setDmError(t.error ?? null);
      return;
    }

    setOpeningDM(true);
    try {
      // XMTP can only message wallets that have registered an XMTP identity.
      // Check first so we can offer an invite instead of failing silently.
      const reachable = await xmtp.canMessage(addr);
      if (!reachable) {
        setInviteAddr(addr);
        return;
      }
      const convo = await xmtp.openDM(addr);
      setActiveConvo(convo);
      setActivePeerHint(addr);
      setConversations((prev) => {
        const already = prev.find((c) => c.id === convo.id);
        return already ? prev : [convo, ...prev];
      });
      setDmAddress("");
    } catch (e) {
      setDmError(`Couldn’t start that conversation: ${errText(e)}`);
    } finally {
      setOpeningDM(false);
    }
  }

  if (!walletAddress) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <button onClick={goBack} style={S.backBtn} aria-label="Back" title="Back">‹</button>
          <span style={S.headerLabel}>■ MESSAGES</span>
        </div>
        <div style={S.center}>
          <div style={S.centerLabel}>connect your wallet to use encrypted messaging</div>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <button onClick={goBack} style={S.backBtn} aria-label="Back" title="Back">‹</button>
          <span style={S.headerLabel}>■ MESSAGES</span>
        </div>
        <div style={S.center}>
          <div style={{ fontSize: 24, color: "#52525b" }}>⬡</div>
          <div style={S.centerLabel}>
            wallet-to-wallet encrypted DMs powered by XMTP
            <br />
            <span style={{ color: "#71717a", fontSize: 10.5 }}>
              you’ll sign twice — once for the encryption key, once to register
            </span>
          </div>
          {deviceLimit ? (
            <>
              <div style={{ ...S.centerLabel, color: "#a1a1aa", maxWidth: 320, lineHeight: 1.6 }}>{error}</div>
              <button
                style={S.enableBtn}
                disabled={revoking || initializing}
                onClick={async () => { if (await revokeOldDevices()) await init(); }}
              >
                {revoking ? "removing..." : initializing ? "enabling..." : "REMOVE OLD DEVICES"}
              </button>
              <div style={{ color: "#71717a", fontSize: 10.5, fontFamily: "var(--nx-font-mono)", maxWidth: 320, lineHeight: 1.6, textAlign: "center" }}>
                Keeps your 3 newest devices. One signature. Removed devices stop getting messages until you turn messaging on there again.
              </div>
            </>
          ) : (
            <>
              {error && <div style={S.errText}>{error}</div>}
              <button style={S.enableBtn} onClick={init} disabled={initializing}>
                {initializing ? "enabling..." : "ENABLE MESSAGING"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <button onClick={goBack} style={S.backBtn} aria-label="Back" title="Back">‹</button>
        <span style={S.headerLabel}>■ MESSAGES</span>
        <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9.5, whiteSpace: "nowrap", color: "#71717a", marginLeft: "auto" }}>
          ⬡ XMTP · end-to-end encrypted
        </span>
      </div>

      <div style={S.body}>
        {/* Sidebar — conversation list (full-width on mobile, hidden when a thread is open) */}
        <div style={{ ...S.sidebar, ...(isMobile ? { width: "100%", borderRight: "none", display: activeConvo ? "none" : "flex" } : {}) }}>
          <div style={S.sidebarHeader}>CONVERSATIONS</div>

          {/* New DM input */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #232327", display: "flex", gap: 6 }}>
            <input
              style={{
                flex: 1, background: "#141416", border: "1px solid #232327", borderRadius: 3,
                minWidth: 0, color: "#ededf0", fontFamily: "var(--nx-font-mono)", fontSize: 16, padding: "6px 8px", outline: "none",
              }}
              placeholder="0x… new DM"
              value={dmAddress}
              onChange={(e) => setDmAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") startDM(); }}
            />
            <button
              onClick={startDM}
              disabled={!dmAddress.trim() || openingDM}
              aria-label="Start a DM"
              style={{
                background: "none", border: "1px solid #33333a", borderRadius: 3,
                color: "#d4d4d8", fontFamily: "var(--nx-font-ui)", fontSize: 16,
                minWidth: 40, padding: "4px 8px", cursor: "pointer", flexShrink: 0,
              }}
            >
              {openingDM ? "…" : "+"}
            </button>
          </div>
          {dmError && (
            <div style={{ padding: "6px 10px", borderBottom: "1px solid #232327", fontFamily: "var(--nx-font-ui)", fontSize: 11.5, color: "#f7525f", lineHeight: 1.5 }}>
              {dmError}
            </div>
          )}
          {inviteAddr && (() => {
            const inviteLink = `${window.location.origin}/messages?dm=${(xmtp.myAddress ?? "").toLowerCase()}`;
            const copy = async () => {
              try {
                await navigator.clipboard.writeText(inviteLink);
                setInviteCopied(true);
                setTimeout(() => setInviteCopied(false), 2000);
              } catch { /* clipboard blocked — user can select manually */ }
            };
            return (
              <div style={{ padding: "8px 10px", borderBottom: "1px solid #232327", background: "#1a1a1e" }}>
                <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 11.5, color: "#d4d4d8", lineHeight: 1.5, marginBottom: 6 }}>
                  {shortAddr(inviteAddr)} isn’t on XMTP yet. Send them this link — it opens Messages and pre-fills a DM back to you:
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    readOnly
                    value={inviteLink}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: 1, minWidth: 0, background: "#141416", border: "1px solid #33333a", borderRadius: 3, color: "#a1a1aa", fontFamily: "var(--nx-font-mono)", fontSize: 10, padding: "5px 7px", outline: "none" }}
                  />
                  <button
                    onClick={copy}
                    style={{ background: "none", border: "1px solid #33333a", borderRadius: 3, color: "#d4d4d8", fontFamily: "var(--nx-font-ui)", fontSize: 12, padding: "4px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {inviteCopied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <button
                  onClick={() => { setInviteAddr(null); setDmAddress(""); }}
                  style={{ marginTop: 6, background: "none", border: "none", color: "#52525b", fontFamily: "var(--nx-font-ui)", fontSize: 12, cursor: "pointer", padding: 0 }}
                >
                  dismiss
                </button>
              </div>
            );
          })()}

          <div style={S.convoList}>
            {loadingConvos && (
              <div style={{ padding: 14, fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#71717a" }}>
                loading...
              </div>
            )}
            {!loadingConvos && conversations.length === 0 && (
              <div style={{ padding: 14, fontFamily: "var(--nx-font-ui)", fontSize: 11.5, color: "#71717a", lineHeight: 1.6 }}>
                no conversations yet
                <br />paste a wallet address above
              </div>
            )}
            {conversations.map((convo) => (
              <ConvoItem
                key={convo.id}
                convo={convo}
                active={activeConvo?.id === convo.id}
                myInboxId={myInboxId}
                lastMessage={lastMessage}
                onClick={() => {
                  setActiveConvo(convo);
                  setActivePeerHint(undefined);
                }}
              />
            ))}
          </div>
        </div>

        {/* Thread panel (hidden on mobile until a conversation is selected) */}
        <div style={{ ...S.thread, ...(isMobile && !activeConvo ? { display: "none" } : {}) }}>
          {activeConvo ? (
            <>
              {isMobile && (
                <button
                  onClick={() => setActiveConvo(null)}
                  style={{ background: "none", border: "none", borderBottom: "1px solid #232327", color: "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 12.5, padding: "10px 14px", cursor: "pointer", textAlign: "left", width: "100%" }}
                >
                  ← conversations
                </button>
              )}
              <ThreadView
                key={activeConvo.id}
                convo={activeConvo}
                myInboxId={myInboxId}
                getMessages={getMessages}
                streamMessages={streamMessages}
                peerAddressHint={activePeerHint}
                // Only seed the draft on the thread we auto-opened from a call link,
                // never when the user hand-picks another conversation.
                initialDraft={activePeerHint && dmParam && activePeerHint.toLowerCase() === dmParam.toLowerCase() ? draftFromLink(reParam) : undefined}
              />
            </>
          ) : (
            <div style={S.center}>
              <div style={{ fontSize: 28, color: "#52525b" }}>⬡</div>
              <div style={S.centerLabel}>
                select a conversation or paste a wallet address to start a new DM
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
