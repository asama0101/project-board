import { test } from "node:test";
import assert from "node:assert/strict";
import { projectHours, workload, periodRange } from "../plugins/project-board/src/core/workload.js";

const sess = (id, date, start, end, kind = "actual") => ({ id, date, start, end, kind });
const task = (id, projectId, sessions = []) => ({ id, projectId, title: id, due: "2026-12-31", status: "To Do", sessions });
const mtg = (id, date, start, end, extra = {}) => ({ id, date, start, end, title: id, source: "manual", skip: false, externalId: null, ...extra });
const data = (tasks, events) => ({ projects: [{ id: "A" }, { id: "B" }], tasks, events, changeLog: [], settings: {} });
const D = "2026-10-20";

test("projectHours: 実績の作業枠＋確認済みで参加する会議。予定・未確認・skip は含まない", () => {
  const d = data(
    [task("A1", "A", [sess("S1", D, "09:00", "10:30"), sess("S2", D, "11:00", "12:00", "planned")]), task("B1", "B", [sess("S3", D, "13:00", "14:00")])],
    [mtg("m1", D, "10:30", "11:30", { projectId: "A", confirmed: true }), mtg("m2", D, "14:00", "15:00", { projectId: "A" }),
     mtg("m3", D, "15:00", "16:00", { projectId: "A", confirmed: true, skip: true })],
  );
  assert.deepEqual(projectHours(d, "A"), { task: 1.5, meeting: 1 });
  assert.deepEqual(projectHours(d, "B"), { task: 1, meeting: 0 });
});

test("workload: 期間の外は含めない。プロジェクト未設定／存在しないプロジェクトの会議は unassigned", () => {
  const d = data(
    [task("A1", "A", [sess("S1", D, "09:00", "10:00"), sess("S2", "2026-11-20", "09:00", "10:00")])],
    [mtg("m1", D, "10:00", "11:00", { confirmed: true }), mtg("m2", D, "11:00", "11:30", { projectId: "ZZ", confirmed: true }),
     mtg("m3", "2026-11-20", "10:00", "11:00", { confirmed: true, projectId: "A" })],
  );
  const w = workload(d, { start: "2026-10-19", end: "2026-10-25" });
  assert.equal(w.unassigned, 1.5);
  assert.deepEqual(w.rows.find((r) => r.projectId === "A"), { projectId: "A", task: 1, meeting: 0, total: 1 });
  assert.equal(w.total, 2.5);
});

test("workload: 全プロジェクトが rows に並ぶ（0 時間でも）。total は rows の合計＋unassigned", () => {
  const d = data([task("A1", "A", [sess("S1", D, "09:00", "10:00")])], [mtg("m1", D, "10:00", "11:00", { confirmed: true })]);
  const w = workload(d, { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(w.rows.map((r) => r.projectId), ["A", "B"]);
  assert.equal(w.rows[1].total, 0);
  assert.equal(w.total, w.rows.reduce((a, r) => a + r.total, 0) + w.unassigned);
});

test("workload: unconfirmed は過ぎた未確認の枠と会議の件数（now 省略時は 0）", () => {
  const d = data(
    [task("A1", "A", [sess("S1", D, "09:00", "10:00", "planned"), sess("S2", D, "17:00", "18:00", "planned")])],
    [mtg("m1", D, "10:00", "11:00"), mtg("m2", D, "11:00", "12:00", { skip: true }), mtg("m3", D, "12:00", "13:00", { confirmed: true })],
  );
  const now = { date: D, time: "14:00" };
  const r = { start: "2026-10-19", end: "2026-10-25" };
  assert.equal(workload(d, r, now).unconfirmed, 2, "S1 と m1");
  assert.equal(workload(d, r).unconfirmed, 0);
});

test("periodRange: week は月曜〜日曜、month は 2028-02 で 29 日まで", () => {
  assert.deepEqual(periodRange("week", "2026-10-20"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(periodRange("week", "2026-10-25"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(periodRange("month", "2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodRange("month", "2026-12-31"), { start: "2026-12-01", end: "2026-12-31" });
});
