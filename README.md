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
4. `npm test` for the test suite (57 tests, no credentials needed — everything external is mocked).

## Verify against the live sandbox

`npm run live-decisions` — runs the full policy path against the real PayPal sandbox:
DENY (PayPal never touched) → ALLOW (real capture) → ESCALATE → approve (real capture) →
verifies the hash chain across every row. Needs real creds in `.env.local`.

After the tamper demo on `/audit`, the live demo ledger's chain stays broken
(`brokenAt: 3`) — that is the point of the demo. To restore it for a fresh demo run:
`npm run repair-ledger`.

After a rehearsal session the demo ledger fills with rows and the velocity rule
(10 txns/hour) starts denying everything — before demoing, `npm run reset-demo`
clears the ledger and restarts seq at 1.

## Validation (trust boundary)

`POST /api/decide` and `POST /api/approvals/[id]/approve` validate before any external call:

- `request` must be a non-empty string, ≤2,000 characters (else 400, no LLM call).
- `card` must pass `validateCard()` in `src/lib/decisions.ts`: number 13–19 digits
  **with a valid Luhn checksum**, expiry `YYYY-MM` **not in the past**, security code
  3–4 digits, non-empty name ≤100 chars (else 400, no LLM/PayPal call, no ledger row).

A bad card therefore never spends an LLM token or a PayPal call, and never
appears in the audit ledger.

## Security

Hardening shipped on top of the trust-boundary validation:

- **Tamper endpoint validates `seq`** — `POST /api/ledger/tamper` returns 400 for a
  non-positive-integer `seq` and 404 for a `seq` with no ledger row, instead of the
  old silent `ok:true` with nothing broken.
- **Error responses are whitelisted** — `src/app/api/_errors.ts` echoes only known
  validation messages (`card.`, `mandate.`, `request`, `approval` prefixes, ≤200
  chars). Vendor (PayPal) and LLM error bodies are replaced by a generic fallback,
  so internals never reach the client.
- **Security headers on every response** (`next.config.ts`): `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  and a CSP.
- **`next` 15.4.6 → 15.5.27** — drops the critical RCE advisory cluster.

`repair-ledger.ts` re-hashes from the running `prev` and strips every `[TAMPERED]`
marker, so a mid-chain tamper now repairs cleanly (the old script left the chain
broken at the following row).

## Known limitations

- **`npm audit` still reports 2 advisories** — both transitive PostCSS issues
  pulled in by `next` (1 high: arbitrary `.map` file read; 1 moderate: XSS in CSS
  stringify output). A clean fix requires `next` 16, a breaking major.
- **No authentication on mutating endpoints** — `/api/decide`, the approvals, and
  `PUT /api/mandate` are unauthenticated. This is a localhost-only demo; do not
  deploy it publicly without adding auth.
- **CSP `script-src` stays permissive** (`'self' 'unsafe-inline' 'unsafe-eval'`) —
  Next ships inline RSC payloads and dev hydration needs `eval`. The real fix is
  per-request nonce middleware; until that is wired, the other headers still apply.

## Maintenance scripts

| Script | What it does |
|---|---|
| `npm run live-decisions` | Full policy path against the live PayPal sandbox (DENY → ALLOW → ESCALATE → approve → chain verify) |
| `npm run repair-ledger` | Restores the demo ledger after the tamper demo (re-hashes the chain forward) |
| `npm run reset-demo` | Clears the demo ledger and restarts seq at 1 — run before every demo |
| `scripts/audit-ledger.ts` | Independent ledger audit: recomputes the chain without reusing `verifyChain()`, flags seq gaps / duplicate hashes / invalid actions / non-positive amounts. Run: `node --experimental-strip-types scripts/audit-ledger.ts` |
| `npm run seed-demo` | Backfills the demo ledger with a realistic history (ALLOW/DENY/ESCALATE rows, backdated) so the audit view has content instantly — the video then needs only one live decide instead of four. All rows are real hash-chained rows (the chain hash excludes `created_at`, so backdating cannot break it). |

## API

| Method | Route | What it does |
|---|---|---|
| POST | `/api/decide` | Body `{request, card}` → `{decision, reasons, intent, capture_id?, approval_id?}` |
| GET | `/api/approvals` | Lists pending escalations |
| POST | `/api/approvals/[id]/approve` | Executes a parked escalation (real capture) |
| POST | `/api/approvals/[id]/reject` | Refuses an escalation, never captures |
| GET | `/api/mandate` | Returns the current mandate |
| PUT | `/api/mandate` | Body = full mandate → validates, persists to `data/mandate.json`, hot-swaps the engine |
| GET | `/api/ledger` | All ledger rows + chain verification |
| POST | `/api/ledger/tamper` | Demo hook: body `{seq}` breaks the chain at that row. 400 if `seq` is not a positive integer, 404 if no row has it |
| GET | `/api/health` | `{ok, paypal_env, llm_model}` |

## UI

Four views, all server-rendered by the routes above:

- `/` — hub linking the three views
- `/mandate` — edit the six rules; Save hot-swaps the live engine
- `/decisions` — send a spend request, see the decision with reasons, approve/reject escalations
- `/audit` — the hash chain row by row, verify, and a "break the chain" button for the tamper demo

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

Sprints 0–3 complete: hash-chained audit ledger, policy engine (six rules, now aggregating real month/velocity spend from the ledger), intent extraction, ALLOW/DENY/ESCALATE decisions — live-verified against the PayPal sandbox. UI: mandate editor, decision dashboard, auditor chain view with a live tamper demo. Security hardening landed since: input-validated tamper endpoint, whitelisted API error messages, security headers, `next` bumped to 15.5.27, repair-ledger bug fixed (see [Security](#security)).

57 tests, `npm run typecheck` and `npm run build` clean.

## Notes for demo day

- Run `npm run reset-demo` first — a rehearsal leaves rows that trip the velocity rule.
- Each decision costs one LLM call: expect ~15–40s on the free model (measured median ~15s). A paid model would cut it to ~1s.
- Don't run `npm run build` while `npm run dev` is serving from the same `.next/` — the production artifacts break the dev server (`Cannot find module './chunks/vendor-chunks/next.js'`). Use one or the other.
