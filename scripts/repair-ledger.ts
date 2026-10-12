// Repairs the demo ledger after the tamper demo: strips ' [TAMPERED]' from the
// reason and re-hashes the chain forward from that row. Scratch tool, not part of the app.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";

const dbPath = join(process.cwd(), "data", "agentguard.db");
if (!existsSync(dbPath)) {
  console.log("no ledger yet — nothing to repair (run npm run dev once to create it)");
  process.exit(0);
}
const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT * FROM ledger ORDER BY seq").all() as {
  seq: number; action: string; amount_cents: number; reason: string; prev_hash: string; hash: string;
}[];
const hashOf = (r: typeof rows[0]) =>
  createHash("sha256")
    .update(JSON.stringify([r.action, r.amount_cents, r.reason, r.prev_hash]))
    .digest("hex");

let prev = "GENESIS";
let fixed = 0;
for (const row of rows) {
  // strip EVERY marker: the tamper probe can fire twice on the same row (or a
  // judge clicks "Break the chain" twice), and a single .replace() would leave
  // one behind — the row would keep a marker and a wrong hash forever.
  const reason = row.reason.replace(/ \[TAMPERED\]/g, "");
  // compute the hash from the RUNNING prev, never the row's stored prev_hash:
  // a downstream row's stored prev_hash is the pre-repair hash, so hashing
  // against it writes a hash that can never match the prev_hash we just wrote.
  const hash = hashOf({ ...row, reason, prev_hash: prev });
  if (reason !== row.reason || hash !== row.hash || row.prev_hash !== prev) {
    db.prepare("UPDATE ledger SET reason=?, prev_hash=?, hash=? WHERE seq=?").run(reason, prev, hash, row.seq);
    fixed++;
  }
  prev = hash;
}
db.close();
console.log(`repaired ${fixed} row(s); chain re-verified by /api/ledger`);
