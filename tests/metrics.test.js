import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, weekday } from "../plugins/project-board/src/core/dates.js";
import { taskStart, ganttRows, ganttLayout, timeTicks, projectProgress, taskFlags, projectFlags } from "../plugins/project-board/src/core/metrics.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-board/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const range = (start, days) => ({ start, end: addDays(start, days - 1) });
const mk = (tasks, extra = {}) => ({
  settings: { waitingLongDays: 7 },
  projects: [{ id: "P", name: "p", status: "進行中", start: "2026-10-01", due: "2026-12-31", milestones: [], ...extra }],
  tasks: tasks.map((t) => ({ projectId: "P", status: "To Do", start: null, predecessors: [], sessions: [], waitingOn: null, doneAt: null, ...t })),
  events: [], changeLog: [],
});

test("ganttLayout: 表示期間ごとの visibleDays / ratio / scale", () => {
  const r = range("2026-01-01", 580);
  const m6 = ganttLayout(r, "m6");
  assert.equal(m6.visibleDays, 183);
  assert.ok(Math.abs(m6.ratio - 580 / 183) < 1e-9);
  assert.equal(m6.scale, "month");
  assert.deepEqual([ganttLayout(r, "all").ratio, ganttLayout(r, "all").scale], [1, "quarter"]);
  assert.equal(ganttLayout(r, "m1").scale, "day");
  assert.equal(ganttLayout(r, "m3").scale, "week");
  assert.equal(ganttLayout(range("2026-01-01", 30), "y1").scale, "day");
  const s = ganttLayout(range("2026-01-01", 60), "y1");
  assert.deepEqual([s.visibleDays, s.ratio], [60, 1]);
});

test("timeTicks: 日・週・月・四半期", () => {
  const r = range("2026-10-25", 14);
  const days = timeTicks(r, "day");
  assert.equal(days.length, 14);
  assert.equal(days.find((t) => t.date === "2026-11-01").label, "11/1");
  const rr = { start: "2026-10-05", end: "2027-02-10" };
  const months = timeTicks(rr, "month");
  assert.deepEqual(months.map((t) => t.label), ["10月", "11月", "12月", "2027/1", "2月"]);
  assert.equal(months.find((t) => t.label === "2027/1").yearStart, true);
  assert.equal(months[0].date, "2026-10-05"); // 範囲開始より前の月初は範囲開始に寄せる
  assert.deepEqual(timeTicks(rr, "quarter").map((t) => t.label), ["2026 Q4", "2027 Q1"]);
  const weeks = timeTicks(rr, "week");
  assert.ok(weeks.every((t) => weekday(t.date) === 1));
  const long = timeTicks(range("2026-01-01", 546), "month");
  assert.equal(long.length, 18);
});

test("taskStart: start があればそれ／なければ前のタスクの期限の最大値／それもなければ due", () => {
  const d = mk([
    { id: "T1", due: "2026-10-10" }, { id: "T2", due: "2026-10-14" },
    { id: "T3", due: "2026-10-30", start: "2026-10-01", predecessors: ["T1", "T2"] },
    { id: "T4", due: "2026-10-30", start: "2026-10-05" }, { id: "T5", due: "2026-10-30" },
    { id: "T6", due: "2026-10-30", predecessors: ["T1", "T2"] },
  ]);
  assert.equal(taskStart(d, "T3"), "2026-10-01"); // start を指定したら、前のタスクがあってもその日
  assert.equal(taskStart(d, "T6"), "2026-10-14");
  assert.equal(taskStart(d, "T4"), "2026-10-05");
  assert.equal(taskStart(d, "T5"), "2026-10-30");
});

test("ganttRows: 行・point・actual・マイルストーン", () => {
  const d = load();
  const g = ganttRows(d, "A", TODAY);
  assert.equal(g.rows.length, d.tasks.filter((t) => t.projectId === "A").length);
  const a2 = g.rows.find((r) => r.taskId === "A2");
  assert.deepEqual([a2.start, a2.end, a2.point], ["2026-07-31", "2026-08-20", false]);
  const a5 = g.rows.find((r) => r.taskId === "A5");
  assert.deepEqual(a5.actual, { start: "2026-10-14", end: TODAY }); // 未完了 → 今日まで
  assert.equal(g.rows.find((r) => r.taskId === "A4").actual, null);
  assert.deepEqual(g.milestones.map((m) => m.name), ["機器発注", "本番切替"]);
  assert.ok(g.range.start <= "2026-06-01" && g.range.end >= "2027-03-31");
  // 点は、開始も前のタスクもない（期限だけの）タスクに限る。開始が期限以後のタスク・前のタスクがあるタスクは、期限の 1 日分の棒
  const rowOf = (t) => ganttRows(mk([{ id: "T0", due: "2026-10-01" }, t]), "P", TODAY).rows.find((r) => r.taskId === t.id);
  assert.deepEqual([rowOf({ id: "T1", due: "2026-10-05" })].map((r) => [r.start, r.end, r.point]), [["2026-10-05", "2026-10-05", true]]);
  assert.deepEqual([rowOf({ id: "T1", due: "2026-10-05", start: "2026-10-05" })].map((r) => [r.start, r.end, r.point]), [["2026-10-05", "2026-10-05", false]]);
  assert.deepEqual([rowOf({ id: "T1", due: "2026-10-05", start: "2026-10-20" })].map((r) => [r.start, r.end, r.point]), [["2026-10-05", "2026-10-05", false]]);
  assert.deepEqual([rowOf({ id: "T1", due: "2026-10-01", predecessors: ["T0"] })].map((r) => [r.start, r.end, r.point]), [["2026-10-01", "2026-10-01", false]], "前のタスクの期限と同じ日");
  assert.deepEqual(ganttRows(mk([]), "P", TODAY).rows, []);
});

test("ganttRows: 完了したタスクの実績は完了日まで", () => {
  const d = mk([{ id: "T1", due: "2026-10-10", status: "Done", doneAt: "2026-10-09",
    sessions: [{ id: "S1", date: "2026-10-05", start: "10:00", end: "11:00", kind: "actual" }] }]);
  assert.deepEqual(ganttRows(d, "P", TODAY).rows[0].actual, { start: "2026-10-05", end: "2026-10-09" });
});

test("projectProgress: Cancelled を除いた Done の割合", () => {
  const d = mk([{ id: "1", status: "Done" }, { id: "2", status: "Cancelled" }, { id: "3", status: "In Progress" }, { id: "4" }]);
  const p = projectProgress(d, "P");
  assert.deepEqual([p.done, p.total], [1, 3]);
  assert.equal(p.rate, 1 / 3);
  assert.equal(projectProgress(mk([]), "P").rate, 0);
});

test("taskFlags / projectFlags", () => {
  const s = { waitingLongDays: 7 };
  assert.deepEqual(taskFlags({ status: "To Do", due: "2026-10-19" }, TODAY, s), ["overdue"]);
  assert.deepEqual(taskFlags({ status: "Done", due: "2026-10-19" }, TODAY, s), []);
  assert.ok(taskFlags({ status: "Waiting", due: "2027-01-01", waitingOn: { party: "x", since: "2026-10-13" } }, TODAY, s).includes("waiting-long"));
  assert.ok(!taskFlags({ status: "Waiting", due: "2027-01-01", waitingOn: { party: "x", since: "2026-10-14" } }, TODAY, s).includes("waiting-long"));
  const d = load();
  assert.deepEqual(projectFlags(d, "A", TODAY).sort(), ["overdue-tasks", "waiting-long"]);
  const late = mk([{ id: "1" }], { due: "2026-10-01" });
  assert.ok(projectFlags(late, "P", TODAY).includes("past-due"));
});

test("週目盛り: 年をまたぐ週に yearStart が付く（M7）", () => {
  const w = timeTicks({ start: "2026-12-14", end: "2027-01-20" }, "week");
  assert.deepEqual(w.filter((t) => t.yearStart).map((t) => t.date), ["2026-12-28"]);
});

test("taskFlags: since が無くても落ちない（I4）", () => {
  assert.deepEqual(taskFlags({ status: "Waiting", due: "2027-01-01", waitingOn: { party: "x" } }, TODAY, { waitingLongDays: 7 }), []);
});
