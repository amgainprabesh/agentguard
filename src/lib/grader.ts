import { chat } from "./llm.ts";

// Real grader: rubric + submission → strict-JSON score from the LLM (temperature 0).
// Throws on any LLM or parse failure — the caller marks the deal FAILED, never
// silently settles with a fake score.
export async function gradeSubmission(
  submission: string,
  rubric: { criterion: string; weight: number }[],
): Promise<{ score: number; breakdown: { criterion: string; score: number }[] }> {
  const prompt = [
    "You grade a submission against a rubric. Reply with JSON ONLY, no prose:",
    '{"score": 0-100 integer, "breakdown": [{"criterion": "<name>", "score": 0-100}]}',
    "",
    "Rubric criteria:",
    ...rubric.map((r, i) => `${i + 1}. ${r.criterion} (weight ${r.weight})`),
    "",
    "Submission:",
    submission,
  ].join("\n");

  let raw: string;
  try {
    raw = await chat([{ role: "user", content: prompt }]);
  } catch (e) {
    throw new Error(`grader LLM failed: ${e}`);
  }

  let parsed: { score?: unknown; breakdown?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`grader parse failed — LLM did not return JSON: ${raw.slice(0, 200)}`);
  }

  const score = typeof parsed.score === "number" ? parsed.score : NaN;
  if (!Number.isFinite(score)) {
    throw new Error(`grader parse failed — no numeric score in: ${raw.slice(0, 200)}`);
  }
  const breakdown = Array.isArray(parsed.breakdown)
    ? (parsed.breakdown as { criterion: string; score: number }[])
    : [];

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    breakdown,
  };
}
