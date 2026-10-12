# AgentGuard — Submission text (Devpost)

**Repo:** https://github.com/amgainprabesh/agentguard (MIT, public)

## Tagline
Spend-policy control plane for AI purchasing agents. Policy is code, not prompt.

## Inspiration
Companies are handing purchasing to AI agents — restocking supplies, buying ad
credits, paying for SaaS seats. Finance has no enforcement point on the payment
path: a prompt is not a policy, a looping agent can blow a budget before anyone
notices, and there is no tamper-evident record of why an agent was allowed to
spend. When the invoice lands, nobody can prove what authorized it.

## What it does
AgentGuard sits **on the payment path**, not beside it. A spend request from an
agent goes through three stages before money can move:

1. **Intent extraction** — an LLM turns a messy natural-language request
   ("buy $42 of snacks from acme.com") into a strict structured intent
   `{vendor, amount_cents, category}`. Any failure — parse error, malformed
   amount, LLM error — is a DENY. The system never guesses an intent.
2. **Rule engine** — a deterministic TypeScript policy evaluates six rules
   (monthly budget, per-transaction cap, vendor allowlist, category limits,
   velocity, approval threshold) against real month/velocity spend aggregated
   from the audit ledger. Any hard violation → DENY with plain-English reasons;
   threshold breach → ESCALATE; else ALLOW.
3. **Execution** — ALLOW executes a real PayPal authorization + capture via the
   Orders v2 API; ESCALATE parks for a one-tap human approval, then executes;
   DENY never touches PayPal at all.

Every decision — allow, deny, escalate, capture, denial — is appended to a
SHA-256 hash-chained SQLite ledger. Tamper with one row and the chain visibly
breaks at exactly that link. The auditor view shows the chain row by row, with
a live "break the chain" demo.

**The line that wins the room: policy is code, not prompt.** A prompt-injection
attack can at worst produce a DENY — it cannot rewrite the rules, and we
demonstrate this live.

## How we built it
- **Next.js 15** (App Router, TypeScript) — API routes + server-rendered UI.
- **PayPal Orders v2** (sandbox): card payment_source at create time with
  `PayPal-Request-Id`, which returns the order COMPLETED with the authorization
  embedded — no separate authorize step; then a capture of the exact amount.
  All money math in integer cents.
- **node:sqlite** (`DatabaseSync`) — the append-only hash-chained audit ledger
  with `verifyChain()` (indexed on action + created_at so the policy engine's
  month/velocity aggregation is not a full scan).
- **LLM** (OpenRouter, free model) — intent extraction only; the decision
  itself is deterministic code, never the model. Calls time out at 90s
  (measured tail latency of the free model) with one retry on transient
  failures.
- Input validation at every trust boundary: card number (Luhn) + expiry,
  request length, mandate edits — all validated before any external call, so a
  bad input never spends an LLM token or a PayPal call.
- Security hardening: a shared error-response whitelist (only our own validation
  messages reach the client — vendor and LLM error bodies do not), a tamper
  endpoint that 400/404s on a bad or missing seq instead of faking success,
  baseline security headers on every response, and a `next` bump that clears the
  critical RCE advisory cluster.

## Testing
57 unit/integration tests (node:test) covering: the hash chain (genesis,
tamper detection, category migration), mandate validation, the LLM intent
extraction (malformed output, thinking-wrapped JSON, clamped amounts, transient
retries), all policy rules, the full ALLOW/DENY/ESCALATE/approve paths, capture
failure handling, double-approve protection, lost-escalation-on-restart
detection, month/velocity aggregation, case-insensitive vendor/category
matching, the card validator at the trust boundary (Luhn, expiry), the tamper
endpoint's seq guard (400/404, no silent success), and the API error-message
whitelist (vendor/LLM error bodies never leak). Plus a
live end-to-end check (`npm run live-decisions`) that runs the whole policy path
against the real PayPal sandbox — DENY (PayPal never touched) → ALLOW (real
capture) → ESCALATE → approve (real capture) → chain verified.

## Challenges we ran into
- **PayPal card-order semantics** — we spiked the real sandbox before planning:
  card orders authorize embedded at create time (the separate authorize
  endpoint 422s with ORDER_ALREADY_AUTHORIZED), and the `PayPal-Request-Id`
  header is mandatory whenever `payment_source` is present at create time.
- **LLM tail latency** — the free model's intent call measured a median of ~15s
  with a tail past 30s; a 30s timeout (our first guess) aborted roughly one call
  in five. Set from measurements, the timeout is 90s with one retry on
  transient failures.
- **Untrusted LLM arithmetic** — the intent's amount is clamped and validated,
  and any parse failure is a DENY, never a guess.
- **Ledger aggregation** — the velocity and budget rules must count what was
  actually spent this month, not a running total since boot. Solved by
  aggregating the ledger itself in `monthContext()`.

## Accomplishments that we're proud of
- The live tamper demo: edit a row in the database while the audience watches,
  re-verify, and the chain breaks at exactly that link — with a repair script
  to restore the demo ledger afterward.
- Zero silent failures: a capture failure writes a DENY row with the error, it
  never reports success.
- Every input is validated at the trust boundary before any external call — a
  bad card (failed Luhn, expired) or an oversized request never spends an LLM
  token or a PayPal call, and never lands in the audit ledger.
- Complete product: mandate editor → agent runtime → decision dashboard →
  auditor view. Judges can run it in 2 minutes (`npm install`, `.env.local`,
  `npm run dev`).

## What we learned
- **Money math in one place**: integer minor units everywhere, in a single
  conversion point. If the conversion is wrong, every downstream number is
  wrong.
- **Spike before you plan**: every surprise about the PayPal API semantics was
  found with a throwaway probe script against the live sandbox, never guessed
  from the docs.
- **Measure, don't guess, timeouts**: the LLM timeout was wrong until we
  sampled real latency — 14 measurements turned a flaky acceptance check into a
  green one.
- **The audit ledger is the aggregation source**: the policy engine reads real
  spend from the same chain that proves tampering — one source of truth.

## What's next for AgentGuard
- Multi-agent support: per-agent mandates and per-agent budget partitions.
- Webhook receiver (`/v1/notifications/verify-webhook-signature`) to ingest
  PayPal events into the ledger — the chain becomes externally anchored.
- Vault payment-method tokens as the agent wallet (no raw card in the request).
- Configurable rule DSL beyond the current six rule types.
- Strict CSP via nonce middleware (script-src is permissive today) and
  authentication on the mutating endpoints before any public deployment.

## Tools list

### PayPal APIs used
- **Orders v2** (`POST /v2/checkout/orders`) — order creation with
  `intent: AUTHORIZE` and a card `payment_source`; returns the embedded
  authorization id in the create response.
- **Payments v2 — Capture** (`POST /v2/payments/authorizations/{id}/capture`)
  — captures the exact spend amount against the authorization.
- **OAuth2 token** (`POST /v1/oauth2/token`) — client-credentials token,
  cached in-module for ~9 hours.
- Sandbox base: `https://api-m.sandbox.paypal.com`.

(During development we also spiked the void and authorization-status endpoints
against the sandbox — those probes are documented in the project's PayPal skill;
the shipped build captures the full approved amount, so void is not on its
hot path.)

### AI tools used
- **OpenRouter** (`nvidia/nemotron-3.5-lightning:free`) — intent extraction
  only: messy natural-language spend request → strict JSON intent. temperature
  0, reasoning effort low. The decision itself is deterministic TypeScript, never
  the model.
- The LLM output is treated as untrusted input: parsed strictly, amounts
  clamped, any failure → DENY.

### Other tools
- Next.js 15 (App Router) + TypeScript 5.9
- node:sqlite (DatabaseSync) — hash-chained audit ledger
- node:test — 57 tests
- node:crypto (SHA-256) — hash chain
