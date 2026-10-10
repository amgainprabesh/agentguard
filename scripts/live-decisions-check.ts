// Sprint 2 acceptance: the full policy path against the LIVE sandbox.
// Run: npm run live-decisions
import { DecisionService } from "../src/lib/decisions.ts";
import { Ledger } from "../src/lib/ledger.ts";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};
const svc = new DecisionService(ledger, mandate);
const card = {
  number: process.env.TEST_CARD_NUMBER ?? "4111111111111111",
  expiry: "2028-12",
  security_code: "123",
  name: "Test Buyer",
};

// 1. DENY — vendor not on the list; PayPal never touched
const denied = await svc.decide("buy $42 of snacks from evil.com", card);
console.log("1. DENY:", denied.decision, "|", denied.reasons[0]);
if (denied.decision !== "DENY" || denied.capture_id) throw new Error("DENY path wrong");

// 2. ALLOW — approved vendor, under threshold; real capture
const allowed = await svc.decide("buy $42 of snacks from acme.com", card);
console.log("2. ALLOW:", allowed.decision, "| capture:", allowed.capture_id);
if (allowed.decision !== "ALLOW" || !allowed.capture_id) throw new Error("ALLOW path wrong");

// 3. ESCALATE — over threshold, parked
const escalated = await svc.decide("buy $500 of snacks from acme.com", card);
console.log("3. ESCALATE:", escalated.decision, "| approval:", escalated.approval_id);
if (escalated.decision !== "ESCALATE" || !escalated.approval_id) throw new Error("ESCALATE path wrong");

// 4. approve the escalation — real capture
const approved = await svc.approve(escalated.approval_id!, card);
console.log("4. approved → capture:", approved.capture_id);
if (!approved.capture_id) throw new Error("approve path wrong");

// 5. hash chain must verify across every row above
const chain = ledger.verifyChain();
console.log("5. chain:", chain.ok ? "VERIFIED" : `BROKEN at ${chain.brokenAt}`);
if (!chain.ok) throw new Error("ledger chain broken");
console.log("   ledger rows:", ledger.all().length);

console.log("PASS: sprint 2 policy spine green against live sandbox");
