# Sprint 0 — AgentGuard Scaffold (Foundation Sprint)

> **⚠️ UPDATE (Oct 10 2026):** Repo renamed — GitHub repo is now `amgainprabesh/agentguard`, local folder `Hbuild/paypal-hackathon/agentguard` (was `paygrade-quality-escrow`). LLM provider shipped as **OpenRouter** (D7 below reflects this; earlier OmniRoute references in this document are superseded). All Sprint 0 and Sprint 1 work is complete and live-verified.


> **Product:** AgentGuard — spend-policy control plane for AI purchasing agents (PayPal AI Hackathon, Devpost 31302, deadline Nov 13 2026 03:45 NPT).
> **This sprint:** scaffold the repo, lock the architecture, get a real PayPal sandbox order created through the backend. **No product logic yet.**
> **Why so much emphasis on "get it right":** everything later (mandate editor, rule engine, auditor, chain verification) sits on this skeleton. A wrong choice here is expensive to undo, so the plan names exact stacks, exact paths, exact code.

---

## 1. Goal

Scaffold AgentGuard as a Next.js (App Router) monorepo with a Node runtime, SQLite ledger foundation, OmniRoute-backed LLM client, and a proven PayPal sandbox auth + order-creation path — so Sprint 1 can write policy code with zero infrastructure decisions left open.

---

## 2. Decisions locked in this sprint (the "small wrong decision" guards)

These are decided. Do not revisit in later sprints without a new plan.

| # | Decision | Choice | Why (one line) |
|---|---|---|---|
| D1 | Product | **AgentGuard** (WINNER-BRIEF.md, rank 96) over PayGrade | It is the winner; policy-on-the-payment-path is the story. (PayGrade's repo + agile plan stay in git history — the repo name `paygrade-quality-escrow` is cosmetic and renamed in a later sprint, see Risk R3) |
| D2 | Repo | `C:\Users\prabe\OneDrive\Documents\Hbuild\paypal-hackathon\paygrade-quality-escrow` (existing git repo, one commit, remote `amgainprabesh/paygrade-quality-escrow`) | Keep the remote that judges will see |
| D3 | Language | **TypeScript everywhere** (Node 26.7.0, npm 11.19.0) | One language front+back; types make the ledger + rule engine safe |
| D4 | Backend | **Next.js API routes** (`/app/api/*/route.ts`) — no separate Express server | One deploy target, one process, Render free tier friendly; route handlers are plain `Request -> Response` functions so logic stays testable |
| D5 | Frontend | **Next.js App Router + React Server Components, Tailwind CSS v4, minimal static design system** | Zero-build mental overhead; RSC means the dashboard ships almost no client JS |
| D6 | Storage | **`node:sqlite` DatabaseSync, file `data/agentguard.db`** | Node 26 has it built-in (`node:sqlite` verified working on this machine); no native deps, no ORM, no container pain |
| D7 | LLM | **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`), key in `OPENROUTER_API_KEY`, model `nvidia/nemotron-3-ultra-550b-a55b:free` | Verified working with real API call (Oct 10 2026). The first key the user provided was a *management* key (401 "User not found" on chat) — must be a regular API key. OmniRoute local gateway was the fallback but `auto` and `oc/*` fail |
| D8 | Money | **Integer minor units everywhere** (`amount_cents: number`), USD | Cents, never floats; partial-capture arithmetic stays exact |
| D9 | Tests | **`node:test` + `assert/strict`, TypeScript directly via `node --test`** (Node 26 runs `.ts`), no jest/vitest | Zero test deps; verified working on this machine |
| D10 | Env | `.env.local` (git-ignored) + `.env.example` (committed) | Secrets never enter git |

**Stack summary (one line):** Next.js 15 App Router + TS + Tailwind v4 + node:sqlite + node:test + OpenRouter, all in one package at the repo root.

---

## 2.5 Live verification results (Sprint 0, Oct 10 2026)

Executed against the real PayPal sandbox and real OpenRouter — not mocks:

| Check | Result |
|---|---|
| `npm test` | 4 pass, 0 fail |
| `npm run typecheck` | clean (exit 0) |
| Dev server `/` + `/api/health` | both HTTP 200 |
| OpenRouter LLM live call | real `OK` response from `nvidia/nemotron-3-ultra-550b-a55b:free` |
| PayPal token exchange | OK, expires_in 32400 (9h) |
| PayPal live order (through app's `createOrder()`) | id `7SD20871L0444292G`, status `CREATED`, intent `AUTHORIZE` |

**Two PayPal API quirks confirmed live (matter for Sprint 1):**
1. The `create` response omits `intent` in its JSON body — `GET /v2/checkout/orders/{id}` returns `intent: AUTHORIZE` correctly. Don't assert on `intent` from the create response.
2. The create response includes HATEOAS links: `authorize` (POST) and `update` (PATCH). Sprint 1 should follow those hrefs instead of hardcoding paths.

**Live check command:** `npm run live-check:paypal` (runs `scripts/live-paypal-check.ts` through the app's own client — needs `.env.local` with real creds).

---

## 3. Architecture (as far as Sprint 0 builds it)

```
Browser (React Server Components + minimal CSS)
  │
  ▼
Next.js App Router
  ├── app/page.tsx                    → demo landing: three buttons (ALLOW / DENY / ESCALATE mocked in Sprint 0)
  ├── app/api/paypal/order/route.ts   → POST: OAuth2 → create AUTHORIZE order (Sprint 0's real deliverable)
  └── app/api/health/route.ts         → GET: { ok: true, sqlite: "up", paypal_env: "sandbox" }
  │
  ├── src/lib/paypal.ts               → token cache + typed Orders v2 client (create/authorize/capture/void)
  ├── src/lib/ledger.ts               → node:sqlite open + hash-chained append (schema only in Sprint 0)
  ├── src/lib/llm.ts                  → OmniRoute client (wired but unused until Sprint 2)
  └── src/lib/env.ts                  → one typed env loader, the single source of truth
```

The **full** target (Sprint 1+; do NOT build now): policy engine, mandate editor UI, escalation approvals, auditor chain view. Sprint 0 stops at the dashed line.

---

## 4. Step-by-step tasks

Work top to bottom. Every task is small, names its files, and has a verification command with the expected output. Commit after every task. Run all commands from the repo root:
`C:\Users\prabe\OneDrive\Documents\Hbuild\paypal-hackathon\paygrade-quality-escrow`

> **Path note for the machine:** in terminal, `cd "C:/Users/prabe/OneDrive/Documents/Hbuild/paypal-hackathon/paygrade-quality-escrow"` — forward slashes, quoted (OneDrive space-free but `Hbuild` has no spaces; quote anyway, OneDrive syncs files mid-read).

---

### Task 0.1 — Lock versions + scaffold package

**Files created:** `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`

Write `package.json`:

```json
{
  "name": "agentguard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "node --test 'src/**/*.test.ts' 'app/**/*.test.ts'",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "15.4.6",
    "react": "19.1.1",
    "react-dom": "19.1.1"
  },
  "devDependencies": {
    "@types/node": "24.9.2",
    "@types/react": "19.1.9",
    "@types/react-dom": "19.1.7",
    "typescript": "5.9.3",
    "tailwindcss": "4.1.13",
    "@tailwindcss/postcss": "4.1.13"
  }
}
```

Write `tsconfig.json` (Next.js standard, `strict: true` — non-negotiable, it is the reason D3 exists):

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Write `next.config.ts`:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // hackathon scale; keeps one process on Render free tier
  serverExternalPackages: [],
};
export default nextConfig;
```

Write `.gitignore` (append — README/LICENSE already tracked):

```
node_modules/
.next/
out/
.env*.local
.env
data/
*.db
*.db-shm
*.db-wal
.DS_Store
```

**Verify:**

```bash
npm install
npm run typecheck    # expected: no output, exit 0 (no .ts files yet is fine)
```

**Commit:** `git add -A && git commit -m "chore: scaffold next+ts+tailwind, lock versions"`

---

### Task 0.2 — Tailwind v4 + global CSS + app shell

Tailwind v4 has no `tailwind.config.js`; it is configured entirely in CSS + the PostCSS plugin.

**Files created:** `postcss.config.mjs`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`

Write `postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Write `src/app/globals.css` (this is the *only* design-system file; Sprint 1+ pages extend it, never re-invent it):

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", system-ui, sans-serif;
  --color-allow: oklch(0.72 0.17 152);
  --color-deny: oklch(0.65 0.2 25);
  --color-escalate: oklch(0.78 0.15 85);
}

html, body { @apply bg-neutral-950 text-neutral-100 font-sans antialiased; }
```

Write `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentGuard",
  description: "Spend policy control plane for AI purchasing agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
```

Write `src/app/page.tsx` (the landing page — keep it; Sprint 1 replaces the body, not the frame):

```tsx
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">AgentGuard</h1>
        <p className="mt-2 text-neutral-400">
          Spend policy control plane for AI purchasing agents. Policy is code, not prompt.
        </p>
      </div>
      <div className="flex gap-3">
        {["ALLOW", "DENY", "ESCALATE"].map((label) => (
          <button
            key={label}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-800"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">Sprint 0 skeleton — decisions wired in Sprint 1.</p>
    </main>
  );
}
```

**Verify:**

```bash
npm run dev
```

Then in a second terminal:
```bash
curl -s http://localhost:3000 | grep -o "AgentGuard" | head -1
# expected: AgentGuard
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
# expected: 200
```

Kill dev server after (Ctrl+C in that terminal, or `taskkill //PID <pid> //F` from the other).

**Commit:** `git add -A && git commit -m "feat: app shell, tailwind v4, landing page"`

---

### Task 0.3 — Typed env loader (single source of truth)

**File created:** `src/lib/env.ts`

```ts
// Shortcut: reads process.env lazily per call; no dotenv file loading in dev
// (Next.js auto-loads .env.local). Upgrade to zod validation when env vars exceed ~10.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} — copy .env.example to .env.local`);
  return v;
}

export const env = {
  paypalClientId: () => required("PAYPAL_CLIENT_ID"),
  paypalSecret: () => required("PAYPAL_SECRET"),
  paypalEnv: () => (process.env.PAYPAL_ENV === "live" ? "live" : "sandbox"),
  paypalBaseUrl: () =>
    env.paypalEnv() === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com",
  omnirouteBaseUrl: () => process.env.OMNIROUTE_BASE_URL ?? "http://localhost:20128/v1",
  omnirouteModel: () => process.env.OMNIROUTE_MODEL ?? "ddgw/gpt-5.4-nano",
};
```

**Verify:** covered by Task 0.4's typecheck (it is imported there).

---

### Task 0.4 — Ledger foundation: SQLite schema + hash chain (test-first)

This is the heart of Sprint 0's *architecture*. Test first.

**Files created:** `src/lib/ledger.ts`, `src/lib/ledger.test.ts`

Write the test `src/lib/ledger.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "./ledger.ts";

test("first record has genesis hash and chains forward", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const l = new Ledger(join(dir, "t.db"));
  const a = l.append({ action: "ALLOW", amount_cents: 4200, reason: "within budget" });
  assert.equal(a.prev_hash, "GENESIS");
  assert.ok(/^[0-9a-f]{64}$/.test(a.hash), "hash is sha256 hex");
  const b = l.append({ action: "DENY", amount_cents: 31000, reason: "budget breach" });
  assert.equal(b.prev_hash, a.hash, "second record chains to first");
  const rows = l.all();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].hash, b.hash);
  rmSync(dir, { recursive: true, force: true });
});

test("verifyChain detects a tampered row", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const l = new Ledger(join(dir, "t.db"));
  l.append({ action: "ALLOW", amount_cents: 100, reason: "ok" });
  l.append({ action: "ALLOW", amount_cents: 200, reason: "ok" });
  assert.deepEqual(l.verifyChain(), { ok: true, brokenAt: null });
  // tamper: rewrite row 1's payload without updating its hash
  l.db.exec(`UPDATE ledger SET amount_cents = 99999 WHERE seq = 1`);
  const res = l.verifyChain();
  assert.equal(res.ok, false, "chain must report broken");
  assert.equal(res.brokenAt, 1, "broken link identified at seq 1");
  rmSync(dir, { recursive: true, force: true });
});
```

Write the implementation `src/lib/ledger.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export type Decision = "ALLOW" | "DENY" | "ESCALATE";

export interface LedgerRecord {
  seq: number;
  action: Decision;
  amount_cents: number;
  reason: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL CHECK (action IN ('ALLOW','DENY','ESCALATE')),
        amount_cents INTEGER NOT NULL,
        reason TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private hashOf(rec: { action: Decision; amount_cents: number; reason: string; prev_hash: string }): string {
    return createHash("sha256")
      .update(JSON.stringify([rec.action, rec.amount_cents, rec.reason, rec.prev_hash]))
      .digest("hex");
  }

  append(input: { action: Decision; amount_cents: number; reason: string }): LedgerRecord {
    const prev = this.db.prepare("SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev_hash = prev?.hash ?? "GENESIS";
    const hash = this.hashOf({ ...input, prev_hash });
    const created_at = new Date().toISOString();
    this.db
      .prepare("INSERT INTO ledger (action, amount_cents, reason, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?)")
      .run(input.action, input.amount_cents, input.reason, prev_hash, hash, created_at);
    const seq = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
    return { seq, ...input, prev_hash, hash, created_at };
  }

  all(): LedgerRecord[] {
    return this.db.prepare("SELECT * FROM ledger ORDER BY seq").all() as LedgerRecord[];
  }

  verifyChain(): { ok: boolean; brokenAt: number | null } {
    const rows = this.all();
    let prev_hash = "GENESIS";
    for (const r of rows) {
      if (r.prev_hash !== prev_hash || r.hash !== this.hashOf(r)) {
        return { ok: false, brokenAt: r.seq };
      }
      prev_hash = r.hash;
    }
    return { ok: true, brokenAt: null };
  }
}
```

**Verify (RED then GREEN):**

```bash
# RED first — comment out nothing, just run; the impl is complete so it passes.
npm test -- src/lib/ledger.test.ts
```

> Because the implementation ships in the same task, the RED step is implicit; for honesty, run `git stash src/lib/ledger.ts && npm test -- src/lib/ledger.test.ts` (expected: `fail 2`, ERR_MODULE_NOT_FOUND), then `git stash pop` and re-run (expected: `pass 2`).

```bash
npm test -- src/lib/ledger.test.ts
# expected tail: "pass 2" / "fail 0"
```

**Commit:** `git add -A && git commit -m "feat(ledger): sqlite hash-chained append + tamper verification (node:sqlite)"`

---

### Task 0.5 — PayPal client (OAuth2 token cache + Orders v2 create) — test-first against the mock

**Files created:** `src/lib/paypal.ts`, `src/lib/paypal.test.ts`

Test first `src/lib/paypal.test.ts` (mocks `fetch`, so it runs with no credentials):

```ts
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// env must be set before importing the module under test
process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_SECRET = "test-secret";

const { createOrder } = await import("./paypal.ts");

test("createOrder posts to Orders v2 and returns the order id", async () => {
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    calls.push(String(url));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (String(url).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    assert.equal(String(url), "https://api-m.sandbox.paypal.com/v2/checkout/orders");
    assert.equal(body.intent, "AUTHORIZE", "escrow must authorize, not capture");
    assert.equal(body.purchase_units[0].amount.value, "42.00");
    return new Response(JSON.stringify({ id: "ORDER123", status: "CREATED" }), {
      status: 201, headers: { "content-type": "application/json" },
    });
  });

  const order = await createOrder({ amount_cents: 4200, currency: "USD" });
  assert.equal(order.id, "ORDER123");
  assert.equal(calls.length, 2, "token fetch then order create");
  mock.reset();
});

test("token is cached across calls", async () => {
  let tokenCalls = 0;
  mock.method(globalThis, "fetch", async (url: any, init: any = {}) => {
    if (String(url).endsWith("/v1/oauth2/token")) {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: "O" + tokenCalls, status: "CREATED" }), { status: 201, headers: { "content-type": "application/json" } });
  });
  await createOrder({ amount_cents: 100 });
  await createOrder({ amount_cents: 200 });
  assert.equal(tokenCalls, 1, "second call reuses cached token");
  mock.reset();
});
```

Implementation `src/lib/paypal.ts`:

```ts
import { env } from "./env.ts";

interface Token { value: string; expires_at: number }
let token: Token | null = null;

async function getToken(): Promise<string> {
  if (token && token.expires_at > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${env.paypalClientId()}:${env.paypalSecret()}`).toString("base64");
  const res = await fetch(`${env.paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export async function createOrder(input: { amount_cents: number; currency?: string }): Promise<{ id: string; status: string }> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      intent: "AUTHORIZE", // funds held, not taken — the whole escrow thesis
      purchase_units: [
        {
          amount: {
            currency_code: input.currency ?? "USD",
            value: (input.amount_cents / 100).toFixed(2),
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PayPal createOrder failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; status: string };
}
```

**Verify:**

```bash
npm test -- src/lib/paypal.test.ts
# expected: "pass 2"
npm run typecheck   # expected: silent, exit 0
```

**Commit:** `git add -A && git commit -m "feat(paypal): oauth token cache + AUTHORIZE order create (tested with mocked fetch)"`

---

### Task 0.6 — OmniRoute LLM client (wired, unused) — smoke test only

**File created:** `src/lib/llm.ts`

```ts
import { env } from "./env.ts";

// Wired now, consumed in Sprint 2 (the grader / intent extraction). Grader must be
// deterministic: temperature 0 + strict JSON is enforced at call sites.
export async function chat(messages: { role: "system" | "user"; content: string }[]): Promise<string> {
  const res = await fetch(`${env.omnirouteBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: env.omnirouteModel(), messages, temperature: 0, max_tokens: 1024 }),
  });
  if (!res.ok) throw new Error(`LLM failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}
```

**Verify (real call through OmniRoute — this proves D7 works):**

```bash
# gateway must be running: omniroute serve --daemon (started earlier this session; if port 20128 is dead, re-run it)
curl -s -m 90 -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"ddgw/gpt-5.4-nano","messages":[{"role":"user","content":"Reply with the single word OK"}],"max_tokens":8}'
# expected: a JSON body whose choices[0].message.content is "OK"
```

**Commit:** `git add -A && git commit -m "feat(llm): omniroute chat client (temperature 0, strict)"`

---

### Task 0.7 — Env example + data dir + run the whole stack once

**Files created:** `.env.example`, `data/.gitkeep` (data/ is git-ignored, the .gitkeep keeps the folder), update `.gitignore` already covers `*.db`.

Write `.env.example` (commit this; it is the setup guide for judges):

```
# PayPal sandbox app — create at https://developer.paypal.com/dashboard/applications/sandbox
# "Create App" -> copy Client ID / Secret below. Do NOT use a live app.
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_SECRET=your-sandbox-secret
PAYPAL_ENV=sandbox

# LLM gateway (local). Default model verified working Oct 10 2026.
OMNIROUTE_BASE_URL=http://localhost:20128/v1
OMNIROUTE_MODEL=ddgw/gpt-5.4-nano
```

**Verify (end-to-end from a cold start):**

```bash
# 1. cold start
rm -rf .next node_modules/.cache
# 2. typecheck + tests green
npm run typecheck && npm test
# expected: typecheck silent; tests show "pass 4" (2 ledger + 2 paypal)
# 3. dev server boots and serves
npm run dev &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000   # expected: 200
```

**Commit:** `git add -A && git commit -m "chore: env.example, sprint0 verification"`

---

### Task 0.8 — README: the judges' setup path

**File updated:** `README.md` (replace body)

```md
# AgentGuard

Spend-policy control plane for AI purchasing agents. Policy is code, not prompt.

## Run it (2 minutes)

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in PayPal sandbox credentials
   (create a sandbox app at https://developer.paypal.com/dashboard/applications/sandbox → Create App).
3. (Optional, for the LLM features) start the local gateway: `omniroute serve --daemon`
4. `npm run dev` → http://localhost:3000
5. `npm test` for the test suite.

## Status

Sprint 0 complete: scaffold, ledger, PayPal client, LLM client. Policy engine lands in Sprint 1.
```

**Verify:** `curl -s https://api.github.com/repos/amgainprabesh/paygrade-quality-escrow` is NOT needed; just confirm README renders: `head -5 README.md`.

**Commit:** `git add -A && git commit -m "docs: judge setup instructions"`

---

## 5. Tests / validation summary

| Task | Test | Command | Expected |
|---|---|---|---|
| 0.4 | ledger append + chain + tamper detection | `npm test -- src/lib/ledger.test.ts` | `pass 2`, `fail 0` |
| 0.5 | paypal createOrder intent/amount/caching (mocked) | `npm test -- src/lib/paypal.test.ts` | `pass 2` |
| 0.6 | OmniRoute reachable | `curl …/v1/chat/completions -d '{"model":"ddgw/gpt-5.4-nano",…}'` | `choices[0].message.content` contains `OK` |
| 0.7 | cold typecheck + full suite + page 200 | `npm run typecheck && npm test` then `curl localhost:3000` | silent typecheck; `pass 4`; `200` |

Definition of done for Sprint 0: all four rows green, 6+ commits, `.env.example` committed, `data/` ignored, `npm run dev` serves a page.

---

## 6. How to get PayPal sandbox credentials (you asked)

You do not have them yet — Sprint 0 needs them for Task 0.7's live check (everything before that runs on mocks).

1. Go to **https://developer.paypal.com/dashboard/applications/sandbox** and log in (or sign up) with your PayPal account.
2. Toggle to **Sandbox** (top-left environment switch), then **Create App** — name it `agentguard`, app type **Merchant** (default), sandbox business account auto-created is fine.
3. On the app page, copy **Client ID** and **Secret** (Secret appears once — copy it immediately).
4. Paste them into `.env.local` as `PAYPAL_CLIENT_ID=…` / `PAYPAL_SECRET=…`.

Optional but useful: **Sandbox → Accounts** also lists a fake *business* and *personal* account for buyer flows later (Sprint 3 demos). Nothing else is needed today.

---

## 7. Risks, tradeoffs, open questions

| # | Risk | Impact | Mitigation / call |
|---|---|---|---|
| R1 | **PayPal partial capture/void semantics** — whether authorize → partial capture → void-rest works cleanly in sandbox | Core thesis of PayGrade; for AgentGuard the flow is full capture + hash chain, so this risk is **deferred out of AgentGuard** | AgentGuard captures fully or voids fully; no partial capture. If Sprint 1 needs refunds, `POST /v2/payments/captures/{id}/refund` is the fallback (decide in Sprint 1, not now) |
| R2 | **Next.js on Render free tier** — cold starts, 512MB RAM, build minutes | Demo video could stall | Build takes ~1 min here; free tier fine for a demo. Hosting is a Sprint 4 concern, not Sprint 0 |
| R3 | **Repo name `paygrade-quality-escrow` vs product `AgentGuard`** | Judges see the repo name; a mismatch looks sloppy | Sprint 1: `git remote set-url` is not needed — create the *new* repo `agentguard` and `git remote rename origin paygrade-old` + `git remote add origin …` per the github-repo-management skill. Or keep name and make README unambiguous. **Decide in Sprint 1** — not now, do not lose the remote |
| R4 | **OmniRoute model churn** — `ddgw/*` web-scraper providers can break any day (IP limits, upstream changes) | Grader goes down mid-demo | Grader caches its result per deal + stores the raw response in the ledger; Sprint 2 adds a retry with a second `ddgw/*` model from the log's ROUTING lines. Never `auto` (currently 400s) |
| R5 | **Hash chain proves tampering, not deletion** | Overclaiming in the demo video loses credibility | The auditor UI says exactly this. Sprint 3 wording: "tamper-evident, not tamper-proof" |
| R6 | **Sprint 0 has no product logic** — feels slow | None; this is deliberate | Every later sprint only writes features against a frozen scaffold |

**Open questions (answer in Sprint 1, not now):** rule-engine DSL shape (YAML vs TS), escalation approval mechanism (in-app tap vs email), deployment target.

---

## 8. What this plan deliberately does NOT do (ponytail)

- **No Vault/payment-token wallet, no webhook receiver, no mandate editor, no auditor UI** — Sprint 1+ scope; YAGNI until the scaffold proves itself.
- **No jest/vitest/zod/eslint/prettier** — `node:test` + `tsc --noEmit` cover correctness; add only when a failure mode demands it.
- **No Docker/CI/deploy** — Render deploys from `git push` in Sprint 4; premature.
- **No PayGrade code** — the repo history keeps it; WINNER-BRIEF scores AgentGuard 96 vs 91. Rename/relocation is R3.

**Unverified / skipped:** I did not create sandbox credentials (needs your PayPal login — §6), did not run `next build` (dev-only is fine for this sprint; `next build` is a Sprint 4 gate), and did not probe a live PayPal token (needs your creds). Risk you must own: **R4** (OmniRoute free providers can die mid-hackathon) and **R3** (repo-name mismatch is visible to judges until Sprint 1 fixes it).
