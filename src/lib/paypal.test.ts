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

// ---- Sprint 1: card create, partial capture, void ----

const { createOrderWithCard, capturePartial, voidAuthorization, resetPayPalToken } = await import("./paypal.ts");

test("createOrderWithCard extracts the embedded authorization from the create response", async () => {
  resetPayPalToken();
  let request_id_seen = false;
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    // PayPal requires PayPal-Request-Id when payment_source is present at create time
    request_id_seen = !!init.headers?.["PayPal-Request-Id"];
    const body = JSON.parse(String(init.body));
    assert.equal(body.intent, "AUTHORIZE");
    assert.equal(body.payment_source.card.number, "4111111111111111");
    return new Response(JSON.stringify({
      id: "ORD1", status: "COMPLETED",
      purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
    }), { status: 201, headers: { "content-type": "application/json" } });
  });

  const r = await createOrderWithCard({
    amount_cents: 1000,
    card: { number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "T" },
  });
  assert.equal(r.order_id, "ORD1");
  assert.equal(r.auth_id, "AUTH1", "auth id must come from the embedded authorization");
  assert.ok(request_id_seen, "PayPal-Request-Id header is required for card orders");
  mock.reset();
});

test("capturePartial posts partial amount to the authorization capture endpoint", async () => {
  resetPayPalToken();
  let captured: any = null;
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    captured = { url: u, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  });
  const cap = await capturePartial("AUTH123", 400);
  assert.equal(cap.id, "CAP1");
  assert.equal(captured.url, "https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH123/capture");
  assert.equal(captured.body.amount.value, "4.00");
  mock.reset();
});

test("voidAuthorization treats 204 empty body as success", async () => {
  resetPayPalToken();
  let void_url = "";
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    void_url = u;
    return new Response(null, { status: 204 });
  });
  const result = await voidAuthorization("AUTH123");
  assert.equal(result, true, "204 = voided");
  assert.equal(void_url, "https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH123/void");
  mock.reset();
});
