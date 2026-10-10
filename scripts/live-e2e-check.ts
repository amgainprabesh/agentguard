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
// score comes from the live LLM — assert the split matches whatever it returned,
// not a hardcoded number
const expected = Math.round((10000 * settled.score!) / 100);
if (settled.capture_cents !== expected) {
  throw new Error(`capture split wrong for score ${settled.score}: got ${settled.capture_cents}, want ${expected}`);
}
console.log("PASS: sprint 1 vertical slice green against live sandbox");
