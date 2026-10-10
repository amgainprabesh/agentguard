import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";
process.env.OPENROUTER_API_KEY = "test-key";

const { DecisionService } = await import("./decisions.ts");
const { Ledger } = await import("./ledger.ts");
const { resetPayPalToken } = await import("./paypal.ts");

const mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com"],
  category_limits_cents: { snacks: 50000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};

function mockFetch(llmIntent: object, opts: { captureStatus?: number } = {}) {
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.includes("openrouter.ai")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmIntent) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.endsWith("/v2/checkout/orders")) {
      return new Response(
        JSON.stringify({
          id: "ORD1",
          status: "COMPLETED",
          purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (u.endsWith("/capture")) {
      const s = opts.captureStatus ?? 201;
      return s === 201
        ? new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ error: "declined" }), { status: s });
    }
    throw new Error("unexpected fetch: " + u);
  });
}

const intentOk = { vendor: "acme.com", amount_cents: 4200, category: "snacks" };
const card = { number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "Test Buyer" };

test("ALLOW path: captures the order and appends an ALLOW row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);

  const svc = new DecisionService(ledger, mandate);
  const d = await svc.decide("buy $42 of snacks from acme.com", card);
  assert.equal(d.decision, "ALLOW");
  assert.equal(d.capture_id, "CAP1");

  const rows = ledger.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "ALLOW");
  assert.ok(rows[0].reason.includes("CAP1"));
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("DENY path: never calls PayPal, appends DENY row with reasons", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d2-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  let paypal_calls = 0;
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.includes("openrouter.ai")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...intentOk, vendor: "evil.com" }) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    paypal_calls++;
    throw new Error("PayPal must NOT be called on DENY: " + u);
  });

  const svc = new DecisionService(ledger, mandate);
  const d = await svc.decide("buy snacks from evil.com", card);
  assert.equal(d.decision, "DENY");
  assert.equal(paypal_calls, 0, "no PayPal calls at all on DENY");
  assert.ok(d.reasons.some((r) => /not on the approved list/i.test(r)));

  const rows = ledger.all();
  assert.equal(rows[0].action, "DENY");
  assert.ok(rows[0].reason.includes("evil.com"));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("ESCALATE path: parks a pending approval, no capture yet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d3-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch({ ...intentOk, amount_cents: 50000 });

  const svc = new DecisionService(ledger, mandate);
  const d = await svc.decide("buy $500 of snacks from acme.com", card);
  assert.equal(d.decision, "ESCALATE");
  assert.ok(d.approval_id);
  assert.equal(d.capture_id, undefined, "nothing captured yet");

  const rows = ledger.all();
  assert.ok(rows.some((r) => r.reason.includes("escalated")));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("approve() executes the parked escalation and appends ALLOW", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d4-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch({ ...intentOk, amount_cents: 50000 });

  const svc = new DecisionService(ledger, mandate);
  const esc = await svc.decide("buy $500 of snacks from acme.com", card);
  const approved = await svc.approve(esc.approval_id!, card);
  assert.equal(approved.decision, "ALLOW");
  assert.equal(approved.capture_id, "CAP1");

  const rows = ledger.all();
  assert.ok(rows.some((r) => r.reason.includes("approved")));
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("deny() an escalation appends DENY and never captures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d5-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch({ ...intentOk, amount_cents: 50000 });

  const svc = new DecisionService(ledger, mandate);
  const esc = await svc.decide("buy $500 of snacks from acme.com", card);
  await svc.denyApproval(esc.approval_id!);

  const rows = ledger.all();
  assert.ok(rows.some((r) => r.action === "DENY" && r.reason.includes("rejected")));
  assert.ok(!rows.some((r) => r.reason.includes("CAP1")), "never captured");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("capture failure on ALLOW marks the record failed, no silent success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d6-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk, { captureStatus: 500 });

  const svc = new DecisionService(ledger, mandate);
  await assert.rejects(
    () => svc.decide("buy $42 of snacks from acme.com", card),
    /capturePartial failed: 500/,
  );

  const rows = ledger.all();
  assert.ok(rows.some((r) => r.reason.includes("capture failed")));
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("double-approve throws and never captures twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-d7-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  let capture_calls = 0;
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.includes("openrouter.ai")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...intentOk, amount_cents: 50000 }) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.endsWith("/v2/checkout/orders")) {
      return new Response(
        JSON.stringify({
          id: "ORD1",
          status: "COMPLETED",
          purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (u.endsWith("/capture")) {
      capture_calls++;
      return new Response(JSON.stringify({ id: "CAP" + capture_calls, status: "COMPLETED" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected fetch: " + u);
  });

  const svc = new DecisionService(ledger, mandate);
  const esc = await svc.decide("buy $500 of snacks from acme.com", card);
  const first = await svc.approve(esc.approval_id!, card);
  assert.equal(first.capture_id, "CAP1");

  // second approve of the same id: throws, and does NOT hit PayPal again
  await assert.rejects(() => svc.approve(esc.approval_id!, card), /not found/);
  assert.equal(capture_calls, 1, "exactly one capture for one approval");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});
