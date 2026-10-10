// Resets the DEMO ledger to a clean slate for a fresh hackathon demo run:
// drops every row so velocity/month aggregation starts fresh, and re-verifies.
// Destructive on purpose — never call it against a real audit ledger.
// Run: npm run reset-demo
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const db = new DatabaseSync(join(process.cwd(), "data", "agentguard.db"));
const before = db.prepare("SELECT COUNT(*) AS c FROM ledger").get() as { c: number };
db.exec("DELETE FROM ledger");
db.exec("DELETE FROM sqlite_sequence WHERE name = 'ledger'"); // restart AUTOINCREMENT at 1
db.close();
console.log(`demo ledger reset: ${before.c} rows deleted, seq restarts at 1`);
