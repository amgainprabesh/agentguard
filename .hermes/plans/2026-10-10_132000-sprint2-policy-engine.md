# Sprint 2 — AgentGuard: Policy Engine + Decision Spine

> **Method:** TDD per task (RED → GREEN), vertical slice first, live-verified per task.
> **Sprint goal:** an AI purchasing agent submits a spend intent; the policy engine returns ALLOW/DENY/ESCALATE with plain-English reasons; ALLOW executes a real sandbox capture, ESCALATE waits for a one-tap human approval then executes, DENY never touches PayPal. Every decision appends to the hash-chained ledger. One vertical slice green against the live sandbox.
> **Deadline context:** hackathon due Nov 13 2026 — ~33 days out. Sprint 2 = Oct 10–14.

---

## 1. Goal

Turn AgentGuard from an escrow demo into a **policy enforcement point on the payment path** — rule engine + decision types + execute/escalate/refuse flow, all hash-chained — so Sprint 3 can build the mandate editor, decision UI, and auditor view on a proven spine.

**The pitch this implements:** *policy is code, not prompt.* A prompt-injected agent cannot rewrite the rules; every decision is provable afterward.

---

## 2. What already exists (reuse, do not rebuild)

| Asset | Path | Sprint 2 use |
|---|---|---|
| Hash-chained ledger | `src/lib/ledger.ts` (+ tests) | **Reused as-is.** Decision records append here; `verifyChain()` powers the auditor |
| PayPal client (card + capture) | `src/lib/paypal.ts` (+ tests) | **Reused, narrowed:** keep `createOrderWithCard` + `capturePartial`; drop `voidAuthorization` after escrow deletion |
| LLM client | `src/lib/llm.ts` | Reused for intent extraction (messy request → structured spend intent) |
| env loader | `src/lib/env.ts` | Unchanged |
| Next.js routes pattern | `src/app/api/*/route.ts` | Same pattern for `/api/decide`, `/api/approvals/*` |

**Becomes dead after the new spine is live-verified** (delete then — git history keeps it): `deal.ts` + tests, `escrow.ts` + tests, `escrow-singleton.ts`, `grader.ts` + tests, `money.ts` + tests, `src/app/api/deals/**`, `scripts/live-e2e-check.ts`, and the `live-e2e` npm script.

**Deletion discipline:** the deletion task runs ONLY after the new live check passes. Until then both stacks coexist.

---

## 3. Architecture (Sprint 2 scope)

```
Agent request: "buy $42 of snacks from acme.com"
  │
  ▼
Intent extractor (src/lib/intent.ts)        — LLM: messy text → { vendor, amount_cents, category }
  │
  ▼
Rule engine (src/lib/policy.ts)             — six rules, pure function, no I/O
  ├── monthly_budget     — spend this month + amount ≤ cap?
  ├── per_txn_cap        — amount ≤ per-transaction cap?
  ├── vendor_allowlist   — vendor in the approved list?
  ├── category_limit     — category spend + amount ≤ limit?
  ├── velocity           — txns in last hour < N?
  └── approval_threshold — amount ≥ threshold → ESCALATE (checked only if all else passes)
  │
  ▼
Decision: ALLOW | DENY | ESCALATE, each with reasons[] (plain English)
  │
  ├── ALLOW    → captureOrder() → ledger ALLOW row w/ capture id
  ├── ESCALATE → pending approval → (Sprint 3 UI taps) → approve() → capture → ledger
  └── DENY     → no PayPal call ever → ledger DENY row w/ reasons

Ledger: every decision + every capture appended; verifyChain() unchanged.
```

**Rule precedence (locked):** all rules evaluated; ANY hard violation → DENY (all failing reasons collected); else if `approval_threshold` breached → ESCALATE; else ALLOW. A DENY reason always wins over ESCALATE.

**Config shape (locked — Sprint 3's mandate editor writes exactly this):**

```json
{
  "monthly_budget_cents": 1500000,
  "per_txn_cap_cents": 100000,
  "vendor_allowlist": ["acme.com", "globex.com"],
  "category_limits_cents": { "snacks": 50000, "ads": 200000 },
  "velocity_max_per_hour": 10,
  "approval_threshold_cents": 50000
}
```

Six rule types. Hard stop — no new rule types this sprint.

---

## 4. Step-by-step tasks

All commands from repo root: `C:/Users/prabe/OneDrive/Documents/Hbuild/paypal-hackathon/agentguard`
(bash: `cd "C:/Users/prabe/OneDrive/Documents/Hbuild/paypal-hackathon/agentguard"`)

**TDD cycle per task:** write failing test → run RED → implement → run GREEN → commit.

---

### Task 2.1 — Rule engine (test first; pure function, no I/O, no LLM)

The heart of the sprint. If this is wrong, everything downstream is wrong. Policy-as-code lives here.

**File created:** `src/lib/policy.ts`

Test first — `src/lib/policy.test.ts`:

```ts
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

// helper: what's already been spent/approved this month
function ctx(overrides: Partial<Parameters<typeof evaluate>[1]> = {}) {
  return {
    month_spend_cents: 0,
    category_spend_cents: 0,
    txns_last_hour: 0,
    ...overrides,
  };
}

test("within everything, small amount → ALLOW", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 4200, category: "snacks" },
    mandate,
    ctx(),
  );
  assert.equal(d.decision, "ALLOW");
});

test("over per-transaction cap → DENY with plain reason", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 100001, category: "snacks" },
    mandate,
    ctx(),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /per-transaction cap/i.test(r)), "reason mentions the cap");
});

test("vendor not in allowlist → DENY", () => {
  const d = evaluate(
    { vendor: "evil.com", amount_cents: 4200, category: "snacks" },
    mandate,
    ctx(),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /not.*allow/i.test(r)));
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

test("velocity exceeded → DENY", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 4200, category: "snacks" },
    mandate,
    ctx({ txns_last_hour: 10 }),
  );
  assert.equal(d.decision, "DENY");
  assert.ok(d.reasons.some((r) => /velocity/i.test(r)));
});

test("amount ≥ threshold but everything else passes → ESCALATE (not ALLOW)", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 50000, category: "snacks" },
    mandate,
    ctx(),
  );
  assert.equal(d.decision, "ESCALATE");
  assert.ok(d.reasons.some((r) => /approval/i.test(r)));
});

test("DENY beats ESCALATE: over-cap amount above threshold is DENY", () => {
  const d = evaluate(
    { vendor: "acme.com", amount_cents: 200000, category: "snacks" },
    mandate,
    ctx(),
  );
  assert.equal(d.decision, "DENY", "hard violation wins over escalation");
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
```

Implementation — `src/lib/policy.ts`:

```ts
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

export type Decision = "ALLOW" | "DENY" | "ESCALATE";

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
  if (!mandate.vendor_allowlist.includes(intent.vendor)) {
    violations.push(`vendor ${intent.vendor} is not on the approved list`);
  }
  const cat_limit = mandate.category_limits_cents[intent.category];
  if (cat_limit !== undefined && ctx.category_spend_cents + intent.amount_cents > cat_limit) {
    violations.push(
      `would exceed the ${intent.category} category limit of $${(cat_limit / 100).toFixed(2)}`,
    );
  }
  if (ctx.txns_last_hour >= mandate.velocity_max_per_hour) {
    violations.push(`velocity limit reached (${ctx.txns_last_hour} transactions in the last hour)`);
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
```

**Verify:**

```bash
node --test src/lib/policy.test.ts
# expected: pass 9, fail 0
```

**Commit:** `git commit -m "feat(policy): six-rule engine — ALLOW/DENY/ESCALATE with plain-English reasons"`

---

### Task 2.2 — Intent extractor (test first; LLM → structured intent)

Messy agent request in, strict-JSON intent out. Same discipline as the grader: throws on failure, never guesses.

**File created:** `src/lib/intent.ts`

Test first — `src/lib/intent.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OPENROUTER_API_KEY = "test-key";

const { extractIntent } = await import("./intent.ts");

function mockLlm(content: string) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  return () => {
    globalThis.fetch = original;
  };
}

test("parses vendor/amount/category from a clean LLM response", async () => {
  const restore = mockLlm(
    JSON.stringify({ vendor: "acme.com", amount_cents: 4200, category: "snacks" }),
  );
  try {
    const r = await extractIntent("buy $42 of snacks from acme.com");
    assert.equal(r.vendor, "acme.com");
    assert.equal(r.amount_cents, 4200);
    assert.equal(r.category, "snacks");
  } finally {
    restore();
  }
});

test("rejects non-positive amounts", async () => {
  const restore = mockLlm(JSON.stringify({ vendor: "acme.com", amount_cents: 0, category: "snacks" }));
  try {
    await assert.rejects(() => extractIntent("free stuff"), /amount_cents must be a positive integer/);
  } finally {
    restore();
  }
});

test("throws on malformed output (never guesses an intent)", async () => {
  const restore = mockLlm("I'm not sure what you mean");
  try {
    await assert.rejects(() => extractIntent("do the thing"), /intent parse failed/);
  } finally {
    restore();
  }
});
```

Implementation — `src/lib/intent.ts`:

```ts
import { chat } from "./llm.ts";

// Messy natural-language request → structured spend intent. Throws on any LLM or
// parse failure: a failed extraction is a DENY, never a guessed intent.
export async function extractIntent(
  request: string,
): Promise<{ vendor: string; amount_cents: number; category: string }> {
  const prompt = [
    "Extract a purchase intent from this request. Reply with JSON ONLY, no prose:",
    '{"vendor": "<domain>", "amount_cents": <integer>, "category": "<one word>"}',
    "Convert dollars to cents (e.g. $42.50 → 4250).",
    "",
    "Request:",
    request,
  ].join("\n");

  let raw: string;
  try {
    raw = await chat([{ role: "user", content: prompt }]);
  } catch (e) {
    throw new Error(`intent LLM failed: ${e}`);
  }

  let parsed: { vendor?: unknown; amount_cents?: unknown; category?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`intent parse failed — not JSON: ${raw.slice(0, 200)}`);
  }

  const amount = typeof parsed.amount_cents === "number" ? parsed.amount_cents : NaN;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`intent parse failed — amount_cents must be a positive integer, got: ${raw.slice(0, 200)}`);
  }
  if (typeof parsed.vendor !== "string" || !parsed.vendor) {
    throw new Error(`intent parse failed — no vendor in: ${raw.slice(0, 200)}`);
  }

  return {
    vendor: parsed.vendor,
    amount_cents: amount,
    category: typeof parsed.category === "string" ? parsed.category : "uncategorized",
  };
}
```

**Verify:**

```bash
node --test src/lib/intent.test.ts
# expected: pass 3, fail 0
```

**Commit:** `git commit -m "feat(intent): LLM extraction — messy request → strict spend intent, throws on failure"`

---

### Task 2.3 — Decision service: decide → execute/escalate/deny, ledger-append (test first)

Wires policy + PayPal + ledger. The `decide()` path: extract intent, evaluate, then ALLOW→capture / DENY→refuse / ESCALATE→park for approval.

**File created:** `src/lib/decisions.ts` (+ tests). Delete-old task removes the escrow files later — this file takes over the singleton pattern.

Test first — `src/lib/decisions.test.ts`:

```ts
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
        status: 200, headers: { "content-type": "application/json" },
      });
    }
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
      const s = opts.captureStatus ?? 201;
      return s === 201
        ? new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), { status: 201, headers: { "content-type": "application/json" } })
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
  assert.ok(rows[0].reason.includes("CAP1"), "ledger row links the capture");
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
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ...intentOk, vendor: "evil.com" }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
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
  assert.ok(d.approval_id, "pending approval created");
  assert.equal(d.capture_id, undefined, "nothing captured yet");

  // ledger records the escalation
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
  // failure row in ledger, chain intact
  const rows = ledger.all();
  assert.ok(rows.some((r) => r.reason.includes("capture failed")));
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});
```

Implementation — `src/lib/decisions.ts`:

```ts
import { Ledger } from "./ledger.ts";
import { createOrderWithCard, capturePartial } from "./paypal.ts";
import { evaluate, type Mandate, type SpendIntent } from "./policy.ts";
import { extractIntent } from "./intent.ts";

export interface CardInput {
  number: string;
  expiry: string;
  security_code: string;
  name: string;
}

export interface DecisionResult {
  decision: "ALLOW" | "DENY" | "ESCALATE";
  reasons: string[];
  intent?: SpendIntent;
  capture_id?: string;
  approval_id?: string;
}

interface PendingApproval {
  id: string;
  intent: SpendIntent;
  reasons: string[];
}

export class DecisionService {
  private pending = new Map<string, PendingApproval>();

  constructor(
    private ledger: Ledger,
    private mandate: Mandate,
  ) {}

  // Sprint 2 shortcut: month context is zeroed (single demo user, fresh ledger).
  // Sprint 3 replaces with real aggregation from the ledger (sum of ALLOW amounts
  // this month per category, count in last hour).
  private monthContext(): { month_spend_cents: number; category_spend_cents: number; txns_last_hour: number } {
    return { month_spend_cents: 0, category_spend_cents: 0, txns_last_hour: 0 };
  }

  async decide(request: string, card: CardInput): Promise<DecisionResult> {
    const intent = await extractIntent(request);
    const { decision, reasons } = evaluate(intent, this.mandate, this.monthContext());

    if (decision === "DENY") {
      this.ledger.append({
        action: "DENY",
        amount_cents: intent.amount_cents,
        reason: `denied ${intent.vendor} ${intent.category}: ${reasons.join("; ")}`,
      });
      return { decision: "DENY", reasons, intent };
    }

    if (decision === "ESCALATE") {
      const approval_id = crypto.randomUUID();
      this.pending.set(approval_id, { id: approval_id, intent, reasons });
      this.ledger.append({
        action: "ESCALATE",
        amount_cents: intent.amount_cents,
        reason: `escalated ${intent.vendor} ${intent.category} $${(intent.amount_cents / 100).toFixed(2)}: ${reasons.join("; ")} (approval ${approval_id})`,
      });
      return { decision: "ESCALATE", reasons, intent, approval_id };
    }

    // ALLOW — capture immediately
    const capture_id = await this.capture(intent, card, "allowed");
    return { decision: "ALLOW", reasons, intent, capture_id };
  }

  async approve(approval_id: string, card: CardInput): Promise<DecisionResult> {
    const p = this.pending.get(approval_id);
    if (!p) throw new Error(`approval ${approval_id} not found`);
    this.pending.delete(approval_id);
    const capture_id = await this.capture(p.intent, card, "approved");
    return { decision: "ALLOW", reasons: p.reasons, intent: p.intent, capture_id };
  }

  async denyApproval(approval_id: string): Promise<void> {
    const p = this.pending.get(approval_id);
    if (!p) throw new Error(`approval ${approval_id} not found`);
    this.pending.delete(approval_id);
    this.ledger.append({
      action: "DENY",
      amount_cents: p.intent.amount_cents,
      reason: `rejected escalation ${approval_id}: ${p.intent.vendor} ${p.intent.category}`,
    });
  }

  private async capture(intent: SpendIntent, card: CardInput, verb: string): Promise<string> {
    try {
      const { auth_id } = await createOrderWithCard({ amount_cents: intent.amount_cents, card });
      const cap = await capturePartial(auth_id, intent.amount_cents);
      this.ledger.append({
        action: "ALLOW",
        amount_cents: intent.amount_cents,
        reason: `${verb} ${intent.vendor} ${intent.category} $${(intent.amount_cents / 100).toFixed(2)}, capture ${cap.id}`,
      });
      return cap.id;
    } catch (e) {
      this.ledger.append({
        action: "DENY",
        amount_cents: intent.amount_cents,
        reason: `capture failed for ${intent.vendor}: ${e}`,
      });
      throw e;
    }
  }
}
```

**Verify:**

```bash
node --test src/lib/decisions.test.ts
# expected: pass 6, fail 0
npm run typecheck   # expected: silent
```

**Commit:** `git commit -m "feat(decisions): policy → execute/escalate/refuse with ledger trail (6 tests)"`

---

### Task 2.4 — API routes (thin, shared singleton)

Same pattern as Sprint 1's routes. One singleton, three routes.

**Files created:** `src/lib/decisions-singleton.ts`, `src/app/api/decide/route.ts`, `src/app/api/approvals/[id]/approve/route.ts`, `src/app/api/approvals/[id]/reject/route.ts`, `src/app/api/approvals/route.ts`

`src/lib/decisions-singleton.ts`:

```ts
import { DecisionService } from "./decisions.ts";
import { Ledger } from "./ledger.ts";
import { join } from "node:path";

// one shared instance so all routes see the same pending approvals
// shortcut: mandate is the demo mandate; Sprint 3 reads it from a stored config
const DEMO_MANDATE = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};

export const decisions = new DecisionService(new Ledger(join(process.cwd(), "data", "agentguard.db")), DEMO_MANDATE);
```

`src/app/api/decide/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(req: NextRequest) {
  const { request, card } = await req.json();
  try {
    const d = await decisions.decide(request, card);
    return NextResponse.json(d, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
```

`src/app/api/approvals/[id]/approve/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { card } = await req.json();
  try {
    const d = await decisions.approve(id, card);
    return NextResponse.json(d);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
```

`src/app/api/approvals/[id]/reject/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await decisions.denyApproval(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
```

`src/app/api/approvals/route.ts`:

```ts
import { NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function GET() {
  return NextResponse.json(decisions.listPending());
}
```

Add `listPending()` to `DecisionService` (in `decisions.ts`):

```ts
  listPending(): PendingApproval[] {
    return [...this.pending.values()].map(({ id, intent, reasons }) => ({ id, intent, reasons }));
  }
```

**Verify:**

```bash
npm test && npm run typecheck
# expected: 40 tests pass (existing + 9 policy + 3 intent + 6 decisions), typecheck silent
```

**Commit:** `git commit -m "feat(api): decide + approvals routes on shared singleton"`

---

### Task 2.5 — Live check: the sprint's acceptance test

One script exercising the full demo path against the real sandbox: DENY (no capture), ALLOW (real capture), ESCALATE → approve (real capture), then verify the hash chain.

**File created:** `scripts/live-decisions-check.ts`

```ts
// Sprint 2 acceptance: the full policy path against the LIVE sandbox.
// Run: npm run live-decisions
import { DecisionService } from "../src/lib/decisions.ts";
import { Ledger } from "../src/lib/ledger.ts";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};
const svc = new DecisionService(ledger, mandate);
const card = {
  number: process.env.TEST_CARD_NUMBER ?? "4111111111111111",
  expiry: "2028-12",
  security_code: "123",
  name: "Test Buyer",
};

// 1. DENY — vendor not on the list; PayPal never touched
const denied = await svc.decide("buy $42 of snacks from evil.com", card);
console.log("1. DENY:", denied.decision, "|", denied.reasons[0]);
if (denied.decision !== "DENY" || denied.capture_id) throw new Error("DENY path wrong");

// 2. ALLOW — approved vendor, under threshold; real capture
const allowed = await svc.decide("buy $42 of snacks from acme.com", card);
console.log("2. ALLOW:", allowed.decision, "| capture:", allowed.capture_id);
if (allowed.decision !== "ALLOW" || !allowed.capture_id) throw new Error("ALLOW path wrong");

// 3. ESCALATE — over threshold, parked
const escalated = await svc.decide("buy $500 of snacks from acme.com", card);
console.log("3. ESCALATE:", escalated.decision, "| approval:", escalated.approval_id);
if (escalated.decision !== "ESCALATE" || !escalated.approval_id) throw new Error("ESCALATE path wrong");

// 4. approve the escalation — real capture
const approved = await svc.approve(escalated.approval_id!, card);
console.log("4. approved → capture:", approved.capture_id);
if (!approved.capture_id) throw new Error("approve path wrong");

// 5. hash chain must verify across every row above
const chain = ledger.verifyChain();
console.log("5. chain:", chain.ok ? "VERIFIED" : `BROKEN at ${chain.brokenAt}`);
if (!chain.ok) throw new Error("ledger chain broken");
console.log(`   ledger rows: ${ledger.all().length}`);

console.log("PASS: sprint 2 policy spine green against live sandbox");
```

Add npm script: `"live-decisions": "node --experimental-strip-types --env-file=.env.local scripts/live-decisions-check.ts"`.

**Verify:**

```bash
npm run live-decisions
# expected:
# 1. DENY: DENY | vendor evil.com is not on the approved list
# 2. ALLOW: ALLOW | capture: <id>
# 3. ESCALATE: ESCALATE | approval: <uuid>
# 4. approved → capture: <id>
# 5. chain: VERIFIED
#    ledger rows: 5
# PASS: sprint 2 policy spine green against live sandbox
```

**Commit:** `git commit -m "test(live): sprint2 acceptance — deny/allow/escalate/approve + chain verify"`

---

### Task 2.6 — Delete the Sprint 1 escrow stack (ONLY after 2.5 is green)

Git history keeps everything; deletion only happens once the new spine is live-verified.

**Delete these files:**

```bash
git rm src/lib/deal.ts src/lib/deal.test.ts \
       src/lib/escrow.ts src/lib/escrow.test.ts src/lib/escrow-singleton.ts \
       src/lib/grader.ts src/lib/grader.test.ts \
       src/lib/money.ts src/lib/money.test.ts \
       src/app/api/deals \
       scripts/live-e2e-check.ts
git rm -r "src/app/api/deals"
```

**Also:** remove the `live-e2e` script from `package.json` (the `live-decisions` script replaces it).

**Update README status:**

```md
## Status

Sprints 0–2 complete: hash-chained audit ledger, policy engine (six rules: budget, per-txn cap, vendor allowlist, category limits, velocity, approval threshold), intent extraction, ALLOW/DENY/ESCALATE decisions — live-verified against the PayPal sandbox. Sprint 3 adds the mandate editor UI, decision dashboard, and auditor chain view.
```

**Verify (must be green with the old stack gone):**

```bash
npm test
# expected: 18 pass (9 policy + 3 intent + 6 decisions), 0 fail
npm run typecheck   # expected: silent
npm run live-decisions 2>&1 | tail -3
# expected: ... PASS: sprint 2 policy spine green against live sandbox
```

**Commit:** `git commit -m "refactor: remove sprint-1 escrow stack — policy engine replaces it (history kept)"`

---

## 5. Tests / validation summary

| Task | Test | Command | Expected |
|---|---|---|---|
| 2.1 | rule engine (9 cases incl. precedence) | `node --test src/lib/policy.test.ts` | pass 9 |
| 2.2 | intent extraction (parse, validation, failure) | `node --test src/lib/intent.test.ts` | pass 3 |
| 2.3 | decisions (allow/deny/escalate/approve/reject/capture-fail) | `node --test src/lib/decisions.test.ts` | pass 6 |
| 2.4 | full suite with routes | `npm test && npm run typecheck` | 40 pass, silent |
| 2.5 | live policy path + chain verify | `npm run live-decisions` | PASS line |
| 2.6 | suite after deletion | `npm test` | 18 pass |
| all | typecheck | `npm run typecheck` | silent |

**Definition of done:** all unit tests green, live check green (DENY touches no PayPal; ALLOW + approved ESCALATE produce real captures; chain verifies across every row), 6 commits, old stack deleted AFTER the live pass.

---

## 6. Risks, tradeoffs, open questions

| # | Risk | Call |
|---|---|---|
| R1 | Month context is zeroed (no budget/velocity aggregation) | **Deliberate shortcut** — `shortcut:` comment in `decisions.ts` names it; Sprint 3 aggregates from the ledger (the data is already there). Demo mandate stays small enough that the zeroed context doesn't produce wrong demos |
| R2 | Deleting the escrow stack before the new spine is truly done | Mitigated by task order: 2.6 runs only after 2.5 passes live. Both stacks coexist until then |
| R3 | Prompt injection: agent request text flows into the LLM | The engine is the enforcement point — a malicious request can only produce a DENY (rules are code, not prompt). The intent extractor failing → DENY path. Demo shows this explicitly |
| R4 | Sandbox captures accumulate on the shared business account | Each demo run captures a few dollars of fake money; harmless. The `data/agentguard.db` ledger is git-ignored |
| R5 | Card numbers in the live script | Sandbox test card only; `TEST_CARD_NUMBER` env var exists so the demo is not hardcoded |
| R6 | Escalations are in-memory (restart loses pending approvals) | `shortcut:` comment; Sprint 3 persists pending approvals with the mandate. Demo never restarts mid-flow |

**Open questions (answer in Sprint 3, not now):** mandate editor UI shape, decision dashboard layout, auditor view interaction (click a row → see its PayPal capture id), deployment target.

---

## 7. Ponytail: what this plan deliberately does NOT do

- **No budget/velocity aggregation** — zeroed context with a marked shortcut (R1). Sprint 3 aggregates from the ledger that already stores every row.
- **No mandate persistence / editor** — the demo mandate lives in one constant in `decisions-singleton.ts`. Sprint 3's editor writes that same JSON shape.
- **No auth, no multi-user** — one demo mandate, one card. YAGNI until the demo script needs roles.
- **No webhook receiver, no Vault** — the ledger is the audit trail; webhooks add a moving part the demo doesn't need.
- **Skipped:** I did not spike PayPal's wallet-approval flow (cards cover the demo — proven in Sprint 1), and did not design the Sprint 3 UI (depends on what this spine actually exposes). **Risk you must own:** R1 (zeroed month context — the demo mandate must stay small) and R3 (prompt injection is *contained* by design, but the demo must say "policy is code, not prompt" out loud for the judges to get it).
