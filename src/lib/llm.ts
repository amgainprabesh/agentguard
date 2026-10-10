import { env } from "./env.ts";

// Wired now, consumed in Sprint 2 (the grader / intent extraction). Grader must be
// deterministic: temperature 0 + strict JSON is enforced at call sites.
export async function chat(messages: { role: "system" | "user"; content: string }[]): Promise<string> {
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
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`LLM failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}
