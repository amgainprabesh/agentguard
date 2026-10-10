# Sprint 1 — AgentGuard: Money Spine + First Vertical Slice

> **⚠️ UPDATE (Oct 10 2026):** All six tasks complete and live-verified. Two post-plan changes: the grader shipped as a **real OpenRouter LLM grader** (`gradeSubmission`, replacing the `gradeStub` sketched below — Sprint 2 work done early), and a **$0-capture guard** was added (PayPal rejects zero-amount captures — score 0 voids everything instead).


> **Method:** TDD per task (RED → implement → GREEN), vertical slice first, one working E2E path before broadening.
> **Sprint goal:** create deal → authorize (real, via card payment_source) → stub-grade → partial capture + void remainder, one path green E2E against the live sandbox. Answers open question R1 for real.
> **Deadline context:** hackathon due Nov 13 2026. Sprint 1 = Oct 10–13, 3 days.

---

## 1. Goal

Build the money spine of AgentGuard — the deal state machine, the real authorize/partial-capture/void client methods, and one vertical slice that proves the escrow works end-to-end against the live PayPal sandbox — so Sprint 2 can add the policy engine on a proven foundation.

---

## 2. What Sprint 0 already proved (do not re-litigate)

| Fact (verified live, Oct 10 2026) | Consequence for this sprint |
|---|---|
| Card + `PayPal-Request-Id` in the CREATE call returns the authorization **embedded** in the response (`purchase_units[].payments.authorizations[0].id`) | No separate authorize call. `createOrder` returns `{ order_id, auth_id, status }` |
| `POST /orders/{id}/authorize` on a card order → `422 ORDER_ALREADY_AUTHORIZED` | Never call the authorize endpoint for card orders |
| Partial capture `$4` of a `$10` authorization → `201 COMPLETED` | `capturePartial(auth_id, cents)` is the core operation |
| Void after partial capture → `204` **empty body**, auth status becomes `VOIDED` | Void handler must not JSON-parse the 204 |
| PayPal-wallet (non-card) orders need browser approval; **cards do not** | Sprint 1 demo uses cards only; wallet approval is Sprint 3 UI work |

**The partial-capture spike result (R1): CLOSED — works cleanly.** The escrow flow is: create+authorize (one call) → capture `total × score/100` → void the rest.

---

## 3. Architecture (Sprint 1 scope)

```
Deal state machine (src/lib/deal.ts)
  CREATED → AUTHORIZED → DELIVERED → GRADED → SETTLED
                                  ↘ FAILED (grader error → void full, release hold)

PayPal client extensions (src/lib/paypal.ts)
  createOrder()        [EXISTS - Sprint 0, wallet-only]      → extend: card payment_source + PayPal-Request-Id
  capturePartial()     [NEW]  POST /v2/payments/authorizations/{id}/capture  {amount}
  voidAuthorization()  [NEW]  POST /v2/payments/authorizations/{id}/void    (204, no body)

Grader stub (src/lib/grader.ts)  [NEW]
  grade(submission, rubric) → { score: 0-100, breakdown }  — fixed 75 in Sprint 1, real LLM in Sprint 2

API routes (src/app/api/)
  POST /api/deals       → create deal, authorize, persist, return ids
  POST /api/deals/[id]/deliver  → record submission
  POST /api/deals/[id]/settle   → stub-grade → partial capture + void → ledger rows

Ledger (src/lib/ledger.ts)  [EXISTS - unchanged, all state transitions append]
```

**Money invariant (tested):** `captured_cents + voided_cents == authorized_cents`. Every settle path must satisfy it.

---

## 4. Step-by-step tasks

All commands from repo root. **TDD cycle per task:** write failing test → run to see RED → implement → run to see GREEN → commit.

---

### Task 1.1 — Money math: score → capture split (pure function, test first)

The one place arithmetic lives. If this is wrong, everything downstream is wrong. Integer cents only.

**File created:** `src/lib/money.ts`

Test first — `src/lib/money.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitForScore } from "./money.ts";

test("score 75 of 10000 cents captures 7500, voids 2500", () => {
  const r = splitForScore(10000, 75);
  assert.equal(r.capture_cents, 7500);
  assert.equal(r.void_cents, 2500);
});

test("rounding: capture always gets the larger share on ties, sum preserved", () => {
  // 100 cents at score 33 -> 33.0 exact, no rounding needed
  assert.deepEqual(splitForScore(100, 33), { capture_cents: 33, void_cents: 67 });
  // 1000 cents at score 1 -> 10 exact
  assert.deepEqual(splitForScore(1000, 1), { capture_cents: 10, void_cents: 990 });
  // odd: 333 cents at 50% -> 166.5 -> round half up to 167, void 166
  const r = splitForScore(333, 50);
  assert.equal(r.capture_cents + r.void_cents, 333, "sum must be exact");
  assert.equal(r.capture_cents, 167);
  assert.equal(r.void_cents, 166);
});

test("score 0 captures nothing, voids all; score 100 captures all", () => {
  assert.deepEqual(splitForScore(5000, 0), { capture_cents: 0, void_cents: 5000 });
  assert.deepEqual(splitForScore(5000, 100), { capture_cents: 5000, void_cents: 0 });
});

test("score is clamped to 0..100 defensively", () => {
  assert.deepEqual(splitForScore(1000, 150), { capture_cents: 1000, void_cents: 0 });
  assert.deepEqual(splitForScore(1000, -20), { capture_cents: 0, void_cents: 1000 });
});
```

Implementation — `src/lib/money.ts`:

```ts
// The ONLY money arithmetic in the codebase. Integer cents, round-half-up on the
// capture side, remainder voids. Sum is always exactly the input total.
export function splitForScore(total_cents: number, score: number): { capture_cents: number; void_cents: number } {
  const clamped = Math.max(0, Math.min(100, score));
  const capture_cents = Math.round((total_cents * clamped) / 100);
  return { capture_cents, void_cents: total_cents - capture_cents };
}
```

**Verify:**

```bash
node --test src/lib/money.test.ts
# expected: pass 4, fail 0
```

**Commit:** `git commit -m "feat(money): score→capture split, integer cents, round-half-up"`

---

### Task 1.2 — Deal state machine (test first)

States, transitions, and the rule that only legal transitions append to the ledger.

**File created:** `src/lib/deal.ts`

Test first — `src/lib/deal.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Deal, canTransition } from "./deal.ts";

test("legal transitions only", () => {
  assert.ok(canTransition("CREATED", "AUTHORIZED"));
  assert.ok(canTransition("AUTHORIZED", "DELIVERED"));
  assert.ok(canTransition("DELIVERED", "GRADED"));
  assert.ok(canTransition("GRADED", "SETTLED"));
  assert.ok(!canTransition("CREATED", "SETTLED"), "cannot skip states");
  assert.ok(!canTransition("SETTLED", "AUTHORIZED"), "terminal state");
});

test("deliver is rejected before authorization", () => {
  const d = new Deal({ id: "d1", amount_cents: 1000 });
  assert.throws(() => d.deliver("submission text"), /not authorized/i);
});

test("full happy path transitions and records history", () => {
  const d = new Deal({ id: "d1", amount_cents: 1000 });
  d.authorize("AUTH123");
  assert.equal(d.state, "AUTHORIZED");
  d.deliver("here is the work");
  assert.equal(d.state, "DELIVERED");
  d.grade(80);
  assert.equal(d.state, "GRADED");
  d.settle();
  assert.equal(d.state, "SETTLED");
  assert.deepEqual(d.history, ["CREATED", "AUTHORIZED", "DELIVERED", "GRADED", "SETTLED"]);
});

test("grader failure voids the whole hold (FAILED path)", () => {
  const d = new Deal({ id: "d1", amount_cents: 1000 });
  d.authorize("AUTH123");
  d.deliver("work");
  d.fail("grader timeout");
  assert.equal(d.state, "FAILED");
  assert.ok(!canTransition("FAILED", "GRADED"));
});
```

Implementation — `src/lib/deal.ts`:

```ts
export type DealState = "CREATED" | "AUTHORIZED" | "DELIVERED" | "GRADED" | "SETTLED" | "FAILED";

const TRANSITIONS: Record<DealState, DealState[]> = {
  CREATED: ["AUTHORIZED", "FAILED"],
  AUTHORIZED: ["DELIVERED", "FAILED"],
  DELIVERED: ["GRADED", "FAILED"],
  GRADED: ["SETTLED", "FAILED"],
  SETTLED: [],
  FAILED: [],
};

export function canTransition(from: DealState, to: DealState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface DealInit {
  id: string;
  amount_cents: number;
}

export class Deal {
  state: DealState = "CREATED";
  auth_id: string | null = null;
  submission: string | null = null;
  score: number | null = null;
  history: DealState[] = ["CREATED"];

  constructor(readonly init: DealInit) {}

  private move(to: DealState): void {
    if (!canTransition(this.state, to)) {
      throw new Error(`illegal transition ${this.state} -> ${to}`);
    }
    this.state = to;
    this.history.push(to);
  }

  authorize(auth_id: string): void {
    if (this.state !== "CREATED") throw new Error("deal is not in CREATED state");
    this.auth_id = auth_id;
    this.move("AUTHORIZED");
  }

  deliver(submission: string): void {
    if (this.state !== "AUTHORIZED") throw new Error("deal is not authorized");
    this.submission = submission;
    this.move("DELIVERED");
  }

  grade(score: number): void {
    if (this.state !== "DELIVERED") throw new Error("deal has no submission to grade");
    this.score = Math.max(0, Math.min(100, score));
    this.move("GRADED");
  }

  settle(): void {
    if (this.state !== "GRADED") throw new Error("deal is not graded");
    this.move("SETTLED");
  }

  fail(reason: string): void {
    if (this.state === "SETTLED") throw new Error("cannot fail a settled deal");
    this.move("FAILED");
  }
}
```

**Verify:**

```bash
node --test src/lib/deal.test.ts
# expected: pass 4, fail 0
```

**Commit:** `git commit -m "feat(deal): state machine, legal transitions, FAILED escape path"`

---

### Task 1.3 — PayPal client: card payment_source + capturePartial + voidAuthorization (test first, then live)

Extend `src/lib/paypal.ts`. Keep `createOrder` (wallet) intact — add a card variant and the two settlement methods.

Test first — append to `src/lib/paypal.test.ts` (keep existing two tests untouched):

```ts
import { capturePartial, voidAuthorization } from "./paypal.ts";

test("capturePartial posts partial amount to the authorization capture endpoint", async () => {
  let captured: any = null;
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    captured = { url: String(url), body: JSON.parse(String(init.body)) };
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
  mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const result = await voidAuthorization("AUTH123");
  assert.equal(result, true, "204 = voided");
  mock.reset();
});
```

Implementation — modify `src/lib/paypal.ts` (keep everything that exists; add):

```ts
// Create order + embedded authorization in one call, using a card payment_source.
// The authorization id comes back INSIDE the create response — there is no separate
// authorize step for card orders (the authorize endpoint 422s with ORDER_ALREADY_AUTHORIZED).
export async function createOrderWithCard(input: {
  amount_cents: number;
  card: {
    number: string;
    expiry: string; // "YYYY-MM"
    security_code: string;
    name: string;
  };
  currency?: string;
}): Promise<{ order_id: string; auth_id: string; status: string }> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tok}`,
      "content-type": "application/json",
      // PayPal REQUIRES this header when payment_source is present at create time
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          amount: {
            currency_code: input.currency ?? "USD",
            value: (input.amount_cents / 100).toFixed(2),
          },
        },
      ],
      payment_source: {
        card: {
          number: input.card.number,
          expiry: input.card.expiry,
          security_code: input.card.security_code,
          name: input.card.name,
          billing_address: {
            address_line_1: "123 Main St",
            admin_area_2: "San Jose",
            admin_area_1: "CA",
            postal_code: "95131",
            country_code: "US",
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`PayPal createOrderWithCard failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    id: string;
    status: string;
    purchase_units: { payments: { authorizations: { id: string; status: string }[] } }[];
  };
  const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error("no authorization returned in create response");
  return { order_id: data.id, auth_id: auth.id, status: auth.status };
}

export async function capturePartial(
  auth_id: string,
  amount_cents: number,
  currency = "USD",
): Promise<{ id: string; status: string }> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/payments/authorizations/${auth_id}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: { currency_code: currency, value: (amount_cents / 100).toFixed(2) },
    }),
  });
  if (!res.ok) throw new Error(`PayPal capturePartial failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; status: string };
}

// Void returns 204 with an EMPTY body — do not JSON.parse it.
export async function voidAuthorization(auth_id: string): Promise<boolean> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/payments/authorizations/${auth_id}/void`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
  });
  if (res.status === 204) return true;
  if (!res.ok) throw new Error(`PayPal voidAuthorization failed: ${res.status} ${await res.text()}`);
  return true;
}
```

Add `import crypto from "node:crypto";` is NOT needed — `crypto.randomUUID()` is global in Node 26.

**Verify:**

```bash
npm test
# expected: pass 6 (4 old + 2 new), fail 0
npm run typecheck
# expected: silent, exit 0
```

**Live check (real sandbox, through app code):** extend `scripts/live-paypal-check.ts`:

```ts
import { createOrderWithCard, capturePartial, voidAuthorization } from "../src/lib/paypal.ts";

const { order_id, auth_id } = await createOrderWithCard({
  amount_cents: 1000,
  card: {
    number: process.env.TEST_CARD_NUMBER ?? "4111111111111111",
    expiry: "2028-12",
    security_code: "123",
    name: "Test Buyer",
  },
});
console.log("order:", order_id, "auth:", auth_id);

const cap = await capturePartial(auth_id, 400);
console.log("captured $4:", cap.id, cap.status);

const voided = await voidAuthorization(auth_id);
console.log("voided remainder:", voided);
console.log("PASS: partial capture + void works end to end");
```

```bash
npm run live-check:paypal
# expected: order + auth ids, capture COMPLETED, voided true, PASS line
```

**Commit:** `git commit -m "feat(paypal): card payment_source, capturePartial, voidAuthorization (204 handling)"`

---

### Task 1.4 — Grader stub (test first)

Real LLM lands in Sprint 2. The stub keeps the vertical slice honest — settle works without an LLM call.

**File created:** `src/lib/grader.ts`

Test first — `src/lib/grader.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeStub } from "./grader.ts";

test("stub returns fixed score 75 with breakdown", async () => {
  const r = await gradeStub("any submission", [{ criterion: "quality", weight: 1 }]);
  assert.equal(r.score, 75);
  assert.ok(Array.isArray(r.breakdown));
});
```

Implementation — `src/lib/grader.ts`:

```ts
// Sprint 1 stub: fixed score so the vertical slice runs without an LLM.
// Sprint 2 replaces gradeStub with a real OpenRouter call + strict JSON schema.
export async function gradeStub(
  _submission: string,
  rubric: { criterion: string; weight: number }[],
): Promise<{ score: number; breakdown: { criterion: string; score: number }[] }> {
  return {
    score: 75,
    breakdown: rubric.map((r) => ({ criterion: r.criterion, score: 75 })),
  };
}
```

**Verify:**

```bash
node --test src/lib/grader.test.ts
# expected: pass 1, fail 0
```

**Commit:** `git commit -m "feat(grader): stub returning fixed score 75 (real LLM in sprint 2)"`

---

### Task 1.5 — API routes: the vertical slice (test-first at the handler level)

Three routes. Test the *service function* behind each route (routes stay thin).

**Files created:** `src/lib/escrow.ts` (the service), `src/lib/escrow.test.ts`, `src/app/api/deals/route.ts`, `src/app/api/deals/[id]/deliver/route.ts`, `src/app/api/deals/[id]/settle/route.ts`

Test first — `src/lib/escrow.test.ts` (mocks paypal + grader so no network):

```ts
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";

const { Escrow } = await import("./escrow.ts");
const { Ledger } = await import("./ledger.ts");

test("full escrow: create → deliver → settle captures score share, voids rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-e-"));
  const ledger = new Ledger(join(dir, "t.db"));
  const calls: string[] = [];

  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/v1/oauth2/token"))
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.endsWith("/v2/checkout/orders"))
      return new Response(JSON.stringify({
        id: "ORD1", status: "COMPLETED",
        purchase_units: [{ payments: { authorizations: [{ id: "AUTH1", status: "CREATED" }] } }],
      }), { status: 201, headers: { "content-type": "application/json" } });
    if (u.endsWith("/capture"))
      return new Response(JSON.stringify({ id: "CAP1", status: "COMPLETED" }), { status: 201, headers: { "content-type": "application/json" } });
    if (u.endsWith("/void"))
      return new Response(null, { status: 204 });
    throw new Error("unexpected fetch: " + u);
  });

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
  assert.ok(rows.some((r) => r.reason.includes("captured")));
  assert.ok(rows.some((r) => r.reason.includes("voided")));

  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
  mock.reset();
});

test("money invariant: captured + voided == authorized, always", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-e2-"));
  const ledger = new Ledger(join(dir, "t.db"));
  mock.method(globalThis, "fetch", async (url: any) => {
    const u = String(url);
    if (u.endsWith("/v1/oauth2/token"))
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.endsWith("/v2/checkout/orders"))
      return new Response(JSON.stringify({
        id: "ORD2", status: "COMPLETED",
        purchase_units: [{ payments: { authorizations: [{ id: "AUTH2", status: "CREATED" }] } }],
      }), { status: 201, headers: { "content-type": "application/json" } });
    if (u.endsWith("/capture")) return new Response(JSON.stringify({ id: "C", status: "COMPLETED" }), { status: 201, headers: { "content-type": "application/json" } });
    if (u.endsWith("/void")) return new Response(null, { status: 204 });
    throw new Error("unexpected " + u);
  });
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
```

Implementation — `src/lib/escrow.ts`:

```ts
import { Deal } from "./deal.ts";
import { Ledger } from "./ledger.ts";
import { createOrderWithCard, capturePartial, voidAuthorization } from "./paypal.ts";
import { gradeStub } from "./grader.ts";
import { splitForScore } from "./money.ts";

export interface EscrowDealView {
  id: string;
  state: Deal["state"];
  auth_id: string | null;
  score: number | null;
  capture_cents?: number;
  void_cents?: number;
}

export class Escrow {
  private deals = new Map<string, Deal>();

  constructor(private ledger: Ledger) {}

  async createDeal(input: {
    amount_cents: number;
    card: { number: string; expiry: string; security_code: string; name: string };
    rubric: { criterion: string; weight: number }[];
  }): Promise<EscrowDealView & { auth_id: string }> {
    const id = crypto.randomUUID();
    const deal = new Deal({ id, amount_cents: input.amount_cents });
    this.deals.set(id, deal);

    const { order_id, auth_id } = await createOrderWithCard({
      amount_cents: input.amount_cents,
      card: input.card,
    });
    deal.authorize(auth_id);

    this.ledger.append({
      action: "ALLOW",
      amount_cents: input.amount_cents,
      reason: `deal ${id} authorized, order ${order_id}, auth ${auth_id}`,
    });
    return { id, state: deal.state, auth_id };
  }

  private get(id: string): Deal {
    const d = this.deals.get(id);
    if (!d) throw new Error(`deal ${id} not found`);
    return d;
  }

  async deliver(id: string, submission: string): Promise<EscrowDealView> {
    const deal = this.get(id);
    deal.deliver(submission);
    return { id, state: deal.state, auth_id: deal.auth_id, score: deal.score };
  }

  async settle(id: string): Promise<EscrowDealView & { capture_cents: number; void_cents: number }> {
    const deal = this.get(id);
    const rubric = [{ criterion: "quality", weight: 1 }];
    const grade = await gradeStub(deal.submission ?? "", rubric);
    deal.grade(grade.score);

    const total = deal.init.amount_cents;
    const { capture_cents, void_cents } = splitForScore(total, grade.score);

    if (!deal.auth_id) throw new Error("deal has no authorization to settle against");

    // capture the earned share
    const cap = await capturePartial(deal.auth_id, capture_cents);
    this.ledger.append({
      action: "ALLOW",
      amount_cents: capture_cents,
      reason: `deal ${id} captured score ${grade.score}, capture ${cap.id}`,
    });

    // void the remainder (skip void when capture took the full amount — void of a
    // fully-captured authorization 422s)
    if (void_cents > 0) {
      await voidAuthorization(deal.auth_id);
      this.ledger.append({
        action: "DENY",
        amount_cents: void_cents,
        reason: `deal ${id} voided remainder`,
      });
    }

    deal.settle();
    return { id, state: deal.state, auth_id: deal.auth_id, score: deal.score, capture_cents, void_cents };
  }
}
```

Thin routes:

`src/app/api/deals/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { Escrow } from "@/lib/escrow";
import { Ledger } from "@/lib/ledger";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const deal = await escrow.createDeal(body);
    return NextResponse.json(deal, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
```

`src/app/api/deals/[id]/deliver/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { Escrow } from "@/lib/escrow";
import { Ledger } from "@/lib/ledger";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { submission } = await req.json();
  try {
    const deal = await escrow.deliver(id, submission);
    return NextResponse.json(deal);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
```

`src/app/api/deals/[id]/settle/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { Escrow } from "@/lib/escrow";
import { Ledger } from "@/lib/ledger";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deal = await escrow.settle(id);
    return NextResponse.json(deal);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
```

> **Known shortcut, Sprint 1 only:** routes each construct their own `Escrow`, so the in-memory deal map is per-route and `deliver`/`settle` will NOT see deals created by the create route. **This is a deliberate TDD slip:** the escrow service tests pass (they share one `Escrow` instance), and the E2E test below runs against a single route only. **Sprint 2 task: extract a module-level singleton (or persist deals to the ledger DB) so routes share state.** Flagged so nobody is surprised when the browser flow 404s on step 2.

**Verify:**

```bash
npm test
# expected: pass 8 (money 4 + deal 4 + grader 1 + escrow 2 = 11 — recount: 4+4+1+2 = 11), fail 0
npm run typecheck
# expected: silent
```

**Commit:** `git commit -m "feat(escrow): vertical slice — create/deliver/settle with partial capture+void"`

---

### Task 1.6 — E2E live check through the API (the sprint's acceptance test)

**File created:** `scripts/live-e2e-check.ts`

```ts
// Sprint 1 acceptance: one full escrow against the LIVE sandbox through the API layer.
// Run: npm run live-e2e
import { Escrow } from "../src/lib/escrow.ts";
import { Ledger } from "../src/lib/ledger.ts";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

const deal = await escrow.createDeal({
  amount_cents: 10000,
  card: {
    number: process.env.TEST_CARD_NUMBER ?? "4111111111111111",
    expiry: "2028-12",
    security_code: "123",
    name: "Test Buyer",
  },
  rubric: [{ criterion: "quality", weight: 1 }],
});
console.log("1. created + authorized:", deal.id, deal.auth_id);

await escrow.deliver(deal.id, "Here is the delivered work.");
console.log("2. delivered");

const settled = await escrow.settle(deal.id);
console.log("3. settled:", JSON.stringify(settled));

// money invariant, asserted against real API results
if (settled.capture_cents + settled.void_cents !== 10000) {
  throw new Error("MONEY INVARIANT VIOLATED");
}
if (settled.capture_cents !== 7500) {
  throw new Error(`expected 7500 captured at score 75, got ${settled.capture_cents}`);
}
console.log("PASS: sprint 1 vertical slice green against live sandbox");
```

Add npm script: `"live-e2e": "node --experimental-strip-types --env-file=.env.local scripts/live-e2e-check.ts"`.

**Verify:**

```bash
npm run live-e2e
# expected:
# 1. created + authorized: <uuid> <auth-id>
# 2. delivered
# 3. settled: {...capture_cents:7500, void_cents:2500, state:SETTLED}
# PASS: sprint 1 vertical slice green against live sandbox
```

**Commit:** `git commit -m "test(e2e): sprint1 acceptance — full escrow against live sandbox"`

---

## 5. Tests / validation summary

| Task | Test | Command | Expected |
|---|---|---|---|
| 1.1 | money split + invariant | `node --test src/lib/money.test.ts` | pass 4 |
| 1.2 | state machine | `node --test src/lib/deal.test.ts` | pass 4 |
| 1.3 | paypal methods (mocked) | `npm test` | pass 6+ |
| 1.3 | paypal live (card, partial, void) | `npm run live-check:paypal` | PASS line |
| 1.4 | grader stub | `node --test src/lib/grader.test.ts` | pass 1 |
| 1.5 | escrow service + invariant | `npm test` | pass 11 total |
| 1.6 | E2E live | `npm run live-e2e` | PASS line |
| all | typecheck | `npm run typecheck` | silent |

**Definition of done:** all unit tests green, both live checks green against the sandbox, 6 commits, money invariant proven twice (unit + live).

---

## 6. Risks, tradeoffs, open questions

| # | Risk | Call |
|---|---|---|
| R1 | ~~Partial capture/void semantics~~ | **CLOSED by spike:** works cleanly. Capture partial → void remainder (204, empty body) → auth status VOIDED |
| R2 | Card numbers in env/test data | Sandbox test card `4111...` only; never real cards. `TEST_CARD_NUMBER` env var exists so the demo script is not hardcoded |
| R3 | Routes don't share deal state (module-level map per route) | **Deliberate Sprint 1 slip** — service tests pass; Sprint 2 extracts a singleton or persists to DB. The E2E script uses one Escrow instance so it is unaffected |
| R4 | Void of a fully-captured authorization 422s | Handled: `void_cents > 0` guard before calling void |
| R5 | Grader is a stub (fixed 75) | Real LLM in Sprint 2. Sprint 1 proves the money spine, not grading quality |
| R6 | Live checks need real creds + network | `npm run live-*` will fail without `.env.local` creds; unit tests never touch network |

**Deferred to Sprint 2+:** real LLM grader, mandate editor UI, policy rule engine, escalation approvals, auditor chain view, route-level state sharing fix, deployment.

---

## 7. Ponytail: what this plan deliberately does NOT do

- **No ORM, no deal persistence layer, no zod, no eslint** — `node:sqlite` + plain classes carry Sprint 1. Persistence for deals arrives in Sprint 2 with the policy engine that actually needs it.
- **No browser UI this sprint** — routes + scripts prove the spine; the "stunning minimal UI" is Sprint 3, informed by what the spine actually exposes.
- **No webhook receiver, no Vault, no platform fees** — YAGNI until the demo script demands them.
- **Skipped:** I did not spike wallet-buyer approval flows (cards cover the demo), did not test reauthorization (29-day window is beyond hackathon scope), and did not build route-level state sharing (flagged R3, Sprint 2). **Risk you must own:** the routes as written will 404 on step 2 in a browser until R3 is fixed — the E2E script is green regardless, so don't read the green script as a green browser flow.
