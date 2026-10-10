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

Sprint 0 complete: scaffold, ledger, PayPal client, LLM client. Policy engine lands in Sprint 1.
