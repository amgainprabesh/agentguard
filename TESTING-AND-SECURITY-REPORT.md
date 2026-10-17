# AgentGuard — Testing & Security Report

**Project:** AgentGuard — spend-policy control plane for AI purchasing agents
**Date:** 2026-10-17 · **Build:** `main` @ `fbac0f1` (next 15.5.27, node:sqlite, OpenRouter LLM, PayPal sandbox)
**Scope:** unit, integration (prior session), system, release, alpha, beta, white-box, black-box testing + full security review

---

## 1. Executive summary

| Verdict | |
|---|---|
| **Release readiness** | **READY for the intended scope** — a localhost/sandbox demo. All test levels pass. |
| Unit tests | 89/89 pass, typecheck clean |
| Integration (prior session) | 19/19 in-process route checks; live prod-mode approve with real capture |
| System testing | 11/11 workflow checks + tamper→repair→audit loop + independent audit script |
| Release testing | Production build + start + restart durability + headers + fail-closed env — pass |
| Black-box probes | 52 probes — all validation boundaries hold; 2 low findings, 0 high |
| Alpha (UI dogfood) | 4/4 — no console errors, no failing requests |
| Beta (real LLM + real PayPal sandbox) | Real ALLOW capture verified; escalate path blocked by free-tier LLM timeouts (third-party, not an app defect) |
| Security review | 2 high (both documented, demo-scoped), 1 medium (new), 4 low/info (new) |

**Bottom line:** the system is correct, well-ordered, and fail-closed everywhere it was probed. The two "high" items (no auth on mutating endpoints, permissive CSP) are real but consciously scoped to a localhost demo — they become blockers the moment this is deployed publicly.

---

## 2. Results by level

### 2.1 Unit testing — PASS
- `npm test`: **89/89** (`ℹ pass 89, fail 0`), `tsc --noEmit` clean.
- Coverage of every lib seam: policy boundaries (inclusive caps, velocity, DENY-beats-ESCALATE), intent parse failures, PayPal token/cache/errors, ledger hash chain + tamper, mandate validation/atomic write, error whitelist, env fail-closed.

### 2.2 Integration testing — PASS (prior session, summarized)
- 19/19 in-process checks driving the real route handlers with mocked LLM/PayPal: ALLOW/ESCALATE/DENY paths, homoglyph fail-closed, mandate hot-swap propagation, double-approve/reject idempotence, tamper demo, bad-card gate.
- Live production-mode flow: decide → ESCALATE → cross-route listing → approve → **real sandbox capture `62L13011L27232146`** → ledger row.

### 2.3 System testing — PASS (release build, HTTP-driven)
Run against an isolated copy of the production build (own `data/`, seeded ledger):

| Check | Result |
|---|---|
| Health + seeded ledger + chain verified | PASS |
| Mandate edit round-trip (PUT → GET → restore) | PASS |
| Bad card / oversize request rejected before any external call | PASS |
| Tamper breaks chain at exactly seq 2 → audit view reflects | PASS |
| `repair-ledger` heals chain → `/api/ledger` verified again | PASS |
| Independent auditor (`audit-ledger.ts`, no shared code): "AUDIT PASS" | PASS |
| Restart durability: kill + restart server → rows, chain, mandate persist | PASS |

### 2.4 Release testing — PASS
- `next build` clean (14/14 pages), `next start` boots, all pages 200, unknown pages/APIs 404.
- Security headers on every route (verified over HTTP): CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Fail-closed env: `PAYPAL_ENV=live` is ignored (sandbox-only, unit-tested); missing creds throw a named error.
- `npm audit`: 2 advisories (1 high, 1 moderate) — both transitive PostCSS via `next`, fixed only by next 16 (breaking). Documented; acceptable for sandbox demo.

### 2.5 Alpha testing (exploratory UI, headless Edge) — PASS (4/4)
Hub, mandate editor round-trip (edit → "Saved" → restore), decision dashboard, auditor view with seeded chain — **zero console errors, zero 4xx/5xx**.

### 2.6 Beta testing (real third parties) — PASS with caveat
- **ALLOW path, fully real:** browser submit "buy $42 of snacks from acme.com" → real OpenRouter extraction → real PayPal sandbox order+capture → panel shows `ALLOW … PayPal capture: 1JV14369EU318524H` → audit row appended, chain verified.
- **Fail-closed under vendor error (observed):** one PayPal 422 during probing → DENY row with capped reason, client got a generic message, no internals leaked. Exactly as designed.
- **Escalate path via UI: blocked by third-party flakiness** — the free LLM timed out (>90 s) on this run. The identical flow passed end-to-end earlier in production mode (integration session, capture `62L13011L27232146`), so this is an availability issue, not a code defect. **Demo-day risk: 2 of ~8 real LLM calls timed out today — budget a paid model or retry on stage.**

### 2.7 Black-box testing (52 hostile HTTP probes) — boundaries hold
- Type confusion (array/string/number/null bodies), malformed JSON, whitespace and 2,500-char requests → all 400, no crash, no stack traces.
- 11 card-boundary attacks (bad Luhn, 12/20 digits, expired, month 13, text expiry, bad CVC, name limits) → all 400 with `card.` messages before any LLM/PayPal call.
- Tamper abuse (string/float/zero/negative/huge/missing seq) → 400/404, never a silent ok.
- Approvals abuse (unknown UUID, path traversal, 10k-char id) → 400.
- Mandate abuse (missing fields, negatives, strings, zero velocity) → 400.
- Method probing → 405 on all four routes; unknown routes → 404; headers on page + API.
- No ledger pollution from rejected inputs (audit rows appear only when the pipeline actually runs).

### 2.8 White-box testing (full source review)
Every file in `src/` and `scripts/` reviewed. Orderings verified correct: validate → intent → policy → execute → audit; DENY precedes any PayPal touch; approve validates card before deleting the pending approval's only capture path; ledger hashes cover category; WAL + CHECK constraints; prepared statements throughout (no SQL injection); no card data stored anywhere.

---

## 3. Security findings

### HIGH (both pre-documented in README — demo-scoped)
1. **No authentication on mutating endpoints** — `/api/decide`, `/api/approvals/[id]/approve|reject`, `PUT /api/mandate`, `POST /api/ledger/tamper` are fully open. Anyone who can reach the port can spend, rewrite policy, or corrupt the audit demo. *Mitigation: keep localhost-only; add auth before any deployment.*
2. **CSP `script-src 'unsafe-inline' 'unsafe-eval'`** — weakens XSS defense-in-depth. Documented trade-off (Next inline RSC payloads; dev eval). *Fix: per-request nonce middleware.*

### MEDIUM (new)
3. **Ledger location depends on `process.cwd()`** (`decisions-singleton.ts`: `join(process.cwd(), "data", …)`, and `Ledger` auto-creates the directory). Starting the server from a different working directory **silently forks a second, empty audit ledger** — an integrity trap for exactly the evidence this app exists to keep. *Fix: anchor the data path to the project root (e.g. `import.meta.url`/env var) and refuse to boot if `data/` wasn't expected.*

### LOW (new)
4. **`PUT /api/mandate` accepts `__proto__` as a category key** (200). Currently harmless — the value is only read via `Object.entries` and stored in a `Map` — but it is prototype-pollution-shaped input at a trust boundary. *Fix: reject `__proto__`/`constructor` keys in `validate()`.*
5. **No upper bounds on mandate numbers** — `monthly_budget_cents: 1e15` saves fine. Garbage mandates are legal policy; deliberate, but worth a sanity cap.
6. **PayPal error bodies land in ledger `reason`** (capped at 300 chars) and are rendered in the auditor view. For a demo this is useful; for anything real it is vendor-detail leakage into a persistent record.
7. **Approve deletes the pending approval before capture** — a capture failure loses the in-memory approval (the DENY row preserves the audit trail; the operator re-runs the request). Consider deleting only after a successful capture.

### INFO
8. Velocity check-then-act race under concurrency (documented; WAL-serialized writes make it theoretical).
9. Dependency/LLM failures surface as HTTP 400 instead of 5xx (documented, cosmetic).
10. Unknown `PUT /api/mandate` fields silently ignored — a typo'd key saves as if applied (documented).
11. A client disconnect during a slow decide does not abort the server-side work — the audit row still lands (observed), but the response is lost. Fail-closed, noted for completeness.

### Positives worth keeping
Homoglyph/hallucination grounding fails closed; error whitelist blocks internals (verified: malformed JSON → generic message); Luhn gate stops garbage before money moves; LLM amounts clamped; hash chain covers the category column; sandbox fail-closed (`PAYPAL_ENV=live` ignored); tamper endpoint validates before acting.

---

## 5. Remediation (2026-10-17 — all findings addressed)

Commit `af67ccf` + `5d0cb52` ("fix: close audit findings", "fix(api): malformed JSON bodies map to 400"). Post-fix verification: 93/93 unit tests, typecheck clean, 3× stable builds, black-box 51/51, system 11/11, browser 4/4 with zero console errors.

| # | Finding | Fix | Verified by |
|---|---|---|---|
| H1 | No auth on mutating endpoints | `src/middleware.ts`: cross-site origin check (`Sec-Fetch-Site`) → 403; optional `AGENTGUARD_TOKEN` shared-secret (any mutating call must send `x-agentguard-token`) | cross-site POST → 403; curl passes through; token missing/wrong → 403, right → proceeds; GETs unaffected |
| H2 | CSP `'unsafe-inline' + 'unsafe-eval'` | Middleware-owned CSP. **Prod drops `'unsafe-eval'`** and adds `object-src 'none'`. `'unsafe-inline'` must stay: Next 15.5.27 does NOT propagate a middleware nonce to its bootstrap scripts — verified (nonce-only CSP blanks every page; nonce never appears on the emitted `<script>` tags even with a hand-set request CSP) | browser QA: all pages hydrate, 0 console errors; prod CSP has no eval |
| M3 | Ledger path = `process.cwd()` → silent second ledger | `AGENTGUARD_DATA_DIR` override in `decisions-singleton.ts` + npm run always anchors cwd to the project root | unit: env.test unaffected; documented in `.env.example` |
| L4 | `__proto__` category keys accepted | `validate()` rejects `__proto__`/`constructor`/`prototype` keys | unit test + black-box (raw-JSON PUT → 400) |
| L5 | No upper bound on mandate numbers | All mandate numbers capped at $10M (`MAX_MANDATE_CENTS`) | unit test + black-box (1e15 → 400) |
| L6 | PayPal bodies in ledger reasons | `paypal.ts`/`llm.ts` throw status-only errors; full body → `console.error` only | unit test updated (ledger row must NOT contain the body) |
| L7 | Approve consumed the approval before capture | `approve()` re-inserts the pending approval on capture failure — same id is retryable | new unit test (failed capture → still pending → retry → ALLOW, both rows audited, chain intact) |
| I10 | Unknown mandate fields silently ignored | `validate()` rejects unknown top-level fields | unit test + black-box |
| NEW | Malformed JSON regressed to 500 after the 400/500 split | `parseJson()` wrapper in `_errors.ts` → ValidationError → 400 | black-box (malformed body → 400 "request body must be valid JSON") |
| NEW | Flaky builds: `Failed to collect page data` | Lazy singletons — routes no longer open the SQLite ledger at build time; plus `AGENTGUARD_DATA_DIR` | 3 consecutive clean builds after repeated failures |
| I9 | Dependency failures as 400 | Routes: `ValidationError` → 400, everything else → 500 (generic body; ledger keeps the detail) | typecheck + suite; UI error handling unchanged |

**Deliberately NOT "fixed" (documented, accepted):**
- Velocity check-then-act race (I8) — theoretical under WAL-serialized writes; a queue/mutex is YAGNI for a single-operator demo.
- Dashboard/UI auth for the human pages — the demo UI has no accounts to protect; the token option covers scripted use.
- npm audit's 2 transitive PostCSS advisories — need next 16 (breaking major).
- CSP `'unsafe-inline'` — see H2: blocked by a verified Next 15.5.27 limitation, not forgotten. `next` 16 or a nonce-aware bootstrap is the upgrade path.

**Residual risk:** an attacker who can reach the machine's port directly (non-browser client on the LAN) can still call the mutating APIs unless `AGENTGUARD_TOKEN` is set. Keep the demo bound to localhost, or set a token.

---

## 6. Evidence artifacts
- Isolated release instance logs, screenshots (`beta-allow.png`, `beta-approved.png`, `audit-broken.png`) and probe scripts: `%LOCALAPPDATA%\Temp\agentguard-qa\` and `%LOCALAPPDATA%\hermes\cache\scratch\agentguard-release\`
- Demo ledger (real project): 10 rows, chain intentionally left broken at row 1 from the tamper demo — `npm run repair-ledger` (heal) or `npm run reset-demo` (wipe for a fresh demo).
