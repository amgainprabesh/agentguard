import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeStub } from "./grader.ts";

test("stub returns fixed score 75 with breakdown", async () => {
  const r = await gradeStub("any submission", [{ criterion: "quality", weight: 1 }]);
  assert.equal(r.score, 75);
  assert.ok(Array.isArray(r.breakdown));
  assert.equal(r.breakdown[0].criterion, "quality");
});
