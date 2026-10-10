// Seeds the DEMO ledger with a realistic history so the audit view has content
// instantly — the video then needs only ONE live decide (~20-40s on the free LLM)
// instead of four. Every seeded row is a REAL hash-chained row; the demo just
// doesn't wait for the LLM to produce it.
// Run: npm run seed-demo
import { Ledger } from "../src/lib/ledger.ts";
import { join } from "node:path";

const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));

const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const seeds = [
  { minutesAgo: 180, action: "ALLOW" as const, amount_cents: 4200, category: "snacks",
    reason: "allowed acme.com snacks $42.00, capture DEMO-SEED-ALLOW-1" },
  { minutesAgo: 150, action: "DENY" as const, amount_cents: 31000, category: "snacks",
    reason: "denied acme.com snacks: amount $310.00 exceeds the per-transaction cap of $1000.00" },
  { minutesAgo: 120, action: "DENY" as const, amount_cents: 4200, category: "snacks",
    reason: "denied evil.com snacks: vendor evil.com is not on the approved list" },
  { minutesAgo: 90, action: "ESCALATE" as const, amount_cents: 50000, category: "ads",
    reason: "escalated acme.com ads $500.00: amount $500.00 meets the approval threshold of $500.00 (approval DEMO-SEED-ESC-1)" },
  { minutesAgo: 80, action: "ALLOW" as const, amount_cents: 50000, category: "ads",
    reason: "approved acme.com ads $500.00, capture DEMO-SEED-ALLOW-2" },
];

for (const s of seeds) {
  // backdate the row: append() stamps created_at, so patch it after insert
  const rec = ledger.append({ action: s.action, amount_cents: s.amount_cents, category: s.category, reason: s.reason });
  ledger.db.prepare("UPDATE ledger SET created_at = ? WHERE seq = ?").run(at(s.minutesAgo), rec.seq);
  // the chain hash does NOT include created_at, so backdating cannot break it
}

console.log(`seeded ${seeds.length} demo rows (backdated; chain hash excludes created_at)`);
console.log("chain:", JSON.stringify(ledger.verifyChain()));
console.log("now run ONE live decide in the UI for the video — the rest is history");
