import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OPENROUTER_API_KEY = "test-key";

const { gradeSubmission } = await import("./grader.ts");

function mockLlm(content: string) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  return () => {
    globalThis.fetch = original;
  };
}

test("parses a clean LLM JSON response", async () => {
  const restore = mockLlm(JSON.stringify({ score: 83, breakdown: [{ criterion: "quality", score: 83 }] }));
  try {
    const r = await gradeSubmission("work", [{ criterion: "quality", weight: 1 }]);
    assert.equal(r.score, 83);
    assert.equal(r.breakdown[0].criterion, "quality");
  } finally {
    restore();
  }
});

test("score is clamped to 0..100 (LLM may misbehave)", async () => {
  const restore = mockLlm(JSON.stringify({ score: 250, breakdown: [] }));
  try {
    const r = await gradeSubmission("work", []);
    assert.equal(r.score, 100);
  } finally {
    restore();
  }
});

test("throws on malformed LLM output (no silent 75)", async () => {
  const restore = mockLlm("not json at all");
  try {
    await assert.rejects(() => gradeSubmission("work", []), /grader parse failed/);
  } finally {
    restore();
  }
});

test("non-200 from OpenRouter throws (route returns 400, deal not settled)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  try {
    await assert.rejects(() => gradeSubmission("work", []), /grader LLM failed/);
  } finally {
    globalThis.fetch = original;
  }
});
