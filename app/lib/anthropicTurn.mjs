// ── One Anthropic turn, read the way the newer models need it ──────────────────────────────
// Claude Sonnet 5.5 / Opus 5.5 / Fable 5.1 (and the rest of the 5.x line) always think. Three
// things follow for the copilot (app/config/assistant.ts), hosted or bring-your-own-key:
//   1. Thinking counts toward max_tokens, so a 1024 ceiling can end the turn before any answer.
//      These models get 4096 and effort "low" (short thinking); older models keep 1024.
//   2. A response can start with a `thinking` block, so text is read by block TYPE, never
//      `content[0]`.
//   3. In the tool loop the assistant turn is sent back, and its thinking blocks must come back
//      unchanged (text + signature). The old stream reader rewrote every non-tool block as an
//      empty text block, which these models reject.
// A refusal (`stop_reason: "refusal"`) and a turn cut off at max_tokens get a plain line instead
// of "(empty response)". Pure; no network.

export const MAX_TOKENS = 1024;
export const THINKING_MAX_TOKENS = 4096;

/** Models whose thinking can't be turned off (the 5.x line, Fable, Mythos). */
export function isThinkingModel(id) {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(String(id || ""));
}

/** Token ceiling + effort for a request. The hosted proxy re-applies its own copy server-side. */
export function requestLimits(model) {
  return isThinkingModel(model)
    ? { max_tokens: THINKING_MAX_TOKENS, output_config: { effort: "low" } }
    : { max_tokens: MAX_TOKENS };
}

/** Joined text of a response's text blocks, whatever else the content holds. */
export function textOf(content) {
  return (Array.isArray(content) ? content : [])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** The line shown when a turn ends without text: a refusal, a cut-off, or plain empty. */
export function emptyTurnText(stopReason) {
  if (stopReason === "refusal") return "The model declined this request. Rephrase it, or pick another model in ⚙.";
  if (stopReason === "max_tokens") return "Ran out of room before answering. Ask a narrower question.";
  return "(empty response)";
}

/**
 * Rebuilds one streamed message from its SSE events. `push(ev)` for every event; `content()`
 * returns the blocks in order, replayable as the assistant turn: thinking with its signature,
 * redacted thinking with its data, text, and tool_use with parsed input. Any other block type
 * is kept as its content_block_start object, so nothing is rewritten.
 */
export function createStreamAssembler(onText) {
  const blocks = new Map();
  let stopReason = null;
  return {
    push(ev) {
      const type = ev && ev.type;
      if (type === "content_block_start") {
        const cb = ev.content_block || { type: "text", text: "" };
        if (cb.type === "tool_use") blocks.set(ev.index, { type: "tool_use", id: cb.id, name: cb.name, json: "" });
        else if (cb.type === "thinking") blocks.set(ev.index, { type: "thinking", thinking: cb.thinking || "", signature: cb.signature || "" });
        else if (cb.type === "text") blocks.set(ev.index, { type: "text", text: cb.text || "" });
        else blocks.set(ev.index, { ...cb });
      } else if (type === "content_block_delta") {
        const b = blocks.get(ev.index);
        const d = ev.delta || {};
        if (!b) return;
        if (d.type === "text_delta" && typeof d.text === "string") {
          b.text = (b.text || "") + d.text;
          if (onText && d.text) onText(d.text);
        } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
          b.json = (b.json || "") + d.partial_json;
        } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
          b.thinking = (b.thinking || "") + d.thinking;
        } else if (d.type === "signature_delta" && typeof d.signature === "string") {
          b.signature = d.signature;
        }
      } else if (type === "message_delta") {
        const sr = ev.delta && ev.delta.stop_reason;
        if (sr) stopReason = sr;
      }
    },
    get stopReason() { return stopReason; },
    content() {
      return [...blocks.keys()].sort((a, b) => a - b).map((k) => {
        const b = blocks.get(k);
        if (b.type !== "tool_use") return b;
        let input = {};
        try { input = JSON.parse(b.json || "{}"); } catch { input = {}; }
        return { type: "tool_use", id: b.id, name: b.name, input };
      });
    },
  };
}
