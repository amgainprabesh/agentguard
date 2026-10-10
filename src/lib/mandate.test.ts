import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
