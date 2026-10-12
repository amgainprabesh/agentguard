import { test } from "node:test";
import assert from "node:assert/strict";

// Pure function — no next/server import, so it tests with plain node:test.
const { errorMessage } = await import("./_errors.ts");

test("errorMessage: known validation errors keep their message", () => {
  for (const msg of [
    "card.number must be 13-19 digits",
    "card.expiry is in the past",
    "mandate.velocity_max_per_hour must be at least 1",
    "request must be a non-empty string",
    "approval abc not found",
  ]) {
    assert.equal(errorMessage(new Error(msg)), msg);
  }
});

test("errorMessage: vendor/LLM errors are replaced by the generic fallback", () => {
  // a failed PayPal fetch throws with the full vendor body
  const paypal = new Error(
    'PayPal createOrderWithCard failed: 422 {"name":"UNPROCESSABLE_ENTITY","debug_id":"8f2a…","details":[{"issue":"…"}]}',
  );
  // the intent-parse error embeds raw LLM output
  const llm = new Error("intent parse failed — not JSON: I'm sorry, I cannot help with that…");
  for (const e of [paypal, llm]) {
    assert.equal(errorMessage(e, "decision failed"), "decision failed");
  }
});

test("errorMessage: a long validation-looking message is still clamped", () => {
  assert.equal(
    errorMessage(new Error("card." + "x".repeat(500)), "internal error"),
    "internal error",
  );
});

test("errorMessage: non-Error throwables fall back", () => {
  assert.equal(errorMessage("just a string", "oops"), "oops");
  assert.equal(errorMessage(undefined), "internal error");
});
