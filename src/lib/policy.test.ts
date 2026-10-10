import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./policy.ts";

const mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};

function ctx(overrides: Record<string, number> = {}) {
  return { month_spend_cents: 0, category_spend_cents: 0, txns_last_hour: 0, ...overrides };
}

test("within everything, small amount → ALLOW", () => {
  const d = evaluate({ vendor: "acme.com", amount_cents: 4200, category: "snacks" }, mandate, ctx());
  assert.equal(d.decision, "ALLOW");
});

test("over per-transaction cap → DENY with plain reason", () => {
  const d = evaluate({ vendor: "acme.com", amount_cents: 100001, category: "snacks" }, mandate, ctx());
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /per-transaction cap/i.test(r)));
});

test("vendor not in allowlist → DENY", () => {
  const d = evaluate({ vendor: "evil.com", amount_cents: 4200, category: "snacks" }, mandate, ctx());
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /not.*approved list/i.test(r)));
});

test("normalizeVendor: case, www, and URL prefixes all match the allowlist entry", () => {
  for (const v of ["acme.com", "ACME.com", "Acme.COM", "  acme.com  ", "www.acme.com", "https://acme.com", "http://www.acme.com/path?x=1"]) {
    const d = evaluate({ vendor: v, amount_cents: 4200, category: "snacks" }, mandate, ctx());
    assert.equal(d.decision, "ALLOW", `${v} should be allowed (normalized)`);
  }
  // a genuinely different domain must still be denied
  const bad = evaluate({ vendor: "acme.com.evil.net", amount_cents: 4200, category: "snacks" }, mandate, ctx());
  assert.equal(bad.decision, "DENY", "suffix trick must not match");
});

test("would exceed monthly budget → DENY", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 6000, category: "snacks" },
    mandate,
    ctx({ month_spend_cents: 1495000 }),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /monthly budget/i.test(r)));
});

test("would exceed category limit → DENY", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 6000, category: "snacks" },
    mandate,
    ctx({ category_spend_cents: 45000 }),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /category/i.test(r)));
});

test("category match is case-insensitive — 'Snacks' hits the 'snacks' limit", () => {
  for (const cat of ["snacks", "Snacks", "SNACKS", " snacks "]) {
    const d = evaluate({ vendor: "acme.com", amount_cents: 6000, category: cat }, mandate, ctx({ category_spend_cents: 45000 }));
    assert.equal(d.decision, "DENY", `${cat} must hit the snacks limit`);
  }
  // a mandate whose key has different case also matches
  const upperMandate = { ...mandate, category_limits_cents: { SNACKS: 50000 } };
  const d2 = evaluate({ vendor: "acme.com", amount_cents: 6000, category: "snacks" }, upperMandate, ctx({ category_spend_cents: 45000 }));
  assert.equal(d2.decision, "DENY", "mandate key case must not matter either");
  // an unknown category stays unbounded (no key => no limit)
  const d3 = evaluate({ vendor: "acme.com", amount_cents: 6000, category: "cloud" }, mandate, ctx({ category_spend_cents: 45000 }));
  assert.equal(d3.decision, "ALLOW", "unlisted category is unbounded");
});

test("velocity exceeded → DENY", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 4200, category: "snacks" },
    mandate,
    ctx({ txns_last_hour: 10 }),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /velocity/i.test(r)));
});

test("amount ≥ threshold but everything else passes → ESCALATE", () => {
  const d = evaluate({ vendor: "acme.com", amount_cents: 50000, category: "snacks" }, mandate, ctx());
  assert.equal(d.decision, "ESCALATE");
  assert.ok(d.reasons.some((r) => /approval/i.test(r)));
});

test("DENY beats ESCALATE: over-cap amount above threshold is DENY", () => {
  const d = evaluate({ vendor: "acme.com", amount_cents: 200000, category: "snacks" }, mandate, ctx());
  assert.equal(d.decision, "DENY");
});

test("collects ALL failing reasons, not just the first", () => {
  const d = evaluate(
    { vendor: "evil.com", amount_cents: 200000, category: "snacks" },
    mandate,
    ctx({ month_spend_cents: 1495000, category_spend_cents: 45000, txns_last_hour: 10 }),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.length >= 4, `expected 4+ reasons, got ${d.reasons.length}`);
});
