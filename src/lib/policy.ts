import type { Decision } from "./ledger.ts";

// Normalizes a vendor/domain for allowlist comparison: lowercase, trim, strip a
// leading "www." and any protocol/path. The LLM's vendor string is untrusted
// free text — "ACME.com", "https://acme.com", "www.acme.com" must all match an
// allowlist entry of "acme.com".
export function normalizeVendor(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export interface Mandate {
  monthly_budget_cents: number;
  per_txn_cap_cents: number;
  vendor_allowlist: string[];
  category_limits_cents: Record<string, number>;
  velocity_max_per_hour: number;
  approval_threshold_cents: number;
}

export interface SpendIntent {
  vendor: string;
  amount_cents: number;
  category: string;
}

export interface MonthContext {
  month_spend_cents: number;
  category_spend_cents: number;
  txns_last_hour: number;
}

export interface PolicyResult {
  decision: Decision;
  reasons: string[];
}

// Pure function — no I/O, no clock, no randomness. Same input → same decision.
// Precedence: any hard violation → DENY (all reasons collected); else threshold
// breach → ESCALATE; else ALLOW.
export function evaluate(intent: SpendIntent, mandate: Mandate, ctx: MonthContext): PolicyResult {
  const violations: string[] = [];

  if (intent.amount_cents > mandate.per_txn_cap_cents) {
    violations.push(
      `amount $${(intent.amount_cents / 100).toFixed(2)} exceeds the per-transaction cap of $${(mandate.per_txn_cap_cents / 100).toFixed(2)}`,
    );
  }
  if (ctx.month_spend_cents + intent.amount_cents > mandate.monthly_budget_cents) {
    violations.push(
      `would exceed the monthly budget ($${(ctx.month_spend_cents / 100).toFixed(2)} already spent of $${(mandate.monthly_budget_cents / 100).toFixed(2)})`,
    );
  }
  const vendor = normalizeVendor(intent.vendor);
  const allow = new Set(mandate.vendor_allowlist.map(normalizeVendor));
  if (!allow.has(vendor)) {
    violations.push(`vendor ${vendor} is not on the approved list`);
  }
  // case-insensitive category match: the LLM's category word is free text and
  // the mandate's keys are typed by hand — "Cloud", "cloud", "CLOUD" must hit
  // the same limit. An unmatched category is unbounded (no key => no limit),
  // which is why the mandate editor lets you add categories.
  const category = intent.category.trim().toLowerCase();
  const catEntry = Object.entries(mandate.category_limits_cents).find(
    ([k]) => k.trim().toLowerCase() === category,
  );
  if (catEntry !== undefined && ctx.category_spend_cents + intent.amount_cents > catEntry[1]) {
    violations.push(
      `would exceed the ${intent.category} category limit of $${(catEntry[1] / 100).toFixed(2)}`,
    );
  }
  if (ctx.txns_last_hour >= mandate.velocity_max_per_hour) {
    violations.push(
      `velocity limit reached (${ctx.txns_last_hour} transactions in the last hour)`,
    );
  }

  if (violations.length > 0) return { decision: "DENY", reasons: violations };

  if (intent.amount_cents >= mandate.approval_threshold_cents) {
    return {
      decision: "ESCALATE",
      reasons: [
        `amount $${(intent.amount_cents / 100).toFixed(2)} meets the approval threshold of $${(mandate.approval_threshold_cents / 100).toFixed(2)}`,
      ],
    };
  }

  return { decision: "ALLOW", reasons: [] };
}
