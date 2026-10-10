import { test } from "node:test";
import assert from "node:assert/strict";

// env must be set before importing the module under test
process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";
process.env.OPENROUTER_API_KEY = "test-key";

const { env } = await import("./env.ts");

test("paypalEnv fails closed to sandbox even when PAYPAL_ENV=live", () => {
  // a stray live setting must never route real money — the demo is sandbox-only
  process.env.PAYPAL_ENV = "live";
  assert.equal(env.paypalEnv(), "sandbox");
  assert.ok(env.paypalBaseUrl().includes("sandbox"), "base URL must stay on the sandbox host");
  delete process.env.PAYPAL_ENV;
  assert.equal(env.paypalEnv(), "sandbox");
});

test("missing credentials throw a clear error naming the var", () => {
  const saved = process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_ID;
  assert.throws(() => env.paypalClientId(), /PAYPAL_CLIENT_ID/);
  process.env.PAYPAL_CLIENT_ID = saved;
});

test("model defaults to the pinned free model when unset", () => {
  const saved = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  assert.equal(env.openrouterModel(), "nvidia/nemotron-3.5-lightning:free");
  process.env.OPENROUTER_MODEL = saved;
});
