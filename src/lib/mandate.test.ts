import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { MandateStore, DEFAULT_MANDATE } = await import("./mandate.ts");

test("fresh store starts from the default mandate", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-m-"));
  const store = new MandateStore(join(dir, "mandate.json"));
  assert.deepEqual(store.get(), DEFAULT_MANDATE);
  rmSync(dir, { recursive: true, force: true });
});

test("update persists across store instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-m2-"));
  const path = join(dir, "mandate.json");
  const store = new MandateStore(path);
  const next = { ...DEFAULT_MANDATE, monthly_budget_cents: 9900 };
  assert.equal(store.update(next).monthly_budget_cents, 9900);
  assert.deepEqual(new MandateStore(path).get(), next);
  rmSync(dir, { recursive: true, force: true });
});

test("update rejects invalid mandates (trust boundary)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-m3-"));
  const store = new MandateStore(join(dir, "mandate.json"));
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, monthly_budget_cents: -1 }), /monthly_budget_cents/);
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, per_txn_cap_cents: "500" as unknown as number }), /per_txn_cap_cents/);
  assert.throws(() => store.update({ monthly_budget_cents: 1 } as never), /vendor_allowlist/);
  rmSync(dir, { recursive: true, force: true });
});

test("update rejects zero limits — velocity 0 would deny every request", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-m6-"));
  const store = new MandateStore(join(dir, "mandate.json"));
  // an empty number input in the editor parses as 0 — the demo would freeze
  // with every request denied and no visible cause
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, velocity_max_per_hour: 0 }), /at least 1/);
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, monthly_budget_cents: 0 }), /at least 1/);
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, per_txn_cap_cents: 0 }), /at least 1/);
  assert.throws(() => store.update({ ...DEFAULT_MANDATE, approval_threshold_cents: 0 }), /at least 1/);
  rmSync(dir, { recursive: true, force: true });
});

test("corrupted mandate.json falls back to the default instead of crashing boot", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-m4-"));
  const path = join(dir, "mandate.json");
  writeFileSync(path, "{ broken json — interrupted write");
  const store = new MandateStore(path);
  assert.deepEqual(store.get(), DEFAULT_MANDATE, "boot must survive a corrupted file");
  // and a save from the editor recovers it
  store.update({ ...DEFAULT_MANDATE, monthly_budget_cents: 4200 });
  assert.deepEqual(new MandateStore(path).get().monthly_budget_cents, 4200);
  rmSync(dir, { recursive: true, force: true });
});

test("update is atomic: no .tmp file left behind, no half-written mandate", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-m5-"));
  const path = join(dir, "mandate.json");
  const store = new MandateStore(path);
  store.update({ ...DEFAULT_MANDATE, velocity_max_per_hour: 3 });
  assert.equal(existsSync(`${path}.tmp`), false, "temp file must be renamed away");
  const raw = readFileSync(path, "utf8");
  JSON.parse(raw); // parses cleanly — never a partial write
  assert.equal(JSON.parse(raw).velocity_max_per_hour, 3);
  rmSync(dir, { recursive: true, force: true });
});
