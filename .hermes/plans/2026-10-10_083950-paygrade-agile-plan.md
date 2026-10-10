# PayGrade Implementation Plan

> **Methodology:** Agile/Iterative — small sprints, working vertical slices, frequent commits, adjust course as PayPal API reality bites.

**Goal:** Quality-weighted escrow: buyer+seller hash-commit a rubric, neutral LLM grader scores the delivery, PayPal authorizes full amount then captures only the earned share and voids the rest.

**Deadline:** Nov 13, 2026 03:45 NPT — ~34 days out.

---

## Sprint Plan (working backward from deadline)

| Sprint | Dates | Focus | Ship |
|--------|-------|-------|------|
| Sprint 0 | Oct 10-11 | Skeleton + sandbox creds + PayPal Orders smoke test | Orders API creates an order in sandbox |
| Sprint 1 | Oct 12-17 | Core escrow flow: order → authorize → (stub grade) → partial capture + void | E2E sandbox escrow working |
| Sprint 2 | Oct 18-24 | Rubric hash-commit (buyer+seller agree) + LLM grader integration | Real grading wired in |
| Sprint 3 | Oct 25-31 | UI: buyer/seller dashboards, rubric builder, grade review + dispute flow | Usable web app |
| Sprint 4 | Nov 1-7 | Polish, demo script, edge cases (timeouts, grader failures) | Demo-ready |
| Buffer | Nov 8-13 | Fix, record demo video, submit | Submitted |

---

## Architecture

```
Browser (React or plain HTML/JS)
  → Backend API (FastAPI or Express)
    ├── Escrow service   (order lifecycle state machine)
    ├── Rubric service   (hash-commit, verification)
    ├── Grader service   (LLM call, score 0-100, per-criterion breakdown)
    └── PayPal client    (Orders v2: create, authorize, capture, void)
  → SQLite or JSON store (hackathon speed > durability)
```

### State machine per escrow deal

```
CREATED → RUBRIC_COMMITTED → AUTHORIZED → DELIVERED → GRADED → CAPTURED(partial) + VOIDED(rest)
                                                                    ↘ DISPUTED (manual resolve)
```

### PayPal mapping
- `intent=AUTHORIZE` at deal creation (funds held, not taken)
- After grading: `POST /v2/checkout/orders/{id}/capture` with partial amount = `total × score/100`
- `POST /v2/checkout/orders/{id}/void` for the remainder (or void full + separate payment — spike will decide which PayPal actually supports)
- **Risk to spike first:** whether PayPal allows capture-then-void-partial cleanly. Fallback: void everything, then a fresh order for the earned amount, or capture full and refund the remainder.

### Grader
- One LLM call: rubric criteria + submission text → JSON score with per-criterion reasoning
- Deterministic hash: `sha256(canonical_json(rubric) + buyer_id + seller_id)` committed by both sides before delivery
- Temperature 0-ish, strict JSON schema output

---

## Sprint 0 detail (today/tomorrow)

1. Scaffold repo: backend dir, frontend dir, `.env.example` with `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV=sandbox`, `OPENAI/LLM key`
2. `curl` smoke test: create a sandbox order, authorize it, capture $1, void a second one — confirm the partial capture/void behavior before writing any product code
3. Write findings into `docs/spike-paypal-partial-capture.md` — this decides Sprint 1's core

## Sprint 1 detail

1. Deal CRUD + state machine with in-memory/SQLite store
2. PayPal client wrapper: create/authorize/capture/void with error handling + idempotency
3. Grader stub (returns fixed score) so E2E works before LLM is wired
4. E2E test: create deal → commit rubric → authorize → deliver → stub grade → partial capture + void

---

## Open questions

1. **LLM provider for grader** — OpenAI API key available? OmniRoute gateway as fallback?
2. **Frontend stack** — plain HTML/JS single page (fastest) or React?
3. **What's the "delivery"** — file upload, text paste, or URL? Simplest: text + optional file.

## Risks

- PayPal partial-capture/void semantics — spike in Sprint 0, decide fallback
- Grader determinism — hash-committed rubric + strict schema mitigates
- Scope creep — vertical slice first, features only after E2E green
