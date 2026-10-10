import { chat } from "./llm.ts";

// Extracts the JSON object from an LLM response that may be wrapped in thinking
// prose ("Here's a thinking process: ... {json} ..."). Takes the substring from
// the first "{" to the matching last "}"; throws if none found.
// Not exported: only extractIntent consumes it, and it has no external callers.
function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(`no JSON object found in LLM output: ${raw.slice(0, 200)}`);
  }
  return raw.slice(start, end + 1);
}

// Messy natural-language request → structured spend intent. Throws on any LLM or
// parse failure: a failed extraction is a DENY, never a guessed intent.
export async function extractIntent(
  request: string,
): Promise<{ vendor: string; amount_cents: number; category: string }> {
  const prompt = [
    "Extract a purchase intent from this request. Reply with JSON ONLY, no prose:",
    '{"vendor": "<domain>", "amount_cents": <integer>, "category": "<one word>"}',
    "Convert dollars to cents (e.g. $42.50 → 4250).",
    "",
    "Request:",
    request,
  ].join("\n");

  let raw: string;
  try {
    raw = await chat([{ role: "user", content: prompt }]);
  } catch (e) {
    throw new Error(`intent LLM failed: ${e}`);
  }

  let parsed: { vendor?: unknown; amount_cents?: unknown; category?: unknown };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(`intent parse failed — not JSON: ${raw.slice(0, 200)}`);
  }

  const amount = typeof parsed.amount_cents === "number" ? parsed.amount_cents : NaN;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(
      `intent parse failed — amount_cents must be a positive integer, got: ${raw.slice(0, 200)}`,
    );
  }
  if (typeof parsed.vendor !== "string" || !parsed.vendor) {
    throw new Error(`intent parse failed — no vendor in: ${raw.slice(0, 200)}`);
  }

  return {
    vendor: parsed.vendor,
    // clamp: the LLM's arithmetic is untrusted — an absurd amount (prompt injection,
    // misread "5 million") would flow into the ledger and the DENY reason string
    amount_cents: Math.min(amount, 100_000_000),
    category: typeof parsed.category === "string" ? parsed.category : "uncategorized",
  };
}
