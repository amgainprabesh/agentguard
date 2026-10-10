import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";
process.env.OPENROUTER_API_KEY = "test-key";

const { DecisionService, validateCard } = await import("./decisions.ts");
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

function mockFetch(llmIntent: object, opts: { captureStatus?: number; captureCounter?: { n: number } } = {}) {
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
      if (s !== 201) return new Response(JSON.stringify({ error: "declined" }), { status: s });
      if (opts.captureCounter) {
        opts.captureCounter.n++;
        return new Response(JSON.stringify({ id: "CAP" + opts.captureCounter.n, status: "COMPLETED" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
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
  const captureCounter = { n: 0 };
  mockFetch({ ...intentOk, amount_cents: 50000 }, { captureCounter });

  const svc = new DecisionService(ledger, mandate);
  const esc = await svc.decide("buy $500 of snacks from acme.com", card);
  const first = await svc.approve(esc.approval_id!, card);
  assert.equal(first.capture_id, "CAP1");

  // second approve of the same id: throws, and does NOT hit PayPal again
  await assert.rejects(() => svc.approve(esc.approval_id!, card), /not found/);
  assert.equal(captureCounter.n, 1, "exactly one capture for one approval");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("monthContext: budget aggregation from the ledger DENIES the next spend", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-mc1-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);
  const tightMandate = { ...mandate, monthly_budget_cents: 5000 };

  const svc = new DecisionService(ledger, tightMandate);
  ledger.append({ action: "ALLOW", amount_cents: 4200, reason: "seed", category: "snacks" });

  const d = await svc.decide("buy $10 of snacks from acme.com", card);
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /monthly budget/i.test(r)));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("monthContext: category limit aggregation DENIES within budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-mc2-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);
  const tightMandate = { ...mandate, category_limits_cents: { snacks: 5000 } };

  const svc = new DecisionService(ledger, tightMandate);
  ledger.append({ action: "ALLOW", amount_cents: 4000, reason: "seed", category: "snacks" });

  const d = await svc.decide("buy $20 of snacks from acme.com", card);
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /category limit/i.test(r)));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("monthContext: velocity counts ALLOW rows in the last hour", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-mc3-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);
  const tightMandate = { ...mandate, velocity_max_per_hour: 2 };

  const svc = new DecisionService(ledger, tightMandate);
  for (let i = 0; i < 2; i++) ledger.append({ action: "ALLOW", amount_cents: 100, reason: `seed ${i}`, category: "snacks" });

  const d = await svc.decide("buy $4 of snacks from acme.com", card);
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /velocity/i.test(r)));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("monthContext: month boundary is UTC — a row from another month is not counted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-mc5-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);
  // budget $50, seed $40 LAST month — this month's spend is $0, so $10 must ALLOW.
  const tightMandate = { ...mandate, monthly_budget_cents: 5000 };
  const svc = new DecisionService(ledger, tightMandate);

  const lastMonth = new Date();
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1, 15);
  ledger.db
    .prepare("INSERT INTO ledger (action, amount_cents, reason, category, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?,?)")
    .run("ALLOW", 4000, "seed last month", "snacks", "GENESIS", "h", lastMonth.toISOString());

  const d = await svc.decide("buy $10 of snacks from acme.com", card);
  assert.equal(d.decision, "ALLOW", "last month's spend must not count against this month's budget");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("ledger rows record the intent category; DENY/ESCALATE rows included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-mc4-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch({ ...intentOk, vendor: "evil.com" });

  const svc = new DecisionService(ledger, mandate);
  await svc.decide("buy snacks from evil.com", card);
  assert.equal(svc.ledgerRecords()[0].category, "snacks");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("validateCard: accepts a valid card, rejects garbage at the trust boundary", () => {
  assert.deepEqual(validateCard({ number: "4111 1111 1111 1111", expiry: "2028-12", security_code: "123", name: " Test Buyer " }), {
    number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "Test Buyer",
  });
  for (const bad of [
    null,
    {},
    { ...card, number: "4111" },
    { ...card, expiry: "12-2028" },
    { ...card, security_code: "12" },
    { ...card, name: "   " },
  ]) {
    assert.throws(() => validateCard(bad), /card/);
  }
});

test("validateCard: Luhn checksum and expiry-in-the-past are rejected", () => {
  // typo'd but shape-valid: passes length, fails checksum
  assert.throws(() => validateCard({ ...card, number: "4111111111111112" }), /Luhn/);
  // expired card (2020 was years ago)
  assert.throws(() => validateCard({ ...card, expiry: "2020-01" }), /in the past/);
  // this month is still valid — the boundary is the first ms AFTER the last valid month
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  assert.equal(validateCard({ ...card, expiry: thisMonth }).expiry, thisMonth, "current month is valid");
});

test("validateCard: decide() rejects a bad card before any LLM/PayPal call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-vc-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  let external_calls = 0;
  mock.method(globalThis, "fetch", async (url: any) => {
    external_calls++;
    throw new Error("must not be reached: " + url);
  });

  const svc = new DecisionService(ledger, mandate);
  await assert.rejects(
    () => svc.decide("buy $42 of snacks from acme.com", { ...card, number: "x" }),
    /card\.number/,
  );
  assert.equal(external_calls, 0, "no LLM or PayPal call on invalid card");
  assert.equal(ledger.all().length, 0, "nothing recorded for a rejected card");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});
