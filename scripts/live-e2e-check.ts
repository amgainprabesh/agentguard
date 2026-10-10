// Sprint 1 acceptance: one full escrow against the LIVE sandbox through the Escrow service.
// Run: npm run live-e2e
import { Escrow } from "../src/lib/escrow.ts";
import { Ledger } from "../src/lib/ledger.ts";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

const deal = await escrow.createDeal({
  amount_cents: 10000,
  card: {
    number: process.env.TEST_CARD_NUMBER ?? "4111111111111111",
    expiry: "2028-12",
    security_code: "123",
    name: "Test Buyer",
  },
  rubric: [{ criterion: "quality", weight: 1 }],
});
console.log("1. created + authorized:", deal.id, deal.auth_id);

await escrow.deliver(deal.id, "Here is the delivered work.");
console.log("2. delivered");

const settled = await escrow.settle(deal.id);
console.log("3. settled:", JSON.stringify(settled));

// money invariant, asserted against real API results
if (settled.capture_cents + settled.void_cents !== 10000) {
  throw new Error("MONEY INVARIANT VIOLATED");
}
if (settled.capture_cents !== 7500) {
  throw new Error(`expected 7500 captured at score 75, got ${settled.capture_cents}`);
}
console.log("PASS: sprint 1 vertical slice green against live sandbox");
