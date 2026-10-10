import { env } from "./env.ts";

// Deterministic LLM call: temperature 0. max_tokens is generous because reasoning
// models (nemotron-3.5) spend the budget on thinking before emitting JSON — cutting
// it off produces truncated output that never contains the JSON. reasoning.effort
// "low" asks the model to think less where the API supports it.
export async function chat(messages: { role: "system" | "user"; content: string }[]): Promise<string> {
  // 30s cap: a hung OpenRouter call would otherwise block the whole decide() path
  // indefinitely (no server-side timeout). AbortError surfaces as a normal throw.
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.openrouterApiKey()}`,
    },
    body: JSON.stringify({
      model: env.openrouterModel(),
      messages,
      temperature: 0,
      max_tokens: 4096,
      reasoning: { effort: "low" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`LLM failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data?.choices?.[0]?.message?.content;
  // {choices: []} or a null content happens on rate-limits/model downtime — fail
  // clean instead of a TypeError on undefined; the caller turns this into a DENY.
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM returned no content (empty choices or null message)");
  }
  return content;
}
