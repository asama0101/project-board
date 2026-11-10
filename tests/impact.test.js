import { test } from "node:test";
import assert from "node:assert/strict";
import { computeImpact } from "../plugins/project-board/src/core/impact.js";

const mk = (tasks, projectDue = "2026-12-31") => ({
  projects: [{ id: "P", due: projectDue }],
  tasks: tasks.map(([id, due, preds = [], status = "To Do"]) => ({ id, projectId: "P", due, predecessors: preds, status })),
});
const chain = () => mk([["T1", "2026-10-10"], ["T2", "2026-10-12", ["T1"]], ["T3", "2026-10-20", ["T2"]]]);
const byId = (r) => Object.fromEntries(r.changes.map((c) => [c.taskId, c]));

test("T1 を +5 日: T1・T2 が 10/15 になり、T3 は据え置き", () => {
  const r = computeImpact(chain(), "T1", 5);
  assert.equal(r.changes[0].taskId, "T1");
  const c = byId(r);
  assert.equal(c.T1.newDue, "2026-10-15");
  assert.deepEqual([c.T2.oldDue, c.T2.newDue, c.T2.reason], ["2026-10-12", "2026-10-15", "前のタスク T1 の遅れ"]);
  assert.equal(c.T3, undefined);
});

test("T1 を +12 日: T3 まで動く", () => {
  const c = byId(computeImpact(chain(), "T1", 12));
  assert.equal(c.T3.newDue, "2026-10-22");
});

test("次のタスクが Done なら動かさない", () => {
  const d = mk([["T1", "2026-10-10"], ["T2", "2026-10-12", ["T1"], "Done"]]);
  assert.deepEqual(computeImpact(d, "T1", 5).changes.map((c) => c.taskId), ["T1"]);
});

test("複数の前のタスクがある次のタスクは、最も遅い前のタスクに合わせる", () => {
  const d = mk([["T1", "2026-10-10"], ["T2", "2026-10-14"], ["T3", "2026-10-13", ["T1", "T2"]]]);
  assert.equal(byId(computeImpact(d, "T1", 10)).T3.newDue, "2026-10-20");
  assert.equal(byId(computeImpact(d, "T1", 2)).T3, undefined);
});

test("前倒し（負の日数）は次のタスクを動かさない", () => {
  const r = computeImpact(chain(), "T1", -3);
  assert.deepEqual(r.changes.map((c) => [c.taskId, c.newDue]), [["T1", "2026-10-07"]]);
});

test("循環データでも終了する", () => {
  const d = mk([["T1", "2026-10-10", ["T2"]], ["T2", "2026-10-12", ["T1"]]]);
  const r = computeImpact(d, "T1", 5);
  assert.equal(byId(r).T1.newDue, "2026-10-15");
});

test("プロジェクト期限を超えたら projectDueExceeded に入る", () => {
  const r = computeImpact(mk([["T1", "2026-10-10"]], "2026-10-12"), "T1", 5);
  assert.deepEqual(r.projectDueExceeded, [{ projectId: "P", due: "2026-10-12", latestTaskDue: "2026-10-15" }]);
  assert.deepEqual(computeImpact(chain(), "T1", 1).projectDueExceeded, []);
});

// ---- 前倒しの詰め（Task 5） ----

test("compress なしの前倒しは、対象だけ動き次のタスクは動かない（従来どおり）", () => {
  const r = computeImpact(chain(), "T1", -3);
  assert.deepEqual(r.changes.map((c) => [c.taskId, c.newDue]), [["T1", "2026-10-07"]]);
});

test("compress: 前倒しで次のタスクが同じ日数まで詰まる。ただし前のタスクの新しい期限より前にはならない", () => {
  const c = byId(computeImpact(chain(), "T1", -3, { compress: true }));
  assert.deepEqual([c.T2.oldDue, c.T2.newDue, c.T2.reason], ["2026-10-12", "2026-10-09", "前のタスク T1 の前倒し"]);
  assert.equal(c.T3.newDue, "2026-10-17", "2段目にも波及");
  const d = mk([["T1", "2026-10-10"], ["X", "2026-10-20"], ["T2", "2026-10-21", ["T1", "X"]]]);
  const e = byId(computeImpact(d, "T1", -5, { compress: true }));
  assert.equal(e.T2.newDue, "2026-10-20", "別の前のタスク X の期限より前にはならない");
});

test("compress: Done の次のタスクは動かない。次のタスクが前倒しされても今より後ろにはならない", () => {
  const d = mk([["T1", "2026-10-10"], ["T2", "2026-10-12", ["T1"], "Done"], ["T3", "2026-10-12", ["T1"]]]);
  const r = computeImpact(d, "T1", -3, { compress: true });
  assert.deepEqual(r.changes.map((c) => c.taskId).sort(), ["T1", "T3"]);
  assert.ok(r.changes.every((c) => c.newDue < c.oldDue));
});

test("compress: deltaDays が正のときは従来の結果と一致する", () => {
  assert.deepEqual(computeImpact(chain(), "T1", 5, { compress: true }), computeImpact(chain(), "T1", 5));
});
