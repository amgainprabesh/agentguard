import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "./ledger.ts";
import { MandateStore, DEFAULT_MANDATE } from "./mandate.ts";

test("first record has genesis hash and chains forward", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const l = new Ledger(join(dir, "t.db"));
  const a = l.append({ action: "ALLOW", amount_cents: 4200, reason: "within budget" });
  assert.equal(a.prev_hash, "GENESIS");
  assert.ok(/^[0-9a-f]{64}$/.test(a.hash), "hash is sha256 hex");
  const b = l.append({ action: "DENY", amount_cents: 31000, reason: "budget breach" });
  assert.equal(b.prev_hash, a.hash, "second record chains to first");
  const rows = l.all();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].hash, b.hash);
  l.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("verifyChain detects a tampered row", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const l = new Ledger(join(dir, "t.db"));
  l.append({ action: "ALLOW", amount_cents: 100, reason: "ok" });
  l.append({ action: "ALLOW", amount_cents: 200, reason: "ok" });
  assert.deepEqual(l.verifyChain(), { ok: true, brokenAt: null });
  l.db.exec(`UPDATE ledger SET amount_cents = 99999 WHERE seq = 1`);
  const res = l.verifyChain();
  assert.equal(res.ok, false, "chain must report broken");
  assert.equal(res.brokenAt, 1, "broken link identified at seq 1");
  l.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("category column persists and does not break the chain", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-cat-"));
  const ledger = new Ledger(join(dir, "t.db"));
  const rec = ledger.append({ action: "ALLOW", amount_cents: 4200, reason: "allowed acme.com snacks", category: "snacks" });
  assert.equal(rec.category, "snacks");
  assert.equal(ledger.all()[0].category, "snacks");
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });
  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("tamper() breaks the chain at exactly that row", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-tamper-"));
  const ledger = new Ledger(join(dir, "t.db"));
  ledger.append({ action: "ALLOW", amount_cents: 4200, reason: "row one", category: "snacks" });
  ledger.append({ action: "DENY", amount_cents: 1000, reason: "row two", category: "ads" });
  ledger.tamper(1);
  assert.deepEqual(ledger.verifyChain(), { ok: false, brokenAt: 1 });
  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("action+created_at index exists (monthContext aggregation is not a full scan)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-idx-"));
  const ledger = new Ledger(join(dir, "t.db"));
  const idx = ledger.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ledger_action_created'")
    .get() as { name: string } | undefined;
  assert.equal(idx?.name, "idx_ledger_action_created", "index must be created for fresh dbs");
  // and it must be idempotent — a second Ledger on the same path must not throw
  const again = new Ledger(join(dir, "t.db"));
  assert.deepEqual(again.verifyChain(), { ok: true, brokenAt: null });
  ledger.db.close();
  again.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("WAL journal mode is set (crash-safe appends, non-blocking readers)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-wal-"));
  const ledger = new Ledger(join(dir, "t.db"));
  const mode = ledger.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  assert.equal(mode.journal_mode.toLowerCase(), "wal", "ledger must run in WAL mode");
  // durability must stay FULL — WAL is about crash recovery, not trading it away
  const sync = ledger.db.prepare("PRAGMA synchronous").get() as { synchronous: number };
  assert.ok(sync.synchronous >= 2, "synchronous must stay FULL (2) or EXTRA (3)");
  ledger.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("creates its parent directory — a fresh clone has no data/ dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-mkdir-"));
  const nested = join(dir, "data", "agentguard.db"); // data/ does not exist yet
  const ledger = new Ledger(nested);
  ledger.append({ action: "ALLOW", amount_cents: 100, reason: "first row" });
  assert.deepEqual(ledger.verifyChain(), { ok: true, brokenAt: null });
  ledger.db.close();
  // and the mandate store saves into a fresh dir too
  const mandatePath = join(dir, "data", "mandate.json");
  const store = new MandateStore(mandatePath);
  store.update({ ...DEFAULT_MANDATE, monthly_budget_cents: 4200 });
  assert.equal(new MandateStore(mandatePath).get().monthly_budget_cents, 4200);
  rmSync(dir, { recursive: true, force: true });
});
