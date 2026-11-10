import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderWorkload } from "../plugins/project-board/src/ui/views/workload.js";
import { renderProjects } from "../plugins/project-board/src/ui/views/project.js";
import { renderGantt } from "../plugins/project-board/src/ui/views/gantt.js";
import { projectHours } from "../plugins/project-board/src/core/workload.js";

const D = "2026-10-20";
const sess = (id, date, start, end, kind = "actual") => ({ id, date, start, end, kind });
const task = (id, projectId, sessions = []) => ({ id, projectId, title: id, due: "2026-12-31", status: "To Do", sessions });
const mtg = (id, date, start, end, extra = {}) => ({ id, date, start, end, title: id, source: "manual", skip: false, externalId: null, ...extra });
const proj = (id, name) => ({ id, name, type: "更改", status: "進行中", start: "2026-09-01", due: "2026-12-31", milestones: [] });
const mk = () => ({
  version: 1, settings: {}, projects: [proj("A", "拠点A"), proj("B", "拠点B")],
  tasks: [task("A1", "A", [sess("S1", D, "09:00", "10:30"), sess("S9", D, "16:00", "17:00", "planned")]), task("B1", "B", [sess("S2", D, "13:00", "14:00")])],
  events: [mtg("m1", D, "10:30", "11:30", { projectId: "A", confirmed: true }), mtg("m2", D, "14:00", "14:30", { confirmed: true }), mtg("m3", D, "15:00", "16:00", { projectId: "B" })],
  changeLog: [],
});
const NOW = { date: D, time: "17:30" };
const wl = (d, o = {}) => renderWorkload(d, D, { period: "week", date: D, now: NOW, ...o });

test("renderWorkload: プロジェクトごとのタスク・会議・合計の時間が出る（手計算した値と一致）", () => {
  const html = wl(mk());
  assert.match(html, /拠点A[\s\S]*?1\.5h[\s\S]*?1\.0h[\s\S]*?2\.5h/);
  assert.match(html, /拠点B[\s\S]*?1\.0h[\s\S]*?0\.0h[\s\S]*?1\.0h/);
  assert.match(html, /<tfoot>[\s\S]*?2\.5h[\s\S]*?1\.5h[\s\S]*?4\.0h/, "合計（タスク 1.5+1.0、会議 1.0+0.5）");
  assert.ok(html.includes("10/19〜10/25 の週"));
});

test("renderWorkload: 未設定の会議の行、未確認の注記は該当するときだけ出る", () => {
  const html = wl(mk());
  assert.ok(html.includes("プロジェクト未設定の会議") && /プロジェクト未設定の会議[\s\S]*?0\.5h/.test(html));
  assert.ok(html.includes("未確認 2件（作業枠 1・会議 1）") && html.includes("まだ含まれていません"));
  const d = mk();
  d.events = d.events.filter((e) => e.id !== "m2" && e.id !== "m3");
  d.tasks[0].sessions = d.tasks[0].sessions.filter((s) => s.kind === "actual");
  const clean = wl(d);
  assert.ok(!clean.includes("プロジェクト未設定の会議") && !clean.includes("まだ含まれていません"));
});

test("renderWorkload: 週と月で期間の見出しと対象が変わる。空データで例外にならない", () => {
  const d = mk();
  d.tasks[0].sessions.push(sess("S3", "2026-10-05", "09:00", "10:00"));
  const month = wl(d, { period: "month" });
  assert.ok(month.includes("2026年10月") && month.includes("今月") && wl(d).includes("今週"));
  assert.match(month, /拠点A[\s\S]*?2\.5h[\s\S]*?1\.0h[\s\S]*?3\.5h/, "月全体なら 10/5 の1時間も入る");
  assert.match(wl(d), /拠点A[\s\S]*?1\.5h/, "週には入らない");
  const empty = { version: 1, settings: {}, projects: [], tasks: [], events: [], changeLog: [] };
  const html = wl(empty);
  assert.ok(html.includes("0.0h") && html.includes("プロジェクトがありません"));
});

test("renderWorkload: 内訳の横棒は合計に比例し、操作用の属性がある。名前はエスケープされる", () => {
  const d = mk(); d.projects[0].name = "<img src=x onerror=1>";
  const html = wl(d);
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x"));
  assert.ok(html.includes('data-wnav="-1"') && html.includes('data-wnav="1"') && html.includes("data-wtoday"));
  assert.ok(html.includes('data-wperiod="week" aria-pressed="true"') && html.includes('data-wperiod="month" aria-pressed="false"'));
  assert.match(html, /class="wl-bar" style="width:100(\.0+)?%/, "最大の行は 100%");
});

test("プロジェクトの見出しが『稼働 …（タスク …・会議 …）』になる（リストとガント）", () => {
  const d = JSON.parse(readFileSync(new URL("../plugins/project-board/data/sample.json", import.meta.url), "utf8"));
  d.events.find((e) => e.id === "m2").confirmed = true; // A に付いた会議 1h を確認済みにする
  const h = projectHours(d, "A");
  const want = `稼働 ${(h.task + h.meeting).toFixed(1)}h（タスク ${h.task.toFixed(1)}h・会議 ${h.meeting.toFixed(1)}h）`;
  assert.ok(h.meeting >= 1, "前提: 会議の時間が入っている");
  assert.ok(renderProjects(d, D, { filter: "A", view: "list" }).includes(want), "リスト");
  assert.ok(renderGantt(d, ["A"], D, {}).includes(want), "ガント");
});

import { shiftWorkloadDate } from "../plugins/project-board/src/ui/views/workload.js";

test("shiftWorkloadDate: 週は7日、月は1か月（年またぎ・月末の日付でもずれない）", () => {
  assert.equal(shiftWorkloadDate("week", "2026-10-20", 1), "2026-10-27");
  assert.equal(shiftWorkloadDate("week", "2026-10-20", -1), "2026-10-13");
  assert.equal(shiftWorkloadDate("month", "2026-12-31", 1), "2027-01-01");
  assert.equal(shiftWorkloadDate("month", "2026-01-31", -1), "2025-12-01");
  assert.equal(shiftWorkloadDate("month", "2026-03-31", 1), "2026-04-01");
});
