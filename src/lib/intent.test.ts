import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OPENROUTER_API_KEY = "test-key";

const { extractIntent } = await import("./intent.ts");

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

test("parses vendor/amount/category from a clean LLM response", async () => {
  const restore = mockLlm(JSON.stringify({ vendor: "acme.com", amount_cents: 4200, category: "snacks" }));
  try {
    const r = await extractIntent("buy $42 of snacks from acme.com");
    assert.equal(r.vendor, "acme.com");
    assert.equal(r.amount_cents, 4200);
    assert.equal(r.category, "snacks");
  } finally {
    restore();
  }
});

test("rejects non-positive amounts", async () => {
  const restore = mockLlm(JSON.stringify({ vendor: "acme.com", amount_cents: 0, category: "snacks" }));
  try {
    await assert.rejects(
      () => extractIntent("free stuff"),
      /amount_cents must be a positive integer/,
    );
  } finally {
    restore();
  }
});

test("throws on malformed output (never guesses an intent)", async () => {
  const restore = mockLlm("I'm not sure what you mean");
  try {
    await assert.rejects(() => extractIntent("do the thing"), /intent parse failed/);
  } finally {
    restore();
  }
});
