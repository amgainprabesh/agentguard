// Error responses used to be `String(e)` — the raw exception text, e.g.
// "Error: approval not-a-real-id not found", and worse: a failed PayPal fetch
// throws with the full vendor response body, and the intent-parse error
// embeds raw LLM output. Only KNOWN validation errors are safe to echo —
// their messages are ours, not a vendor's. Everything else becomes the
// generic fallback so no internals leak. The UI shows these as
// "Rejected: …", so validation errors must keep their message.
//
// Pure string function (no next/server import) so it unit-tests with plain
// node:test — the routes wrap it:
// NextResponse.json({ error: errorMessage(e, "…") }, { status: 400 }).
const SAFE_PREFIXES = [
  "card.", // validateCard(): "card.number must be 13-19 digits", "card.expiry is in the past", …
  "mandate.", // MandateStore.validate(): "mandate.velocity_max_per_hour must be at least 1"
  "request ", // the decide route's own emptiness/length checks
  "approval ", // "approval <id> not found" / "…lost to a server restart"
];

const MAX_ERROR_LEN = 200;

export function errorMessage(e: unknown, fallback = "internal error"): string {
  const msg = e instanceof Error ? e.message : String(e);
  const safe =
    msg.length > 0 &&
    msg.length <= MAX_ERROR_LEN &&
    SAFE_PREFIXES.some((p) => msg.startsWith(p));
  return safe ? msg : fallback;
}
