import { chat } from "./llm.ts";

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
    parsed = JSON.parse(raw);
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
    amount_cents: amount,
    category: typeof parsed.category === "string" ? parsed.category : "uncategorized",
  };
}
