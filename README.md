# AgentGuard

Spend-policy control plane for AI purchasing agents. Policy is code, not prompt.

## Run it (2 minutes)

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your keys:
   - **PayPal sandbox**: create a sandbox app at
     [developer.paypal.com/dashboard/applications/sandbox](https://developer.paypal.com/dashboard/applications/sandbox)
     → *Create App* → copy **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET`.
   - **LLM**: an OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys).
3. `npm run dev` → http://localhost:3000
4. `npm test` for the test suite.

## Verify against the live sandbox

`npm run live-decisions` — runs the full policy path against the real PayPal sandbox:
DENY (PayPal never touched) → ALLOW (real capture) → ESCALATE → approve (real capture) →
verifies the hash chain across every row. Needs real creds in `.env.local`.

## API

| Method | Route | What it does |
|---|---|---|
| POST | `/api/decide` | Body `{request, card}` → `{decision, reasons, intent, capture_id?, approval_id?}` |
| GET | `/api/approvals` | Lists pending escalations |
| POST | `/api/approvals/[id]/approve` | Executes a parked escalation (real capture) |
| POST | `/api/approvals/[id]/reject` | Refuses an escalation, never captures |
| GET | `/api/health` | `{ok, paypal_env, llm_model}` |

## How a decision is made

1. **Intent extraction** — the LLM turns a messy request ("buy $42 of snacks from acme.com")
   into `{vendor, amount_cents, category}`. Any failure → DENY. Never a guessed intent.
2. **Rule engine** (`src/lib/policy.ts`) — six rules as a pure function, no I/O:
   monthly budget, per-transaction cap, vendor allowlist, category limits, velocity,
   approval threshold. Any hard violation → DENY (all reasons collected);
   threshold breach → ESCALATE; else ALLOW.
3. **Execution** — ALLOW captures via PayPal immediately; ESCALATE parks for a human;
   DENY never touches PayPal.
4. **Ledger** — every decision appends to a hash-chained SQLite ledger
   (`data/agentguard.db`, git-ignored). `verifyChain()` proves tampering.

Prompt injection cannot change the rules: the policy is code, and a poisoned request
can at worst produce a DENY.

## Status

Sprints 0–2 complete: hash-chained audit ledger, policy engine (six rules: budget, per-txn cap, vendor allowlist, category limits, velocity, approval threshold), intent extraction, ALLOW/DENY/ESCALATE decisions — live-verified against the PayPal sandbox. Sprint 3 adds the mandate editor UI, decision dashboard, and auditor chain view.
