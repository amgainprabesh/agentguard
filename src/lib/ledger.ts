import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export type Decision = "ALLOW" | "DENY" | "ESCALATE";

export interface LedgerRecord {
  seq: number;
  action: Decision;
  amount_cents: number;
  reason: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL CHECK (action IN ('ALLOW','DENY','ESCALATE')),
        amount_cents INTEGER NOT NULL,
        reason TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private hashOf(rec: { action: Decision; amount_cents: number; reason: string; prev_hash: string }): string {
    return createHash("sha256")
      .update(JSON.stringify([rec.action, rec.amount_cents, rec.reason, rec.prev_hash]))
      .digest("hex");
  }

  append(input: { action: Decision; amount_cents: number; reason: string }): LedgerRecord {
    const prev = this.db.prepare("SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev_hash = prev?.hash ?? "GENESIS";
    const hash = this.hashOf({ ...input, prev_hash });
    const created_at = new Date().toISOString();
    this.db
      .prepare("INSERT INTO ledger (action, amount_cents, reason, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?)")
      .run(input.action, input.amount_cents, input.reason, prev_hash, hash, created_at);
    const seq = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
    return { seq, ...input, prev_hash, hash, created_at };
  }

  all(): LedgerRecord[] {
    return this.db.prepare("SELECT * FROM ledger ORDER BY seq").all() as unknown as LedgerRecord[];
  }

  verifyChain(): { ok: boolean; brokenAt: number | null } {
    const rows = this.all();
    let prev_hash = "GENESIS";
    for (const r of rows) {
      if (r.prev_hash !== prev_hash || r.hash !== this.hashOf(r)) {
        return { ok: false, brokenAt: r.seq };
      }
      prev_hash = r.hash;
    }
    return { ok: true, brokenAt: null };
  }
}
