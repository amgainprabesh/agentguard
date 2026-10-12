import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// env must be set before importing the modules under test
process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";
process.env.OPENROUTER_API_KEY = "test-key";

const { evaluate } = await import("./policy.ts");
const { Ledger } = await import("./ledger.ts");
const { MandateStore, DEFAULT_MANDATE } = await import("./mandate.ts");
const { extractIntent } = await import("./intent.ts");
const { createOrderWithCard, resetPayPalToken } = await import("./paypal.ts");
const { DecisionService } = await import("./decisions.ts");

const card = { number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "Test Buyer" };

// ── policy.ts: the exact boundaries the existing tests step over ──────────────

const mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com"],
  category_limits_cents: { snacks: 50000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};
const ctx = (o: Record<string, number> = {}) => ({
  month_spend_cents: 0,
  category_spend_cents: 0,
  txns_last_hour: 0,
  ...o,
});

test("per-txn cap is inclusive: amount == cap is not a DENY", () => {
  // "cloud" has no category limit, so only the cap is under test
  const at = evaluate({ vendor: "acme.com", amount_cents: 100000, category: "cloud" }, mandate, ctx());
  assert.notEqual(at.decision, "DENY");
  assert.ok(!at.reasons.some((r) => /per-transaction cap/i.test(r)), "== cap must not trip the cap");
  const over = evaluate({ vendor: "acme.com", amount_cents: 100001, category: "cloud" }, mandate, ctx());
  assert.equal(over.decision, "DENY", "one cent over still trips the cap");
});

test("monthly budget is inclusive: spending to exactly the budget is ALLOW", () => {
  // 1495000 + 5000 == 1500000
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 5000, category: "cloud" },
    mandate,
    ctx({ month_spend_cents: 1495000 }),
  );
  assert.equal(d.decision, "ALLOW");
  assert.ok(!d.reasons.some((r) => /monthly budget/i.test(r)));
});

test("category limit is inclusive: spending to exactly the limit is ALLOW", () => {
  // 45000 + 5000 == 50000
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 5000, category: "snacks" },
    mandate,
    ctx({ category_spend_cents: 45000 }),
  );
  assert.equal(d.decision, "ALLOW");
  assert.ok(!d.reasons.some((r) => /category limit/i.test(r)));
});

test("velocity just below the max ALLOWs; exactly at it DENIEs (>= boundary)", () => {
  const below = evaluate({ vendor: "acme.com", amount_cents: 4200, category: "cloud" }, mandate, ctx({ txns_last_hour: 9 }));
  assert.equal(below.decision, "ALLOW");
  const at = evaluate({ vendor: "acme.com", amount_cents: 4200, category: "cloud" }, mandate, ctx({ txns_last_hour: 10 }));
  assert.equal(at.decision, "DENY");
  assert.ok(at.reasons.some((r) => /velocity/i.test(r)));
});

test("amount one cent below the approval threshold is ALLOW, not ESCALATE", () => {
  const d = evaluate({ vendor: "acme.com", amount_cents: 49999, category: "cloud" }, mandate, ctx());
  assert.equal(d.decision, "ALLOW");
});

test("an empty vendor_allowlist DENIEs every vendor", () => {
  // validate() permits [] (every() on [] is true), so the policy must fail closed
  const empty = { ...mandate, vendor_allowlist: [] as string[] };
  const d = evaluate({ vendor: "acme.com", amount_cents: 4200, category: "cloud" }, empty, ctx());
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /not on the approved list/i.test(r)));
});

// ── ledger.ts: append/hash edge cases ─────────────────────────────────────────

test("append stores null for both an omitted and an explicit-null category", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-cat-"));
  const l = new Ledger(join(dir, "t.db"));
  const omitted = l.append({ action: "ALLOW", amount_cents: 100, reason: "omitted" });
  const explicit = l.append({ action: "ALLOW", amount_cents: 100, reason: "explicit null", category: null });
  assert.equal(omitted.category, null);
  assert.equal(explicit.category, null);
  const rows = l.all();
  assert.equal(rows[0].category, null);
  assert.equal(rows[1].category, null);
  assert.deepEqual(l.verifyChain(), { ok: true, brokenAt: null });
  l.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("chain: seqs are contiguous and ascending, and each row links to the previous", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-chain-"));
  const l = new Ledger(join(dir, "t.db"));
  assert.deepEqual(l.verifyChain(), { ok: true, brokenAt: null }, "an empty ledger is a valid chain");
  const recs = [
    l.append({ action: "ALLOW", amount_cents: 100, reason: "one" }),
    l.append({ action: "DENY", amount_cents: 200, reason: "two" }),
    l.append({ action: "ESCALATE", amount_cents: 300, reason: "three" }),
  ];
  assert.deepEqual(recs.map((r) => r.seq), [1, 2, 3]);
  assert.equal(recs[0].prev_hash, "GENESIS");
  assert.equal(recs[1].prev_hash, recs[0].hash);
  assert.equal(recs[2].prev_hash, recs[1].hash);
  assert.deepEqual(l.all().map((r) => r.seq), [1, 2, 3], "all() returns ascending seq");
  assert.deepEqual(l.verifyChain(), { ok: true, brokenAt: null });
  l.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("tamper() on a non-existent seq is a no-op and leaves the chain intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-tamper-"));
  const l = new Ledger(join(dir, "t.db"));
  l.append({ action: "ALLOW", amount_cents: 100, reason: "one" });
  l.tamper(999); // UPDATE matches no rows
  assert.deepEqual(l.verifyChain(), { ok: true, brokenAt: null });
  l.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("category IS part of the row hash — editing it breaks the chain", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-hash-"));
  const l = new Ledger(join(dir, "t.db"));
  l.append({ action: "ALLOW", amount_cents: 100, reason: "one", category: "snacks" });
  // category drives monthContext()'s category-limit aggregation, so a row whose
  // category is edited in the DB would dodge a limit while verifyChain() said OK
  l.db.exec("UPDATE ledger SET category = 'other' WHERE seq = 1");
  const v = l.verifyChain();
  assert.equal(v.ok, false, "an edited category must break the chain");
  assert.equal(v.brokenAt, 1);
  l.db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── mandate.ts: validation branches the existing tests skip ───────────────────

test("MandateStore rejects a malformed category_limits_cents", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-mcat-"));
  const store = new MandateStore(join(dir, "mandate.json"));
  assert.throws(
    () => store.update({ ...DEFAULT_MANDATE, category_limits_cents: null as unknown as Record<string, number> }),
    /category_limits_cents/,
  );
  assert.throws(
    () => store.update({ ...DEFAULT_MANDATE, category_limits_cents: { snacks: "500" } as unknown as Record<string, number> }),
    /category_limits_cents/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("MandateStore rejects NaN and Infinity (Number.isFinite, not just < 0)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-mnum-"));
  const store = new MandateStore(join(dir, "mandate.json"));
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, monthly_budget_cents: NaN }), /non-negative number/);
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, per_txn_cap_cents: Infinity }), /non-negative number/);
  rmSync(dir, { recursive: true, force: true });
});

test("valid JSON that fails validation on boot falls back to the default", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-mboot-"));
  const path = join(dir, "mandate.json");
  writeFileSync(path, JSON.stringify({ monthly_budget_cents: 4200 })); // parses, but missing fields
  assert.deepEqual(new MandateStore(path).get(), DEFAULT_MANDATE);
  rmSync(dir, { recursive: true, force: true });
});

// ── intent.ts: field-level parse branches ─────────────────────────────────────

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

test("a missing vendor is a parse failure, never a guessed intent", async () => {
  const restore = mockLlm(JSON.stringify({ amount_cents: 4200, category: "snacks" }));
  try {
    await assert.rejects(() => extractIntent("buy something"), /no vendor/);
  } finally {
    restore();
  }
});

test("a non-numeric amount from the LLM is rejected", async () => {
  const restore = mockLlm(JSON.stringify({ vendor: "acme.com", amount_cents: "4200", category: "snacks" }));
  try {
    await assert.rejects(() => extractIntent("buy $42 of snacks"), /amount_cents must be a positive integer/);
  } finally {
    restore();
  }
});

test("a missing or non-string category defaults to 'uncategorized'", async () => {
  for (const body of [
    { vendor: "acme.com", amount_cents: 4200 }, // category omitted
    { vendor: "acme.com", amount_cents: 4200, category: 7 }, // wrong type
  ]) {
    const restore = mockLlm(JSON.stringify(body));
    try {
      // the request must NAME the vendor: an ungrounded vendor is a homoglyph
      // or a hallucination and fails closed (see the homoglyph test)
      assert.equal((await extractIntent("buy $42 of snacks from acme.com")).category, "uncategorized");
    } finally {
      restore();
    }
  }
});

test("an LLM transport failure surfaces as 'intent LLM failed'", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("socket hang up");
  };
  try {
    await assert.rejects(() => extractIntent("buy $42 of snacks from acme.com"), /intent LLM failed/);
  } finally {
    globalThis.fetch = original;
  }
});

test("a homoglyph vendor is rejected: the extracted vendor must appear in the request", async () => {
  // the LLM normalizes the Cyrillic lookalick 'а' (U+0430) to ASCII 'a',
  // returning "acme.com" for a request that literally typed a different domain
  const cyrillicRequest = "buy $10 from \u0430cme.com"; // <Cyrillic а>cme.com
  const restore = mockLlm(JSON.stringify({ vendor: "acme.com", amount_cents: 1000, category: "purchase" }));
  try {
    await assert.rejects(
      () => extractIntent(cyrillicRequest),
      /does not appear in the request/,
    );
  } finally {
    restore();
  }
});

test("a hallucinated vendor (not in the request) is rejected too", async () => {
  // the LLM invents a vendor the user never typed — same fail-closed rule
  const restore = mockLlm(JSON.stringify({ vendor: "globex.com", amount_cents: 1000, category: "purchase" }));
  try {
    await assert.rejects(
      () => extractIntent("buy $10 of stuff from acme.com"),
      /does not appear in the request/,
    );
  } finally {
    restore();
  }
});

test("a grounded vendor with URL/uppercase/ www. forms still extracts", async () => {
  // normalizeVendor() both sides, so these request spellings all ground OK
  for (const [req, llmVendor] of [
    ["buy $42 of snacks from acme.com", "acme.com"],
    ["buy $42 of snacks from ACME.COM", "acme.com"],
    ["buy $42 of snacks from www.acme.com", "acme.com"],
    ["buy $42 of snacks from https://acme.com/path", "acme.com"],
    ["buy $42 of snacks from https://www.acme.com", "https://www.acme.com"],
  ]) {
    const restore = mockLlm(JSON.stringify({ vendor: llmVendor, amount_cents: 4200, category: "snacks" }));
    try {
      const r = await extractIntent(req);
      assert.equal(r.vendor, llmVendor, `${req} / ${llmVendor} must extract`);
    } finally {
      restore();
    }
  }
});

// ── paypal.ts: token cache + failure branches ─────────────────────────────────

function mockPayPal(
  opts: {
    tokenStatus?: number;
    tokenExpiresIn?: number;
    ordersStatus?: number;
    ordersBody?: object;
    tokenCounter?: { n: number };
  } = {},
) {
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token")) {
      if (opts.tokenCounter) opts.tokenCounter.n++;
      const s = opts.tokenStatus ?? 200;
      if (s !== 200) return new Response("nope", { status: s });
      return new Response(JSON.stringify({ access_token: "tok", expires_in: opts.tokenExpiresIn ?? 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const s = opts.ordersStatus ?? 201;
    if (s !== 201) return new Response("boom", { status: s });
    return new Response(
      JSON.stringify(
        opts.ordersBody ?? {
          id: "ORD1",
          status: "COMPLETED",
          purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
        },
      ),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  });
}

test("the oauth token is cached across PayPal calls", async () => {
  resetPayPalToken();
  const tokenCounter = { n: 0 };
  mockPayPal({ tokenCounter });
  await createOrderWithCard({ amount_cents: 1000, card });
  await createOrderWithCard({ amount_cents: 1000, card });
  assert.equal(tokenCounter.n, 1, "second call must reuse the cached token");
  mock.reset();
});

test("a token expiring inside the 30s margin is refreshed", async () => {
  resetPayPalToken();
  const tokenCounter = { n: 0 };
  mockPayPal({ tokenCounter, tokenExpiresIn: 10 }); // always inside the 30s window
  await createOrderWithCard({ amount_cents: 1000, card });
  await createOrderWithCard({ amount_cents: 1000, card });
  assert.equal(tokenCounter.n, 2, "a nearly-expired token must be refetched");
  mock.reset();
});

test("a failed token request throws 'PayPal token failed'", async () => {
  resetPayPalToken();
  mockPayPal({ tokenStatus: 401 });
  await assert.rejects(() => createOrderWithCard({ amount_cents: 1000, card }), /PayPal token failed: 401/);
  mock.reset();
});

test("a non-ok create-order response throws with the status", async () => {
  resetPayPalToken();
  mockPayPal({ ordersStatus: 500 });
  await assert.rejects(() => createOrderWithCard({ amount_cents: 1000, card }), /createOrderWithCard failed: 500/);
  mock.reset();
});

test("a create response with no embedded authorization throws", async () => {
  resetPayPalToken();
  mockPayPal({ ordersBody: { id: "ORD1", status: "COMPLETED", purchase_units: [] } });
  await assert.rejects(() => createOrderWithCard({ amount_cents: 1000, card }), /no authorization returned/);
  mock.reset();
});

// ── decisions.ts: monthContext filters + approval/capture branches ────────────

const intentOk = { vendor: "acme.com", amount_cents: 4200, category: "snacks" };

function mockFetch(llmIntent: object, opts: { captureStatus?: number; captureBody?: string } = {}) {
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
      if (s !== 201) return new Response(opts.captureBody ?? JSON.stringify({ error: "declined" }), { status: s });
      return new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("unexpected fetch: " + u);
  });
}

test("approve() with an invalid card throws and leaves the approval still pending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-appr-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch({ ...intentOk, amount_cents: 50000 });

  const svc = new DecisionService(ledger, mandate);
  const esc = await svc.decide("buy $500 of snacks from acme.com", card);
  assert.equal(esc.decision, "ESCALATE");

  await assert.rejects(() => svc.approve(esc.approval_id!, { ...card, number: "x" }), /card\.number/);
  assert.equal(svc.listPending().length, 1, "a rejected card must not consume the parked approval");
  assert.equal(ledger.all().length, 1, "only the ESCALATE row exists — nothing captured");

  // the parked approval is still usable with a valid card
  const ok = await svc.approve(esc.approval_id!, card);
  assert.equal(ok.decision, "ALLOW");
  assert.equal(ok.capture_id, "CAP1");
  assert.equal(svc.listPending().length, 0);

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("denyApproval() throws for an unknown id and records nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-deny-"));
  const ledger = new Ledger(join(dir, "t.db"));
  const svc = new DecisionService(ledger, mandate);
  await assert.rejects(() => svc.denyApproval("nope"), /approval nope not found/);
  assert.equal(ledger.all().length, 0);
  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("monthContext: DENY rows are not counted as spend", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-spend-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);
  const tight = { ...mandate, monthly_budget_cents: 6000 }; // $60
  const svc = new DecisionService(ledger, tight);
  // a $50 DENY row must not eat the budget — only ALLOW rows count as spend
  ledger.append({ action: "DENY", amount_cents: 5000, reason: "seed deny", category: "snacks" });

  const d = await svc.decide("buy $42 of snacks from acme.com", card);
  assert.equal(d.decision, "ALLOW", "a denied spend must not consume the budget");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("monthContext: non-ALLOW rows are skipped entirely — velocity counts only ALLOW", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-vel-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk);
  const full = { ...mandate, velocity_max_per_hour: 2 };
  const svc = new DecisionService(ledger, full);
  // the `continue` for non-ALLOW rows also skips the velocity increment, so two
  // DENY rows in the last hour do NOT count as two transactions
  ledger.append({ action: "DENY", amount_cents: 100, reason: "seed 1", category: "snacks" });
  ledger.append({ action: "DENY", amount_cents: 100, reason: "seed 2", category: "snacks" });

  const d = await svc.decide("buy $42 of snacks from acme.com", card);
  assert.equal(d.decision, "ALLOW", "DENY rows must not consume velocity");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("monthContext: a null category aggregates under 'uncategorized'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-nullcat-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch({ ...intentOk, category: "uncategorized" });
  const tight = { ...mandate, category_limits_cents: { uncategorized: 5000 } };
  const svc = new DecisionService(ledger, tight);
  // a legacy row with no category must still count against the 'uncategorized' limit
  ledger.append({ action: "ALLOW", amount_cents: 4000, reason: "seed", category: null });

  const d = await svc.decide("buy $42 of uncategorized from acme.com", card);
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /category limit/i.test(r)));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("capture failure reason is capped so the ledger row stays one line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-cap-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  mockFetch(intentOk, { captureStatus: 500, captureBody: "x".repeat(5000) });

  const svc = new DecisionService(ledger, mandate);
  await assert.rejects(() => svc.decide("buy $42 of snacks from acme.com", card), /capturePartial failed: 500/);

  const reason = ledger.all()[0].reason;
  const cap = "capture failed for acme.com: ".length + 300;
  assert.ok(reason.startsWith("capture failed for acme.com:"));
  assert.ok(reason.length <= cap, `reason capped (${reason.length} <= ${cap})`);
  assert.ok(reason.length > 300, "the leading error text is kept, not emptied");

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("a failed intent extraction leaves a DENY row (no silent audit gap)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-gap-intentfail-"));
  const ledger = new Ledger(join(dir, "t.db"));
  resetPayPalToken();
  // the LLM returns unparseable junk — extraction must fail AND be recorded
  mockFetch({ garbage: true });

  const svc = new DecisionService(ledger, mandate);
  await assert.rejects(() => svc.decide("hello there, what is the weather?", card), /intent parse failed/);

  const rows = ledger.all();
  assert.equal(rows.length, 1, "the refused request must leave an audit row");
  assert.equal(rows[0].action, "DENY");
  assert.ok(rows[0].reason.startsWith("intent extraction failed:"));
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});
