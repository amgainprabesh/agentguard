import { DecisionService } from "./decisions.ts";
import { Ledger } from "./ledger.ts";
import { join } from "node:path";

// one shared instance so all routes see the same pending approvals
// shortcut: demo mandate is hardcoded; Sprint 3 reads it from stored config
export const DEMO_MANDATE = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};

export const decisions = new DecisionService(
  new Ledger(join(process.cwd(), "data", "agentguard.db")),
  DEMO_MANDATE,
);
