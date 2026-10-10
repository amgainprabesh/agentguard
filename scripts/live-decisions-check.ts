// Sprint 2 acceptance: the full policy path against the LIVE sandbox.
// Run: npm run live-decisions
import { DecisionService } from "../src/lib/decisions.ts";
import { DEFAULT_MANDATE } from "../src/lib/mandate.ts";
import { Ledger } from "../src/lib/ledger.ts";
import { join } from "node:path";

// scratch DB by default so rehearsal runs don't pollute the demo ledger
const ledger = new Ledger(join(process.cwd(), "data", process.env.LIVE_CHECK_DB ?? "live-check.db"));
const svc = new DecisionService(ledger, DEFAULT_MANDATE);
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

// 3. ESCALATE — over threshold, parked. Fresh mandate so step 2's capture
// (aggregated this month) doesn't cascade into a budget/category DENY here.
const wideMandate = {
  ...DEFAULT_MANDATE,
  monthly_budget_cents: 1_000_000,
  category_limits_cents: {},
};
svc.setMandate(wideMandate);
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
