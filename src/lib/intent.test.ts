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

test("extracts JSON wrapped in thinking prose (lightning model does this)", async () => {
  const restore = mockLlm(
    'Here\'s a thinking process:\n\n1. **Analyze:** user wants snacks from acme\n\nFinal answer:\n{"vendor": "acme.com", "amount_cents": 4200, "category": "snacks"}',
  );
  try {
    const r = await extractIntent("buy $42 of snacks from acme.com");
    assert.equal(r.vendor, "acme.com");
    assert.equal(r.amount_cents, 4200);
    assert.equal(r.category, "snacks");
  } finally {
    restore();
  }
});

test("clamps absurd amounts from the LLM (untrusted arithmetic)", async () => {
  const restore = mockLlm(JSON.stringify({ vendor: "acme.com", amount_cents: 999_999_999_999, category: "snacks" }));
  try {
    const r = await extractIntent("buy everything from acme.com");
    assert.equal(r.amount_cents, 100_000_000, "clamped to the ceiling");
  } finally {
    restore();
  }
});

test("empty choices / null content fails clean instead of a TypeError", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const { chat } = await import("./llm.ts");
  const original = globalThis.fetch;
  try {
    for (const body of [{ choices: [] }, { choices: [{ message: {} }] }, {}]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      };
      await assert.rejects(() => chat([{ role: "user", content: "x" }]), /no content|failed/i);
      assert.equal(calls, 2, "empty content is transient — exactly one retry, then fail");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("429/5xx retry once then surface the error; 4xx fails immediately", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  const { chat } = await import("./llm.ts");
  const original = globalThis.fetch;
  try {
    // 429 twice -> throws transient after 2 calls
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("rate limited", { status: 429 }); };
    await assert.rejects(() => chat([{ role: "user", content: "x" }]), /transient: 429/);
    assert.equal(calls, 2, "one retry on 429");

    // 400 -> no retry, immediate failure
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("bad request", { status: 400 }); };
    await assert.rejects(() => chat([{ role: "user", content: "x" }]), /LLM failed: 400/);
    assert.equal(calls, 1, "no retry on a real 4xx");

    // 500 then success -> returns on the retry
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response("oops", { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    assert.equal(await chat([{ role: "user", content: "x" }]), "ok", "recovers on the retry");
  } finally {
    globalThis.fetch = original;
  }
});
