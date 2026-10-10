import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";

const { Escrow } = await import("./escrow.ts");
const { Ledger } = await import("./ledger.ts");
const { resetPayPalToken } = await import("./paypal.ts");

function mockPayPal() {
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (u.endsWith("/v2/checkout/orders")) {
      return new Response(JSON.stringify({
        id: "ORD1", status: "COMPLETED",
        purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.endsWith("/capture")) {
      return new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    }
    if (u.endsWith("/void")) {
      return new Response(null, { status: 204 });
    }
    throw new Error("unexpected fetch: " + u);
  });
}

test("full escrow: create → deliver → settle captures score share, voids rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-e-"));
  const ledger = new Ledger(join(dir, "t.db"));
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: any) => {
    calls.push(String(url));
    return mockPayPalFetch(url);
  });
  resetPayPalToken();

  const escrow = new Escrow(ledger);
  const deal = await escrow.createDeal({
    amount_cents: 10000,
    card: { number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "T" },
    rubric: [{ criterion: "quality", weight: 1 }],
  });
  assert.equal(deal.state, "AUTHORIZED");
  assert.equal(deal.auth_id, "AUTH1");

  await escrow.deliver(deal.id, "the work");
  const settled = await escrow.settle(deal.id);
  assert.equal(settled.state, "SETTLED");
  // score 75 of 10000 -> capture 7500, void 2500
  assert.equal(settled.capture_cents, 7500);
  assert.equal(settled.void_cents, 2500);
  assert.ok(calls.some((c) => c.endsWith("/capture")), "capture was called");
  assert.ok(calls.some((c) => c.endsWith("/void")), "void was called");

  // ledger has the settlement rows
  const rows = ledger.all();
  assert.ok(rows.some((r) => r.reason.includes("captured")), "capture row in ledger");
  assert.ok(rows.some((r) => r.reason.includes("voided")), "void row in ledger");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("money invariant: captured + voided == authorized, always", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-e2-"));
  const ledger = new Ledger(join(dir, "t.db"));
  mock.method(globalThis, "fetch", async (url: any) => mockPayPalFetch(url));
  resetPayPalToken();

  const escrow = new Escrow(ledger);
  const deal = await escrow.createDeal({
    amount_cents: 7777, // deliberately awkward
    card: { number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "T" },
    rubric: [{ criterion: "q", weight: 1 }],
  });
  await escrow.deliver(deal.id, "work");
  const settled = await escrow.settle(deal.id);
  assert.equal(settled.capture_cents + settled.void_cents, 7777);

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

function mockPayPalFetch(url: any): Response {
  const u = String(url);
  if (u.endsWith("/v1/oauth2/token")) {
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  if (u.endsWith("/v2/checkout/orders")) {
    return new Response(JSON.stringify({
      id: "ORD1", status: "COMPLETED",
      purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
    }), { status: 201, headers: { "content-type": "application/json" } });
  }
  if (u.endsWith("/capture")) {
    return new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  }
  if (u.endsWith("/void")) {
    return new Response(null, { status: 204 });
  }
  throw new Error("unexpected fetch: " + u);
}
