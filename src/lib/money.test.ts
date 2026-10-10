import { test } from "node:test";
import assert from "node:assert/strict";
import { splitForScore } from "./money.ts";

test("score 75 of 10000 cents captures 7500, voids 2500", () => {
  const r = splitForScore(10000, 75);
  assert.equal(r.capture_cents, 7500);
  assert.equal(r.void_cents, 2500);
});

test("rounding: capture always gets the larger share on ties, sum preserved", () => {
  // 100 cents at score 33 -> 33.0 exact, no rounding needed
  assert.deepEqual(splitForScore(100, 33), { capture_cents: 33, void_cents: 67 });
  // 1000 cents at score 1 -> 10 exact
  assert.deepEqual(splitForScore(1000, 1), { capture_cents: 10, void_cents: 990 });
  // odd: 333 cents at 50% -> 166.5 -> round half up to 167, void 166
  const r = splitForScore(333, 50);
  assert.equal(r.capture_cents + r.void_cents, 333, "sum must be exact");
  assert.equal(r.capture_cents, 167);
  assert.equal(r.void_cents, 166);
});

test("score 0 captures nothing, voids all; score 100 captures all", () => {
  assert.deepEqual(splitForScore(5000, 0), { capture_cents: 0, void_cents: 5000 });
  assert.deepEqual(splitForScore(5000, 100), { capture_cents: 5000, void_cents: 0 });
});

test("score is clamped to 0..100 defensively", () => {
  assert.deepEqual(splitForScore(1000, 150), { capture_cents: 1000, void_cents: 0 });
  assert.deepEqual(splitForScore(1000, -20), { capture_cents: 0, void_cents: 1000 });
});
