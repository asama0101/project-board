import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistOf, checklistCount, nextChecklistId } from "../plugins/project-board/src/core/checklist.js";

test("checklistCount: 全体・済み・未チェックの件数。項目なしは 0", () => {
  const t = { checklist: [{ id: "c1", text: "a", done: true }, { id: "c2", text: "b", done: false }] };
  assert.deepEqual(checklistCount(t), { total: 2, done: 1, open: 1 });
  assert.deepEqual(checklistCount({}), { total: 0, done: 0, open: 0 });
  assert.deepEqual(checklistCount({ checklist: [] }), { total: 0, done: 0, open: 0 });
});

test("checklistOf: checklist がないタスクは空の配列", () => {
  assert.deepEqual(checklistOf({}), []);
  assert.deepEqual(checklistOf({ checklist: [{ id: "c1", text: "a", done: false }] }).length, 1);
});

test("nextChecklistId: 既存の最大番号 + 1。なければ c1", () => {
  assert.equal(nextChecklistId([]), "c1");
  assert.equal(nextChecklistId([{ id: "c1" }, { id: "c3" }]), "c4");
});
