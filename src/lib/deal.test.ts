import { test } from "node:test";
import assert from "node:assert/strict";
import { Deal, canTransition } from "./deal.ts";

test("legal transitions only", () => {
  assert.ok(canTransition("CREATED", "AUTHORIZED"));
  assert.ok(canTransition("AUTHORIZED", "DELIVERED"));
  assert.ok(canTransition("DELIVERED", "GRADED"));
  assert.ok(canTransition("GRADED", "SETTLED"));
  assert.ok(!canTransition("CREATED", "SETTLED"), "cannot skip states");
  assert.ok(!canTransition("SETTLED", "AUTHORIZED"), "terminal state");
});

test("deliver is rejected before authorization", () => {
  const d = new Deal({ id: "d1", amount_cents: 1000 });
  assert.throws(() => d.deliver("submission text"), /not authorized/i);
});

test("full happy path transitions and records history", () => {
  const d = new Deal({ id: "d1", amount_cents: 1000 });
  d.authorize("AUTH123");
  assert.equal(d.state, "AUTHORIZED");
  d.deliver("here is the work");
  assert.equal(d.state, "DELIVERED");
  d.grade(80);
  assert.equal(d.state, "GRADED");
  d.settle();
  assert.equal(d.state, "SETTLED");
  assert.deepEqual(d.history, ["CREATED", "AUTHORIZED", "DELIVERED", "GRADED", "SETTLED"]);
});

test("grader failure voids the whole hold (FAILED path)", () => {
  const d = new Deal({ id: "d1", amount_cents: 1000 });
  d.authorize("AUTH123");
  d.deliver("work");
  d.fail("grader timeout");
  assert.equal(d.state, "FAILED");
  assert.ok(!canTransition("FAILED", "GRADED"));
});
