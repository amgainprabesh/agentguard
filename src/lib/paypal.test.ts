import { test, mock } from "node:test";
import assert from "node:assert/strict";

// env must be set before importing the module under test
process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";

const { createOrder } = await import("./paypal.ts");

test("createOrder posts to Orders v2 and returns the order id", async () => {
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    calls.push(String(url));
    const body = init.body ? (String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : null) : null;
    if (String(url).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(String(url), "https://api-m.sandbox.paypal.com/v2/checkout/orders");
    assert.equal(body.intent, "AUTHORIZE", "escrow must authorize, not capture");
    assert.equal(body.purchase_units[0].amount.value, "42.00");
    return new Response(JSON.stringify({ id: "ORDER123", status: "CREATED" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });

  const order = await createOrder({ amount_cents: 4200, currency: "USD" });
  assert.equal(order.id, "ORDER123");
  assert.equal(calls.length, 2, "token fetch then order create");
  mock.reset();
});

test("token is cached across calls", async () => {
  const { resetPayPalToken } = await import("./paypal.ts");
  resetPayPalToken(); // clear any token cached by an earlier test
  let tokenCalls = 0;
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    if (String(url).endsWith("/v1/oauth2/token")) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "O" + tokenCalls, status: "CREATED" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  await createOrder({ amount_cents: 100 });
  await createOrder({ amount_cents: 200 });
  assert.equal(tokenCalls, 1, "second call reuses cached token");
  mock.reset();
});
