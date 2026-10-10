# Graph Report - agentguard  (2026-10-10)

## Corpus Check
- 32 files · ~18,257 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .example 1, .css 1)

## Summary
- 209 nodes · 277 edges · 15 communities (12 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a4dfaa42`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- DecisionService
- package.json
- decisions-singleton.ts
- compilerOptions
- Sprint 0 — AgentGuard Scaffold (Foundation Sprint)
- decisions.ts
- Sprint 1 — AgentGuard: Money Spine + First Vertical Slice
- paypal.ts
- decisions.test.ts
- PayGrade Implementation Plan
- intent.ts
- scripts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `DecisionService` - 13 edges
3. `Ledger` - 12 edges
4. `Sprint 0 — AgentGuard Scaffold (Foundation Sprint)` - 10 edges
5. `4. Step-by-step tasks` - 9 edges
6. `next` - 8 edges
7. `Sprint 1 — AgentGuard: Money Spine + First Vertical Slice` - 8 edges
8. `Sprint 2 — AgentGuard: Policy Engine + Decision Spine` - 8 edges
9. `scripts` - 7 edges
10. `PayGrade Implementation Plan` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Task 2.4 — API routes (thin, shared singleton)` --references--> `DecisionService`  [INFERRED]
  .hermes/plans/2026-10-10_132000-sprint2-policy-engine.md → src/lib/decisions.ts
- `2. What already exists (reuse, do not rebuild)` --references--> `createOrderWithCard()`  [INFERRED]
  .hermes/plans/2026-10-10_132000-sprint2-policy-engine.md → src/lib/paypal.ts
- `2. What already exists (reuse, do not rebuild)` --references--> `capturePartial()`  [INFERRED]
  .hermes/plans/2026-10-10_132000-sprint2-policy-engine.md → src/lib/paypal.ts
- `DecisionResult` --references--> `SpendIntent`  [EXTRACTED]
  src/lib/decisions.ts → src/lib/policy.ts
- `PendingApproval` --references--> `SpendIntent`  [EXTRACTED]
  src/lib/decisions.ts → src/lib/policy.ts

## Import Cycles
- None detected.

## Communities (15 total, 3 thin omitted)

### Community 0 - "DecisionService"
Cohesion: 0.10
Nodes (16): 4. Step-by-step tasks, Task 2.1 — Rule engine (test first; pure function, no I/O, no LLM), Task 2.2 — Intent extractor (test first; LLM → structured intent), Task 2.3 — Decision service: decide → execute/escalate/deny, ledger-append (test first), Task 2.4 — API routes (thin, shared singleton), Task 2.5 — Live check: the sprint's acceptance test, Task 2.6 — Delete the Sprint 1 escrow stack (ONLY after 2.5 is green), AgentGuard (+8 more)

### Community 1 - "package.json"
Cohesion: 0.08
Nodes (23): dependencies, next, react, react-dom, devDependencies, tailwindcss, @tailwindcss/postcss, @types/node (+15 more)

### Community 2 - "decisions-singleton.ts"
Cohesion: 0.12
Nodes (9): nextConfig, next, card, chain, ledger, svc, metadata, decisions (+1 more)

### Community 3 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+11 more)

### Community 4 - "Sprint 0 — AgentGuard Scaffold (Foundation Sprint)"
Cohesion: 0.11
Nodes (18): 1. Goal, 2.5 Live verification results (Sprint 0, Oct 10 2026), 2. Decisions locked in this sprint (the "small wrong decision" guards), 3. Architecture (as far as Sprint 0 builds it), 4. Step-by-step tasks, 5. Tests / validation summary, 6. How to get PayPal sandbox credentials (you asked), 7. Risks, tradeoffs, open questions (+10 more)

### Community 5 - "decisions.ts"
Cohesion: 0.18
Nodes (10): CardInput, DecisionResult, PendingApproval, Decision, LedgerRecord, evaluate(), MonthContext, PolicyResult (+2 more)

### Community 6 - "Sprint 1 — AgentGuard: Money Spine + First Vertical Slice"
Cohesion: 0.13
Nodes (14): 1. Goal, 2. What Sprint 0 already proved (do not re-litigate), 3. Architecture (Sprint 1 scope), 4. Step-by-step tasks, 5. Tests / validation summary, 6. Risks, tradeoffs, open questions, 7. Ponytail: what this plan deliberately does NOT do, Sprint 1 — AgentGuard: Money Spine + First Vertical Slice (+6 more)

### Community 7 - "paypal.ts"
Cohesion: 0.18
Nodes (11): 1. Goal, 2. What already exists (reuse, do not rebuild), 3. Architecture (Sprint 2 scope), 5. Tests / validation summary, 6. Risks, tradeoffs, open questions, 7. Ponytail: what this plan deliberately does NOT do, Sprint 2 — AgentGuard: Policy Engine + Decision Spine, capturePartial() (+3 more)

### Community 8 - "decisions.test.ts"
Cohesion: 0.21
Nodes (3): card, intentOk, mandate

### Community 9 - "PayGrade Implementation Plan"
Cohesion: 0.18
Nodes (10): Architecture, Grader, Open questions, PayGrade Implementation Plan, PayPal mapping, Risks, Sprint 0 detail (today/tomorrow), Sprint 1 detail (+2 more)

### Community 10 - "intent.ts"
Cohesion: 0.27
Nodes (4): env, extractIntent(), extractJson(), chat()

### Community 11 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, live-decisions, start, test, typecheck

## Knowledge Gaps
- **8 isolated node(s):** `react`, `react-dom`, `@types/node`, `@types/react`, `@types/react-dom` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 135 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `decisions-singleton.ts` to `package.json`, `intent.ts`?**
  _High betweenness centrality (0.189) - this node is a cross-community bridge._
- **What connects `react`, `react-dom`, `@types/node` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `DecisionService` be split into smaller, more focused modules?**
  _Cohesion score 0.09852216748768473 - nodes in this community are weakly interconnected._
- **Why does `Ledger` connect `DecisionService` to `decisions.test.ts`, `decisions-singleton.ts`, `decisions.ts`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Why does `DecisionService` connect `DecisionService` to `decisions-singleton.ts`, `decisions.ts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Should `decisions-singleton.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11857707509881422 - nodes in this community are weakly interconnected._