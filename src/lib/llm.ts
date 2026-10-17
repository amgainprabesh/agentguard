import { env } from "./env.ts";

// Deterministic LLM call: temperature 0. max_tokens is generous because reasoning
// models (nemotron-3.5) spend the budget on thinking before emitting JSON — cutting
// it off produces truncated output that never contains the JSON. reasoning.effort
// "low" asks the model to think less where the API supports it.
//
// measured latency of the free nemotron-3.5 model on the intent prompt: median
// ~15s, tail to ~40s. The 90s timeout is set from those samples — a 30s cap
// (tried first) aborted roughly 1 call in 5 and made the live check flaky.
const TIMEOUT_MS = 90_000;

export async function chat(messages: { role: "system" | "user"; content: string }[]): Promise<string> {
  // Retry once on timeout/5xx: the free tier's tail latency (and occasional
  // empty-choices 200s) are transient, and a retry costs seconds, not a DENY.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 429/5xx are transient on the free tier — retry once; 4xx is a real error.
      if (res.status === 429 || res.status >= 500) throw new Error(`LLM transient: ${res.status}`);
      if (!res.ok) {
        console.error(`LLM failed: ${res.status} ${await res.text()}`);
        throw new Error(`LLM failed: ${res.status}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data?.choices?.[0]?.message?.content;
      // {choices: []} or a null content happens on rate-limits/model downtime —
      // treat as transient and retry once; the caller turns a final failure into a DENY.
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("LLM returned no content (empty choices or null message)");
      }
      return content;
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      const transient = msg.includes("transient") || msg.includes("no content") || msg.includes("aborted");
      if (!transient || attempt === 1) throw e;
    }
  }
  throw lastErr;
}
