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

## Status

Sprints 0–2 complete: hash-chained audit ledger, policy engine (six rules: budget, per-txn cap, vendor allowlist, category limits, velocity, approval threshold), intent extraction, ALLOW/DENY/ESCALATE decisions — live-verified against the PayPal sandbox. Sprint 3 adds the mandate editor UI, decision dashboard, and auditor chain view.
