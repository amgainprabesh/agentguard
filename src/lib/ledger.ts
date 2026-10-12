import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Decision = "ALLOW" | "DENY" | "ESCALATE";

export interface LedgerRecord {
  seq: number;
  action: Decision;
  amount_cents: number;
  reason: string;
  category: string | null;
  prev_hash: string;
  hash: string;
  created_at: string;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    // data/ is git-ignored, so a fresh clone has no such directory and SQLite
    // fails with "unable to open database file" — create it on first boot.
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // WAL: a crash mid-append can't corrupt the ledger the way the rollback
    // journal can, and readers don't block the writer (the audit view polls
    // /api/ledger while a decision is appending). No durability loss —
    // synchronous stays at FULL (2), only crash-recovery gets safer.
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL CHECK (action IN ('ALLOW','DENY','ESCALATE')),
        amount_cents INTEGER NOT NULL,
        reason TEXT NOT NULL,
        category TEXT,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    // shortcut: one-shot additive migration for pre-Sprint-3 dbs (data/agentguard.db); reseed the demo db to drop this
    try { this.db.exec("ALTER TABLE ledger ADD COLUMN category TEXT"); } catch {}
    // monthContext() filters on action + created_at every decide(); without an
    // index that is a full table scan per decision. Created after the migration
    // so pre-existing dbs get it too (CREATE INDEX IF NOT EXISTS is idempotent).
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_action_created ON ledger (action, created_at)");
  }

  private hashOf(rec: { action: Decision; amount_cents: number; reason: string; category?: string | null; prev_hash: string }): string {
    // category is IN the hash: it drives monthContext()'s category-limit
    // aggregation, so a row whose category is edited in the DB would dodge
    // (or trigger) a category limit while verifyChain() still said OK.
    return createHash("sha256")
      .update(JSON.stringify([rec.action, rec.amount_cents, rec.reason, rec.category ?? null, rec.prev_hash]))
      .digest("hex");
  }

  append(input: { action: Decision; amount_cents: number; reason: string; category?: string | null }): LedgerRecord {
    const prev = this.db.prepare("SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev_hash = prev?.hash ?? "GENESIS";
    const hash = this.hashOf({ ...input, prev_hash });
    const created_at = new Date().toISOString();
    const category = input.category ?? null;
    this.db
      .prepare("INSERT INTO ledger (action, amount_cents, reason, category, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(input.action, input.amount_cents, input.reason, category, prev_hash, hash, created_at);
    const seq = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
    return { seq, ...input, category, prev_hash, hash, created_at };
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

  // demo-only hook: lets the auditor view break its own chain live (WINNER-BRIEF tamper beat). Not part of the audit contract.
  tamper(seq: number): void {
    this.db.prepare("UPDATE ledger SET reason = reason || ' [TAMPERED]' WHERE seq = ?").run(seq);
  }
}
