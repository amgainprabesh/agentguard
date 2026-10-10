// Independent ledger audit — does NOT import the app's verifyChain() so a bug in
// that function can't hide. Recomputes the chain from raw rows and checks the
// invariants an auditor would care about. Run: node --experimental-strip-types scripts/audit-ledger.ts
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";

const db = new DatabaseSync(join(process.cwd(), "data", "agentguard.db"));
const rows = db.prepare("SELECT * FROM ledger ORDER BY seq").all() as {
  seq: number; action: string; amount_cents: number; reason: string;
  prev_hash: string; hash: string; created_at: string;
}[];

const hashOf = (r: { action: string; amount_cents: number; reason: string; prev_hash: string }) =>
  createHash("sha256").update(JSON.stringify([r.action, r.amount_cents, r.reason, r.prev_hash])).digest("hex");

let prev = "GENESIS";
let brokenAt: number | null = null;
for (const r of rows) {
  if (r.prev_hash !== prev || r.hash !== hashOf(r)) { brokenAt = r.seq; break; }
  prev = r.hash;
}
console.log(`rows: ${rows.length}`);
console.log(`independent chain verify: ${brokenAt === null ? "OK" : "BROKEN at " + brokenAt}`);

const hashes = new Set(rows.map((r) => r.hash));
if (hashes.size !== rows.length) console.log("WARNING: duplicate hashes present");
const seqs = rows.map((r) => r.seq);
if (seqs.some((s, i) => i > 0 && s !== seqs[i - 1] + 1)) console.log("WARNING: seq gap — rows were deleted");
const badAction = rows.filter((r) => !["ALLOW", "DENY", "ESCALATE"].includes(r.action));
if (badAction.length) console.log("WARNING: invalid action values");
const negAmount = rows.filter((r) => r.amount_cents <= 0);
if (negAmount.length) console.log("WARNING: non-positive amounts");

// month totals the way finance would audit them
const month = new Date().toISOString().slice(0, 7);
const monthTotal = rows
  .filter((r) => r.action === "ALLOW" && r.created_at.slice(0, 7) === month)
  .reduce((s, r) => s + r.amount_cents, 0);
console.log(`ALLOW total this UTC month (${month}): $${(monthTotal / 100).toFixed(2)}`);
console.log(brokenAt === null && hashes.size === rows.length ? "AUDIT PASS" : "AUDIT FINDINGS ABOVE");
