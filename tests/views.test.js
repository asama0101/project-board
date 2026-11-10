import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays } from "../plugins/project-board/src/core/dates.js";
import { renderProjects } from "../plugins/project-board/src/ui/views/project.js";
import { renderGantt, assignLevels, layoutMilestones } from "../plugins/project-board/src/ui/views/gantt.js";
import { renderPrio, renderTodayTasks, todayTaskIds, doneAskHtml } from "../plugins/project-board/src/ui/views/prio.js";
import { renderSettings } from "../plugins/project-board/src/ui/views/settings.js";
import { checkMeterHtml } from "../plugins/project-board/src/ui/common.js";
import { checklistEditorHtml } from "../plugins/project-board/src/ui/views/checklist.js";
import { renderTaskPop } from "../plugins/project-board/src/ui/views/taskpop.js";
import { renderInboxBar, ibExamples } from "../plugins/project-board/src/ui/views/inboxpanel.js";
import { ruleMeetingCounts } from "../plugins/project-board/src/core/rules.js";
import { renderSchedule, snapStart } from "../plugins/project-board/src/ui/views/schedule.js";
import { taskActual } from "../plugins/project-board/src/core/sessions.js";


const load = () => JSON.parse(readFileSync(new URL("../plugins/project-board/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const count = (html, re) => (html.match(re) ?? []).length;
const gantt = (d, ids, extra = {}) => renderGantt(d, ids, TODAY, { window: "m6", ...extra });

// 18 か月規模（2026-04〜2027-09）に延ばしたデータ
function longData() {
  const d = load();
  d.projects[0].start = "2026-04-01"; d.projects[0].due = "2027-09-30";
  d.tasks.find((t) => t.id === "A7").due = "2027-09-30";
  d.tasks.find((t) => t.id === "A6").due = "2027-08-01";
  return d;
}

test("renderProjects: 画面内の「ガント／リスト」切り替え（data-pview）を出さない。view が gantt でも list でも、同じ絞り込みの状態が同じに出る", () => {
  const d = load();
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "A", view, window: "m6", hideDone: true });
    assert.doesNotMatch(html, /data-pview/);
    assert.match(html, /data-filter="A" aria-pressed="true"/, view);
  }
});

test("renderProjects(gantt/all): 全プロジェクト名・進捗率・遅延バッジ・マイルストーン、目盛りが共通", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", hideDone: false });
  for (const p of d.projects) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes("(29%)") || html.includes("%"), "進捗率");
  assert.ok(html.includes("期限超過"));
  assert.ok(html.includes("待ち長期化"));
  assert.ok(html.includes("機器発注") && html.includes("原因特定"));
  const ticks = (html.match(/data-tick="[^"]+"/g) ?? []);
  const perSection = ticks.length / 3;
  assert.equal(perSection, Math.floor(perSection), "各ガントの目盛りは同数");
  assert.ok(html.includes('id="h-rk"'), "既定で右の列（今日の優先）が開いている");
});

test("renderProjects: 進捗率の値（Cancelled を除く Done の割合）", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "gantt", window: "m6" });
  assert.ok(html.includes("2/7 Done (29%)"));
});

test("レーン幅の式に ganttLayout の ratio が使われる", () => {
  const html = gantt(load(), ["A", "B", "C"]);
  const m = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(html);
  assert.ok(m, "幅の式");
  assert.ok(+m[1] > 1, "6 か月より長い範囲なので 1 より大きい");
  const all = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(gantt(load(), ["A"], { window: "all" }));
  assert.equal(+all[1], 1);
});

test("空データでも例外を出さず、空状態を表示する", () => {
  const d = { version: 1, settings: load().settings, projects: [], tasks: [], events: [], changeLog: [] };
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes("プロジェクトがありません"));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "list" }).includes("プロジェクトがありません"));
});

test("renderProjects(list): 状態（英語表記）・待ち先・日程変更の履歴・実績", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  for (const s of ["To Do", "In Progress", "Waiting", "Done", "Cancelled"]) assert.ok(html.includes(`>${s}</option>`), s);
  assert.ok(html.includes('value="ベンダーX"'));
  assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
  assert.ok(html.includes("3.5h・初回 10/14・3回"), "A5 の実績");
  assert.ok(html.includes("前のタスクから"), "前のタスクがあり、開始日の指定がないときは、決まる日と『前のタスクから』を添える");
  assert.ok(html.includes('type="date" data-f="start" data-id="A5"'), "前のタスクなしは開始日を入力できる");
  assert.ok(html.includes('data-f="start" data-id="A6"'), "前のタスクありでも開始日を入力できる");
});

test("renderGantt: 行数＝タスク数、今日の線、マイルストーン、実績の線は実績のあるタスクだけ", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  const tasks = d.tasks.filter((t) => t.projectId === "A");
  assert.equal(count(html, /data-gt="/g), tasks.length);
  assert.equal(count(html, /class="todayline"/g), 1);
  assert.ok(html.includes("機器発注") && html.includes("8/31"));
  assert.equal(count(html, /class="gact" style="left/g), 1, "実績があるのは A5 だけ");
});

test("renderGantt: 日表示で、手動の休みと祝日の列にも土日と同じ着色（class=\"gwk\"）が付く。土日祝を営業日に数える設定がオンでも付く", () => {
  const d = load();
  const n = (settings) => count(gantt({ ...d, settings: { ...d.settings, ...settings } }, ["C"], { window: "m1" }), /class="gwk"/g);
  const none = n({ holidays: [], nationalHolidays: { dates: [] }, workdays: [] });
  const withRest = { holidays: [{ date: "2026-10-22", kind: "有給" }], nationalHolidays: { dates: [{ date: "2026-11-03", name: "文化の日" }] }, workdays: [] };
  assert.equal(n(withRest), none + 2);
  assert.equal(n({ ...withRest, countWeekendsAndHolidays: true }), none + 2);
});

test("renderGantt: 1か月は日目盛り（範囲の日数）と土日の着色、3か月は週目盛り", () => {
  const d = load();
  const m1 = gantt(d, ["C"], { window: "m1" });
  const days = count(m1, /data-tick=/g);
  assert.ok(days > 30 && days < 60);
  const first = /data-tick="([^"]+)"/.exec(m1)[1];
  const last = [...m1.matchAll(/data-tick="([^"]+)"/g)].pop()[1];
  assert.equal(days, diffDays(last, first) + 1);
  assert.ok(count(m1, /class="gwk"/g) >= 8, "土日の着色");
  assert.ok(m1.includes("<small>火</small>"), "曜日");
  const m3 = gantt(d, ["A"], { window: "m3" });
  assert.equal(count(m3, /class="gwk"/g), 0);
  assert.ok([...m3.matchAll(/data-tick="([^"]+)"/g)].every((m) => new Date(m[1] + "T00:00:00Z").getUTCDay() === 1));
});

test("renderGantt: タスク 0 件。「（なし）」見出しと「＋」", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "C");
  const html = gantt(d, ["C"]);
  assert.ok(html.includes("（なし）") && html.includes('data-gopen="C"'));
});

// プロジェクト C の 3 件に大項目・中項目を付ける（保存順 C1, C2, C3）
const setC = (d, spec) => { for (const [id, group, subgroup, status] of spec) Object.assign(d.tasks.find((t) => t.id === id), { group, subgroup, ...(status ? { status } : {}) }); return d; };
const gotoOrder = (html) => [...html.matchAll(/data-gedit="([^"]+)"/g)].map((m) => m[1]);

test("ガント: 大項目ごとの見出し行に「＋」があり、最下部の入力行はない", () => {
  const html = gantt(load(), ["A"]);
  assert.ok(html.includes('data-gopen="A"'));
  assert.ok(!html.includes("g-add") && !html.includes("data-gadd="));
});

test("ガント: 保存順が X/a, Y/b, X/c でも、X の2件が続けて並ぶ", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b"], ["C3", "X", "c"]]);
  assert.deepEqual(gotoOrder(gantt(d, ["C"])), ["C1", "C3", "C2"]);
});

test("ガント: 完了を隠す中でも、グループの見出しが残る", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b", "Done"], ["C3", "X", "c"]]);
  const html = gantt(d, ["C"], { hideDone: true });
  assert.ok(html.includes('data-ag="Y"') && !html.includes('data-gedit="C2"'));
});

test("ガント: addAt のある見出しに名前入力が出る。大項目名の特殊文字は escape される", () => {
  const g = 'A"<b>|';
  const d = setC(load(), [["C1", g, "a"]]);
  const html = gantt(d, ["C"], { addAt: { pid: "C", group: g, subgroup: "a" } });
  assert.ok(html.includes('data-gadd="C"') && html.includes('data-ag="A&quot;&lt;b&gt;|"'));
  assert.ok(!html.includes(g));
  assert.ok(html.includes("data-gaddok=") && html.includes("data-gaddno"));
});

test("ガント: 大項目が空で中項目だけあるタスクは「（なし）」のブロックに出る", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "", "メモ"], ["C3", null, null]]);
  assert.deepEqual(gotoOrder(gantt(d, ["C"])), ["C1", "C2", "C3"]);
});

test("renderGantt: 完了を隠すと Done の行だけが減る（進捗は変わらない）", () => {
  const d = longData();
  const all = gantt(d, ["A"]);
  const hid = gantt(d, ["A"], { hideDone: true });
  const done = d.tasks.filter((t) => t.projectId === "A" && t.status === "Done").length;
  assert.equal(count(all, /data-gt="/g) - count(hid, /data-gt="/g), done);
  assert.ok(hid.includes("2/7 Done"));
});

test("renderProjects: filter に指定したプロジェクトだけが出る", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "gantt", window: "m6" });
  assert.ok(html.includes('data-gt="A3"'));
  assert.ok(!html.includes('data-gt="B2"') && !html.includes('data-gt="C1"'));
  assert.ok(!html.includes('data-gp="B"'));
});

test("利用者入力はエスケープされる", () => {
  const d = load();
  d.tasks[0].title = "<script>alert(1)</script>";
  d.projects[0].name = "<img src=x onerror=1>";
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    assert.ok(!html.includes("<script>alert"), view);
    assert.ok(!html.includes("<img src=x"), view);
    assert.ok(html.includes("&lt;script&gt;"), view);
  }
});

test("前のタスクがあるバーにも、左端のつまみがある（前のタスクとの関係は見ない）", () => {
  const html = gantt(load(), ["A"]);
  const bar = (id) => new RegExp(`<i class="gbar[^"]*"[^>]*data-gt="${id}"[^>]*>(.*?)</i>`).exec(html)?.[1] ?? "";
  assert.ok(bar("A4").includes('data-gh="l"'));
  assert.ok(bar("A4").includes('data-gh="r"'));
  assert.ok(bar("A5").includes('data-gh="l"'));
  assert.ok(html.includes("data-gp=") && html.includes("data-gms=") && html.includes("data-gedit=") && html.includes("data-gopen="));
});

test("addDays は表示範囲の計算に使える", () => {
  assert.equal(addDays(TODAY, -10), "2026-10-10");
});

// ---- スケジュール画面 ----
const NOW = { date: "2026-10-20", time: "10:15" };
const sched = (d, o = {}) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, ...o });

test("snapStart: 15分刻み・勤務時間内に収める", () => {
  const wd = { start: "09:00", end: "18:00" };
  assert.equal(snapStart(10 * 60 + 7, 60, wd), 10 * 60);
  assert.equal(snapStart(17 * 60 + 50, 60, wd), 17 * 60);
  assert.equal(snapStart(8 * 60, 60, wd), 9 * 60);
});

test("renderSchedule(day): 空き時間・優先タスクと理由・枠の種別クラス・実績時間", () => {
  const d = load();
  d.tasks.find((t) => t.id === "A5").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "09:30", kind: "planned" }); // 過ぎた予定 = 未確認
  const html = sched(d);
  assert.ok(html.includes("10:30-13:00 空き"), "会議と枠を除いた空き");
  assert.ok(html.includes('id="h-rk"') && html.includes("催促") && html.includes("期限超過 4日"));
  assert.ok(html.includes('class="blk task unconf'), "未確認");
  const w = renderSchedule(load(), TODAY, { view: "week", date: "2026-10-19", now: NOW });
  assert.ok(w.includes("class=\"blk task act"), "実績");
  assert.ok(w.includes("class=\"blk task plan"), "予定");
  assert.ok(w.includes(`${(2.5).toFixed(1)}時間`), "週の実績(10/19 の 1.5h + 1h)");
  assert.equal(taskActual(load(), "A5").hours + taskActual(load(), "B2").hours, 4.5);
});

test("renderSchedule(week): 7 日分の列と会議の時間枠・件名（画面では常に件名を出す）", () => {
  const d = load();
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.equal(count(html, /class="col dz/g), 7);
  for (const day of ["2026-10-19", "2026-10-25"]) assert.ok(html.includes(`data-date="${day}"`));
  assert.ok(html.includes("NW運用定例"));
  assert.ok(html.includes("class=\"blk mtg"));
});

test("renderSchedule(week): 不明な状態のタスクが期限欄にあっても例外にしない（validate が注意を出す。画面は白くしない）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "B2").status = "Doing"; // 期限 2026-10-23 は表示中の週
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(html.includes("ルータ設定の作成"));
});

test("renderSchedule: 未確認 0 件なら『すべて実績にする』は出ない／選択がなければ『枠を削除』は無効", () => {
  const d = load();
  const html = sched(d);
  assert.ok(!html.includes("data-confirmall"));
  assert.ok(/data-delsel disabled>枠や会議を選んで削除/.test(html));
  assert.ok(!sched(d, { selSess: "S2" }).includes("の枠を削除"), "表示外の選択は無効");
  const sel = sched(d, { selSess: "S2", date: "2026-10-19" });
  assert.ok(sel.includes("「切替手順書の作成」の枠を削除"));
  assert.ok(!/data-delsel disabled/.test(sel));
  assert.ok(sel.includes("blk task act sel"));
});

test("renderSchedule: 凡例（会議・予定・実績・未確認、日は空き時間と現在時刻）", () => {
  const day = sched(load());
  for (const w of ["会議", "予定", "実績", "未確認", "空き時間", "現在時刻"]) assert.ok(day.includes(w), w);
  const wk = renderSchedule(load(), TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(!wk.includes("現在時刻") && wk.includes("未確認"));
  assert.ok(day.includes('class="nowline"'));
});

test("renderSchedule: 手入力の会議だけドラッグ可、参加しない会議は skip 表示、MCP 会議は編集不可の注意", () => {
  const d = load();
  d.events.find((e) => e.id === "m1").skip = true;
  const html = sched(d, { selMtg: "m1", showSkipped: true });
  assert.ok(/data-mtg="m2"[^>]*draggable="true"/.test(html));
  assert.ok(!/data-mtg="m1"[^>]*draggable/.test(html));
  assert.ok(html.includes("blk mtg skip"));
  assert.ok(html.includes("予定表から取得した会議です") && html.includes("data-mt=\"title\" value=\"NW運用定例\" placeholder=\"会議名\" style=\"min-width:200px\" disabled"));
});

test("renderSchedule: 優先リストはドラッグ可で、置いた回数と実績時間を出す。勤務時間外の会議は表示しない", () => {
  const d = load();
  d.events.push({ id: "m9", date: "2026-10-20", start: "07:00", end: "08:30", title: "早朝作業", source: "manual", skip: false, externalId: null });
  const html = sched(d);
  assert.ok(/draggable="true" data-pick="B2"/.test(html));
  assert.ok(html.includes("2回・実績 1.0h"));
  assert.ok(!html.includes("早朝作業"));
});

test("リスト: 重要度とメモを編集できる", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  assert.ok(html.includes('data-f="importance" data-id="A3"'));
  assert.ok(/<option value="high" selected>高<\/option>/.test(html), "A3 は重要度 高");
  assert.ok(html.includes('data-f="memo" data-id="A3" value="納期回答待ち"'));
});

// ---- 表示スイッチ（Task 12） ----
test("renderGantt: showActual:false で .gact と凡例の実績が消える（true では従来どおり）", () => {
  const d = load();
  const on = gantt(d, ["A", "B"]);
  assert.ok(count(on, /class="gact"/g) > 0 && on.includes("実績(最初の作業日"));
  const off = gantt(d, ["A", "B"], { showActual: false });
  assert.equal(count(off, /class="gact"/g), 0);
  assert.ok(!off.includes("実績(最初の作業日"));
  assert.equal(count(gantt(d, ["A", "B"], { showActual: true }), /class="gact"/g), count(on, /class="gact"/g));
});

test("renderProjects/renderSchedule: showPrio:false で『今日の優先』が出ず、cols に one が付く", () => {
  const d = load();
  const p = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", showPrio: false });
  assert.ok(!p.includes('id="h-rk"') && p.includes('class="cols one"'), "パネル（見出し h-rk）が出ない。取っ手の名前には「今日の優先」が入る");
  const s = sched(d, { showPrio: false });
  assert.ok(!s.includes('id="h-rk"') && s.includes('class="cols one"'));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes('id="h-rk"'), "既定で開いている");
  assert.ok(sched(d).includes('id="h-rk"'), "既定で開いている");
});

// ---- 大項目・中項目（Task 13） ----
const noGroups = () => { const d = load(); for (const t of d.tasks) { delete t.group; delete t.subgroup; } return d; };

test("リスト: 大項目・中項目の入力欄と、設定したラベル名の見出し", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "A", view: "list" });
  assert.ok(html.includes("<th>大項目</th><th>中項目</th>"));
  assert.ok(html.includes('data-f="group" data-id="A1"') && html.includes('value="設計"'));
  assert.ok(html.includes('data-f="subgroup" data-id="A3"') && html.includes('value="機器選定"'));
  d.settings.labels = { group: "フェーズ", subgroup: "作業群" };
  const h2 = renderProjects(d, TODAY, { filter: "A", view: "list" });
  assert.ok(h2.includes("<th>フェーズ</th><th>作業群</th>"));
});

test("renderGantt: g-grp の区切り行が group ごとに出る。「（なし）」も常に出す", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  assert.equal(count(html, /class="g-row g-grp"/g), 5, "4 グループ＋追加の入口の「（なし）」");
  assert.ok(html.includes("調達") && html.includes("▸ 機器選定"));
  assert.ok(html.indexOf("設計") < html.indexOf('data-gt="A1"') && html.indexOf('data-gt="A1"') < html.indexOf("調達"));
  const head = /class="g-row g-grp"/g;
  assert.equal(count(gantt(noGroups(), ["A"]), head), 1, "編集画面は「（なし）」だけ出る");
});

const rowOrder = (html) => [...html.matchAll(/<tr data-row="([^"]+)"/g)].map((m) => m[1]);
const listOf = (d, pid, extra = {}) => renderProjects(d, TODAY, { filter: pid, view: "list", ...extra });

test("リスト: 大項目・中項目ごとの見出し行があり、同じグループのタスクが続けて並ぶ", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b"], ["C3", "X", "c"]]);
  const html = listOf(d, "C");
  assert.deepEqual(rowOrder(html), ["C1", "C3", "C2"]);
  assert.equal(count(html, /class="grp-tr"/g), 4, "X/a, X/c, Y/b と、追加の入口の（なし）");
  assert.ok(html.includes('data-addat="C" data-ag="X" data-asg="a"'));
});

test("リスト: 最下部の「＋ タスクを追加」ボタンはない", () => {
  assert.ok(!listOf(load(), "A").includes("data-addtask"));
});

test("リスト: 0件のプロジェクトにも「（なし）」見出しと「＋」が出る", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "C");
  const html = listOf(d, "C");
  assert.ok(html.includes("（なし）") && html.includes('data-addat="C"'));
});

test("リスト: 大項目名の特殊文字は escape され、「＋」の属性に入る", () => {
  const g = 'A"<b>|';
  const html = listOf(setC(load(), [["C1", g, "a"]]), "C");
  assert.ok(html.includes('data-ag="A&quot;&lt;b&gt;|"'));
  assert.ok(!html.includes(g));
});

test("ガント: 編集画面の凡例は上端（固定の帯）にある", () => {
  const top = gantt(load(), ["A"]);
  assert.ok(top.indexOf('class="gtop"') >= 0 && top.indexOf('class="gtop"') < top.indexOf('class="legend"'));
  assert.ok(top.indexOf('class="legend"') < top.indexOf('class="gscroll"'), "凡例が表より前");
  assert.equal(count(top, /class="legend"/g), 1);
});

test("今日の優先のパネルは、固定表示のための prio クラスを持つ（プロジェクト画面・スケジュール画面）", () => {
  assert.ok(renderProjects(load(), TODAY, { filter: "all", view: "list" }).includes('<section class="panel prio"'));
  assert.ok(sched(load()).includes('<section class="panel prio"'));
});

test("プロジェクト画面のフィルタ行は、固定表示のための ptool クラスを持つ", () => {
  for (const view of ["gantt", "list"]) assert.ok(renderProjects(load(), TODAY, { filter: "all", view, window: "m6" }).includes('<div class="toolbar ptool">'), view);
});

const sections = (html) => [...html.matchAll(/<section class="pg" aria-label="([^"]*)"/g)].map((m) => m[1]);
const NAMES = { A: "本社コアSW更改", B: "拠点B 回線増設", C: "VPN 断続切断の対処" };

test("ガント: 完了を隠すと、状態が「完了」のプロジェクトと、タスクが全部 Done のプロジェクトも隠れる", () => {
  const d = load();
  d.projects.find((p) => p.id === "B").status = "完了";
  for (const t of d.tasks.filter((x) => x.projectId === "C")) t.status = "Done";
  assert.deepEqual(sections(gantt(d, ["A", "B", "C"])), [NAMES.A, NAMES.B, NAMES.C], "隠さないときは全部");
  assert.deepEqual(sections(gantt(d, ["A", "B", "C"], { hideDone: true })), [NAMES.A]);
});

test("ガント: 1 つのプロジェクトを選んでいるときは、完了していても完了を隠すで消さない", () => {
  const d = load(); d.projects.find((p) => p.id === "B").status = "完了";
  assert.deepEqual(sections(gantt(d, ["B"], { hideDone: true })), [NAMES.B]);
});

test("ガント: 全プロジェクトが隠れても、「完了を隠す」の切り替えは残り、理由を出す", () => {
  const d = load(); for (const p of d.projects) p.status = "完了";
  const html = gantt(d, ["A", "B", "C"], { hideDone: true });
  assert.ok(html.includes("data-hidedone") && html.includes("完了したプロジェクトを隠しています"));
  assert.deepEqual(sections(html), []);
});

test("今日の優先: どのプロジェクトのタスクかを、項目の先頭の見出しで示す（プロジェクト画面・スケジュール画面）", () => {
  const d = load();
  for (const sched of [false, true]) {
    const html = renderPrio(d, TODAY, { sched });
    assert.ok(count(html, /<span class="pj">/g) >= 1, `sched=${sched}`);
    assert.ok([...html.matchAll(/<span class="pj">([^<]*)<\/span>/g)].every((m) => Object.values(NAMES).includes(m[1])));
  }
  assert.ok(!renderPrio(d, TODAY, { sched: false }).includes(" ・ "), "説明文に重複して出さない");
});

test("利用者入力（group 名）はエスケープされる", () => {
  const d = load(); d.tasks.find((t) => t.id === "A1").group = "<img src=x onerror=1>";
  const html = renderProjects(d, TODAY, { filter: "A", view: "gantt", window: "m6" }) + renderProjects(d, TODAY, { filter: "A", view: "list" });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

// ---- 会議のプロジェクトと確認（Task 14） ----
const NOW15 = { date: "2026-10-20", time: "15:10" };
const noSessions = () => { const d = load(); for (const t of d.tasks) t.sessions = []; return d; };

test("会議ブロック: 過ぎて未確認なら unconf と『実績にする』ボタン（日表示のみ）。確認済みは ✓。skip は従来の表示で確認ボタンなし", () => {
  const d = noSessions();
  d.events.find((e) => e.id === "m3").date = "2026-10-20";
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(/class="blk mtg\s+act[^"]*"[^>]*data-mtg="m1"/.test(html) && html.includes("09:30-10:30 ✓"), "確認済み");
  assert.ok(/class="blk mtg\s+unconf[^"]*"[^>]*data-mtg="m2"/.test(html) && html.includes('data-confirmmtg="m2"'), "未確認");
  const wk = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW15 });
  assert.ok(!wk.includes("data-confirmmtg"), "週表示にはボタンを出さない");
  d.events.find((e) => e.id === "m2").skip = true;
  const sk = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, showSkipped: true });
  assert.ok(sk.includes("blk mtg skip") && !sk.includes('data-confirmmtg="m2"'));
});

test("renderSchedule: 参加しない会議は、showSkipped が true のときだけ描く。凡例・ボタンの状態もそれに合わせ、空き時間は変わらない", () => {
  const d = load();
  d.events.find((e) => e.id === "m2").skip = true;
  for (const view of ["day", "week"]) {
    const hide = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW });
    const show = renderSchedule(d, TODAY, { view, date: TODAY, now: NOW, showSkipped: true });
    assert.ok(!hide.includes("blk mtg skip") && !hide.includes('data-mtg="m2"'), `${view}: 既定は描かない`);
    assert.ok(hide.includes('data-mtg="m1"'), `${view}: 参加する会議は描く`);
    assert.ok(!hide.includes("skipsw") && /data-sskip aria-pressed="false"/.test(hide), `${view}: 凡例を出さず、ボタンは押していない`);
    assert.ok(show.includes("blk mtg skip") && show.includes("skipsw") && /data-sskip aria-pressed="true"/.test(show), `${view}: 出すとき`);
  }
  const freeOf = (data, o) => (renderSchedule(data, TODAY, { view: "day", date: TODAY, now: NOW, ...o }).match(/data-free="\d+"/g) ?? []).join();
  const joined = load(); // 同じ会議を「参加する」にしたとき（空き時間はこちらが狭い）
  assert.notEqual(freeOf(d, {}), "", "空き時間が出る日で確かめている");
  assert.notEqual(freeOf(d, {}), freeOf(joined, {}), "参加しない会議は、空き時間として扱う（参加する会議だと空きが変わる）");
  assert.equal(freeOf(d, {}), freeOf(d, { showSkipped: true }), "空き時間は表示の切り替えで変わらない");
  const sel = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, selMtg: "m2" });
  assert.ok(sel.includes('data-mtg="m2"') && sel.includes("sel"), "選択中の参加しない会議は、隠していても出す（見えない会議を削除・編集しないため）");
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, selMtg: "m1" }).includes('data-mtg="m2"'), "ほかの会議を選んでいるときは、隠したまま");
});

test("会議ブロック: プロジェクト名と（規則|手動）を日表示に出す。未設定は『プロジェクト未設定』", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(html.includes("プロジェクト: 本社コアSW更改（規則）"));
  assert.ok(html.includes("プロジェクト未設定"));
  d.events.find((e) => e.id === "m2").projectId = "B"; d.events.find((e) => e.id === "m2").projectBy = "manual";
  assert.ok(renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 }).includes("プロジェクト: 拠点B 回線増設（手動）"));
});

test("会議フォーム: プロジェクト選択があり、mcp の会議でも disabled でない（件名は disabled のまま）。先頭の選択肢は規則で付く名前", () => {
  const d = noSessions();
  const mcp = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1" });
  const sel = /<select[^>]*data-mt="projectId"[^>]*>/.exec(mcp)?.[0];
  assert.ok(sel, "プロジェクト選択");
  assert.ok(!/disabled/.test(sel));
  assert.ok(/<input[^>]*data-mt="title"[^>]*disabled/.test(mcp));
  assert.ok(mcp.includes("プロジェクトは、規則で自動に付き"));
  const manual = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.ok(manual.includes("自動（規則）→ 本社コアSW更改"));
  assert.ok(mcp.includes("自動（規則）→ 未設定"));
  d.events.find((e) => e.id === "m2").projectId = "B"; d.events.find((e) => e.id === "m2").projectBy = "manual";
  const chosen = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.ok(/<option value="B" selected>/.test(chosen));
});

test("サマリー: 未確認の会議も件数に入り（内訳つき）、0 件のときは data-confirmall が出ない。凡例に未確認の会議", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(html.includes("未確認 1件（作業枠 0・会議 1）") && html.includes("data-confirmall"));
  assert.ok(html.includes("未確認の会議"));
  d.events.find((e) => e.id === "m2").confirmed = true;
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 }).includes("data-confirmall"));
});

// ---- 見送った Minor の修正: 日程変更の履歴に、取り込みの記録を出さない ----
test("日程変更の履歴: 取り込み（source があり、日数が 0）の記録は出さず、取り込みによる期限の変更（日数あり）は出す", () => {
  const d = load();
  d.changeLog.push(
    { at: "2026-10-20", taskIds: ["A4"], reason: "WBS 取り込み: 追加 3 件", cause: null, deltaDays: 0, source: "wbs" },
    { at: "2026-10-20", taskIds: ["A4"], reason: "受信箱: 着手", cause: null, deltaDays: 0, source: "inbox" },
    { at: "2026-10-20", taskIds: ["A4"], reason: "受信箱: 納期延期", cause: "ベンダー", deltaDays: 5, source: "inbox" },
  );
  for (const html of [renderProjects(d, TODAY, { filter: "A", view: "list" })]) {
    assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
    assert.ok(html.includes("受信箱: 納期延期"));
    assert.ok(!html.includes("WBS 取り込み: 追加 3 件") && !html.includes("受信箱: 着手"));
  }
});

// ---- 設定タブ ----
const setv = (d, o = {}) => renderSettings(d, TODAY, o);

test("設定: キーワード規則の一覧（キーワード・プロジェクトの選択・件数・削除）と追加の行、会議名の旨", () => {
  const d = load();
  const html = setv(d);
  assert.ok(html.includes("キーワード規則（会議名）"));
  assert.ok(html.includes('data-rkw="ベンダーX"') && html.includes('value="ベンダーX"'));
  assert.ok(html.includes('data-rpj="ベンダーX"') && /<option value="A" selected>/.test(html));
  assert.ok(html.includes('data-rdel="ベンダーX"'));
  assert.ok(html.includes(`>${ruleMeetingCounts(d)[0]} 件</td>`), "いま付いている会議の件数");
  assert.ok(html.includes("data-rnew") && html.includes("data-rnewpj") && html.includes("data-radd"));
  assert.ok(html.includes("手動で付けた会議"));
});

test("設定: 規則が 0 件でも追加の行が出る。ruleError を出す", () => {
  const d = load(); d.settings.projectRules = [];
  const html = setv(d, { ruleError: "キーワードを入力してください" });
  assert.ok(html.includes("規則はありません") && html.includes("data-radd") && html.includes("キーワードを入力してください"));
});

test("設定: キーワードの特殊文字は escape される。プロジェクトが消えた規則は「不明」と出て落ちない", () => {
  const d = load(); d.settings.projectRules = [{ keyword: 'a"<b>&', projectId: "A" }, { keyword: "古い", projectId: "ZZ" }];
  const html = setv(d);
  assert.ok(html.includes('data-rkw="a&quot;&lt;b&gt;&amp;"') && !html.includes('a"<b>&'));
  assert.ok(html.includes("不明") && html.includes('data-rdel="古い"'));
});

test("設定: WBS の取り込み記録（ファイル名・日付・件数）。ファイル名なしは「（不明）」、記録なしは「記録なし」", () => {
  const d = load();
  d.settings.wbsImports = { A: { file: "plan.xlsx", at: "2026-10-20", added: 3, updated: 1 }, B: { file: null, at: "2026-10-18", added: 0, updated: 2 } };
  const html = setv(d);
  assert.ok(html.includes("plan.xlsx") && html.includes("2026-10-20") && html.includes("（不明）") && html.includes("記録なし"));
  assert.equal(count(html, /記録なし/g), 1, "記録のあるプロジェクトには出ない（C だけ）");
  const none = setv(load());
  assert.equal(count(none, /記録なし/g), 3);
  const empty = { ...load(), projects: [], tasks: [], events: [] };
  assert.ok(setv(empty).includes("プロジェクトがありません"));
});

// ---- 受信箱の帯と引き出し ----
const NOW_MS = Date.parse("2026-10-21T10:01:00.000Z");
const T0 = "2026-10-21T10:00:00.000Z";
const reqOf = (id, status, extra = {}) => ({ id, at: T0, projectId: "A", status, thread: [{ role: "user", at: T0, text: `依頼 ${id}` }], proposal: null, result: null, ...extra });
const PROPOSAL = {
  summary: "3 種類の変更案", reason: "ベンダーX の納期回答が遅れた", cause: "ベンダー",
  ops: [{ op: "moveDue", taskId: "A3", deltaDays: 45 }],
  warnings: ["本社コアSW更改の期限（2027-03-31）を超えます（最後のタスクは 2027-04-10）"],
  sections: [
    { kind: "add", rows: [{ ref: "t1", title: "疎通確認テスト", projectId: "A", group: "構築", subgroup: "検証環境", due: "2026-12-10", start: "2026-10-21", predecessors: ["A4"] }] },
    { kind: "due", rows: [{ taskId: "A3", title: "機器の発注（ベンダーX）", oldDue: "2026-10-16", newDue: "2026-11-30", reason: "指定（+45日）" }] },
  ],
};
const withInbox = (requests, watching = null) => { const d = load(); d.inbox = { watching, requests }; return d; };
const UI = (o = {}) => ({ open: false, canWrite: true, nowMs: NOW_MS, text: "", projectId: "", replies: {}, reasons: {}, causes: {}, ...o });
const ib = (d, o) => renderInboxBar(d, UI(o));

test("受信箱の帯（閉じている）: 見出し・開閉・状態（見ています／見ていません）・提案の印。入力欄は出さない", () => {
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })], { at: "2026-10-21T10:00:30.000Z" }));
  assert.ok(html.includes("data-ib-toggle") && html.includes("Claude Code に依頼する"));
  assert.ok(html.includes("見ています") && !html.includes("見ていません"));
  assert.ok(html.includes("提案が 1 件届いています"));
  assert.ok(!html.includes("data-ib-send") && !html.includes("data-ib-text"));
  const off = ib(withInbox([], { at: "2026-10-21T09:58:00.000Z" }));
  assert.ok(off.includes("見ていません") && !off.includes("提案が"));
  assert.ok(ib(withInbox([])).includes("見ていません"), "印なし");
});

test("受信箱の引き出し（開いている）: 対象の選択・書き方の例・入力（下書きを保つ）・送信。見ていないときは /project-board:watch を案内", () => {
  const html = ib(withInbox([]), { open: true, text: "A3 が 5 日遅れた", projectId: "B" });
  assert.ok(html.includes("data-ib-send") && html.includes("data-ib-text") && html.includes(">A3 が 5 日遅れた</textarea>"));
  assert.ok(/<select[^>]*data-ib-project/.test(html) && html.includes('<option value="">すべて</option>') && /<option value="B" selected>/.test(html));
  for (const k of ["due", "add"]) assert.ok(html.includes(`data-ib-example="${k}"`), k);
  assert.ok(html.includes("/project-board:watch"));
  assert.ok(!ib(withInbox([], { at: "2026-10-21T10:00:50.000Z" }), { open: true }).includes("/project-board:watch"), "見ているときは案内しない");
  assert.ok(html.includes("まだ依頼はありません"));
});

test("受信箱の履歴: 新しい順に、状態（送信済み・処理中・聞き返し・提案・反映済み・却下・失敗）を出す", () => {
  const reqs = [reqOf("R1", "applied", { result: { at: T0, by: "html", summary: "期限 1 件を反映しました" } }), reqOf("R2", "rejected"), reqOf("R3", "pending"), reqOf("R4", "working"), reqOf("R5", "question", { thread: [{ role: "user", at: T0, text: "依頼 R5" }, { role: "claude", at: T0, text: "どのプロジェクトですか" }] }), reqOf("R6", "proposed", { proposal: PROPOSAL }), reqOf("R7", "failed", { thread: [{ role: "user", at: T0, text: "依頼 R7" }, { role: "claude", at: T0, text: "提案のあとにデータが変わりました" }] })];
  const html = ib(withInbox(reqs), { open: true });
  const order = [...html.matchAll(/data-ib-req="(R\d)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["R7", "R6", "R5", "R4", "R3", "R2", "R1"]);
  for (const w of ["反映済み", "却下", "送信済み", "処理中", "聞き返しがあります", "提案があります", "失敗", "期限 1 件を反映しました"]) assert.ok(html.includes(w), w);
});

test("提案のカード: 期限・登録の表、警告、理由・原因の入力、承認・修正の依頼・却下", () => {
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })]), { open: true, reasons: { R1: "手で直した理由" }, causes: { R1: "社内" } });
  assert.ok(html.includes("疎通確認テスト") && html.includes("構築") && html.includes("検証環境") && html.includes("2026-12-10") || html.includes("12/10"));
  assert.ok(html.includes("A3") && html.includes("機器の発注（ベンダーX）") && html.includes("10/16") && html.includes("11/30") && html.includes("指定（+45日）"));
  assert.ok(html.includes("2027-04-10"), "警告");
  assert.ok(html.includes('data-ib-reason="R1"') && html.includes('value="手で直した理由"'));
  assert.ok(/<option selected>社内<\/option>/.test(html) || /<option[^>]*selected[^>]*>社内</.test(html));
  for (const a of ['data-ib-approve="R1"', 'data-ib-reply="R1"', 'data-ib-replysend="R1"', 'data-ib-reject="R1"']) assert.ok(html.includes(a), a);
  const dflt = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })]), { open: true });
  assert.ok(dflt.includes('value="ベンダーX の納期回答が遅れた"'), "理由の既定は提案の理由");
});

test("聞き返し・失敗: 質問と返信欄、再提案のボタン", () => {
  const q = reqOf("R1", "question", { thread: [{ role: "user", at: T0, text: "依頼" }, { role: "claude", at: T0, text: "どのプロジェクトですか" }] });
  const f = reqOf("R2", "failed", { thread: [{ role: "user", at: T0, text: "依頼" }, { role: "claude", at: T0, text: "提案のあとにデータが変わりました" }] });
  const html = ib(withInbox([q, f]), { open: true, replies: { R1: "A です" } });
  assert.ok(html.includes("どのプロジェクトですか") && html.includes('data-ib-reply="R1"') && html.includes('value="A です"') && html.includes('data-ib-replysend="R1"'));
  assert.ok(html.includes("提案のあとにデータが変わりました") && html.includes('data-ib-retry="R2"') && html.includes("もう一度提案してもらう"));
  assert.ok(!html.includes('data-ib-approve'));
});

test("受信箱: 直接保存に対応しない環境では、理由を出して、開閉・入力・送信を出さない", () => {
  const html = ib(withInbox([]), { open: true, canWrite: false });
  assert.ok(html.includes("ファイルへの直接保存が必要です"));
  assert.ok(!html.includes("data-ib-toggle") && !html.includes("data-ib-send") && !html.includes("data-ib-text"));
});

test("受信箱: 依頼・質問・提案の文字は escape される。inbox が無いデータでも落ちない", () => {
  const evil = '<img src=x onerror=1>"&';
  const p = { ...PROPOSAL, summary: evil, warnings: [evil], sections: [{ kind: "add", rows: [{ ref: "t", title: evil, projectId: "A", group: evil, subgroup: null, due: "2026-12-10", start: null, predecessors: [] }] }] };
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: p, thread: [{ role: "user", at: T0, text: evil }, { role: "claude", at: T0, text: evil }] })]), { open: true, text: evil });
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x"));
  assert.doesNotThrow(() => ib(load(), { open: true }));
  assert.doesNotThrow(() => ib(load()));
});

test("受信箱の提案カード: 登録の行に 1 始まりの行番号（data-row）が出る", () => {
  const rows = [
    { ref: "t1", title: "機器の発注", projectId: "A", group: null, subgroup: null, due: "2026-11-03", businessDays: 14, start: "2026-10-21", predecessors: [] },
    { ref: "t2", title: "納品確認", projectId: "A", group: null, subgroup: null, due: "2026-11-08", businessDays: 5, start: null, predecessors: ["t1"] },
  ];
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections: [{ kind: "add", rows }] } })]), { open: true });
  assert.ok(html.includes('data-row="1"') && html.includes('data-row="2"') && !html.includes('data-row="3"'));
});

const cardOf = (sections) => ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections } })]), { open: true });

test("受信箱の履歴: 処理待ち・処理中でも、2 件目以降のやりとり（修正の依頼）を出す。依頼文は 1 回だけ", () => {
  for (const status of ["pending", "working"]) {
    const thread = [{ role: "user", at: T0, text: "最初の依頼文" }, { role: "claude", at: T0, text: "提案の要約です" }, { role: "user", at: T0, text: "3 行目を 10 日にして" }];
    const html = ib(withInbox([reqOf("R1", status, { thread })]), { open: true });
    assert.ok(html.includes("3 行目を 10 日にして") && html.includes("提案の要約です"), status);
    assert.equal(count(html, /最初の依頼文/g), 1, status);
  }
});

// ---- 今日のタスク（着手・完了・状態） ----
const withToday = () => {
  const d = load();
  const T = (id) => d.tasks.find((t) => t.id === id);
  T("A7").sessions.push({ id: "S10", date: TODAY, start: "14:00", end: "15:00", kind: "planned" }); // To Do
  T("A5").sessions.push({ id: "S9", date: TODAY, start: "11:00", end: "12:00", kind: "planned" }); // In Progress（遅い開始の A7 より前）
  const done = d.tasks.find((t) => t.status === "Done");
  done.sessions = [...(done.sessions ?? []), { id: "S11", date: TODAY, start: "09:30", end: "10:00", kind: "actual" }];
  return { d, done };
};
const items = (html) => [...html.matchAll(/<li[^>]*data-today="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], html: m[2] }));

test("todayTaskIds・renderTodayTasks: 今日に枠があるタスクだけを、最初の枠の開始順に出す。Done は薄く、ボタン無しで末尾。枠が無ければ空", () => {
  const { d, done } = withToday();
  assert.deepEqual(todayTaskIds(d, TODAY).sort(), ["A5", "A7", done.id].sort());
  const html = renderTodayTasks(d, TODAY);
  assert.deepEqual(items(html).map((x) => x.id), ["A5", "A7", done.id], "Done は末尾（開始は一番早くても）");
  const [a5, a7, dn] = items(html);
  assert.ok(a5.html.includes("In Progress") && a5.html.includes("11:00–12:00"), "状態と今日の枠の時間");
  assert.ok(a5.html.includes('data-setstatus="A5|Done"') && !a5.html.includes('data-setstatus="A5|In Progress"'), "着手中は完了だけ");
  assert.ok(a7.html.includes('data-setstatus="A7|In Progress"') && a7.html.includes('data-setstatus="A7|Done"'), "To Do は着手・完了が同じ行");
  assert.ok(!dn.html.includes("data-setstatus") && html.includes('class="closed"'), "Done はボタン無しで薄い");
  assert.equal(renderTodayTasks(load(), TODAY), "", "今日の枠が無ければ出さない");
  assert.deepEqual(todayTaskIds(load(), TODAY), []);
});

test("renderTodayTasks: 複数の枠は時間を並べる。pendingDone の行にだけ確認（data-doneok / data-doneno）を出す", () => {
  const { d } = withToday();
  d.tasks.find((t) => t.id === "A5").sessions.push({ id: "S12", date: TODAY, start: "16:00", end: "17:00", kind: "planned" });
  const html = renderTodayTasks(d, TODAY, { pendingDone: { id: "A5", status: "Done", n: 1, future: ["S3"] } });
  assert.ok(items(html)[0].html.includes("11:00–12:00") && items(html)[0].html.includes("16:00–17:00"));
  assert.ok(items(html)[0].html.includes('data-doneok="A5"') && items(html)[0].html.includes("未来の予定の枠 1 件"));
  assert.equal(count(html, /data-doneok=/g), 1);
});

test("renderPrio: 今日のタスクに入ったタスクは出さない（プロジェクト画面は残りから 4 件）。行に状態の pill があり、ボタンは無い", async () => {
  const { rankTasks } = await import("../plugins/project-board/src/core/schedule.js");
  const { d } = withToday();
  const base = rankTasks(d, TODAY).map((r) => r.taskId);
  const inToday = new Set(todayTaskIds(d, TODAY));
  assert.ok(base.some((id) => inToday.has(id)), "検査: 優先に並ぶタスクが今日のタスクに入っている");
  const full = renderPrio(d, TODAY, { sched: true });
  const ids = [...full.matchAll(/data-pick="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, base.filter((id) => !inToday.has(id)));
  assert.ok(!full.includes("data-setstatus") && full.includes('class="pill'), "ボタン無し・状態 pill");
  assert.equal(count(renderPrio(d, TODAY, { sched: false }), /<li/g), Math.min(4, ids.length), "上位 4 件も除いたうえで");
  const all = load();
  for (const t of all.tasks) t.sessions = [{ id: "S" + t.id, date: TODAY, start: "09:00", end: "09:15", kind: "planned" }];
  assert.ok(renderPrio(all, TODAY, { sched: true }).includes("優先するタスクはありません") && !renderPrio(all, TODAY, { sched: true }).includes("<ol"));
});

test("今日のタスクは、スケジュール・プロジェクトの両方の右パネルに出る（showPrio:false なら出ない）。pendingDone の確認はパネル内で、カレンダー側には出ない", () => {
  const { d } = withToday();
  const pd = { id: "A5", status: "Done", n: 1, future: ["S3"] };
  for (const html of [sched(d, { pendingDone: pd }), renderProjects(d, TODAY, { filter: "all", view: "list", pendingDone: pd })]) {
    assert.ok(html.includes('id="h-td"') && html.includes('data-today="A5"'));
    assert.ok(html.indexOf('id="h-td"') < html.indexOf('id="h-rk"'), "優先の上（取っ手の名前にも文字が入るので、見出しの id で見る）");
  }
  assert.equal(count(sched(d, { pendingDone: pd }), /data-doneok=/g), 1);
  assert.ok(!sched(d, { showPrio: false }).includes('id="h-td"'));
  assert.ok(!renderProjects(d, TODAY, { filter: "all", view: "list", showPrio: false }).includes('id="h-td"'));
  // 今日のタスクに居ないタスク（リストの select から押した）の確認は、リストの行に出る
  const other = renderProjects(d, TODAY, { filter: "all", view: "list", pendingDone: { id: "A1", status: "Done", n: 1, future: ["S3"] } });
  assert.equal(count(other, /data-doneok="A1"/g), 1);
});

test("renderSchedule: 作業枠のブロックに着手・完了ボタンは無く、日表示では状態の文字が出る。カレンダー上部の確認（doneAsk）は無い", () => {
  const { d } = withToday();
  const day = sched(d, { showPrio: false });
  const blocks = [...day.matchAll(/<div class="blk task[\s\S]*?<\/div>/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 2 && blocks.every((b) => !b.includes("data-setstatus")));
  assert.ok(blocks.some((b) => b.includes("着手中")) && blocks.some((b) => b.includes("未着手")) && blocks.some((b) => b.includes("完了")), "各ブロックに状態の文字");
  assert.ok(!renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false }).includes("data-setstatus"));
  assert.ok(!sched(d, { showPrio: false, pendingDone: { id: "A5", status: "Done", n: 1, future: ["S3"] } }).includes("data-doneok"), "パネルを出さないときはカレンダー側にも出ない");
});

// ---- 設定タブ: 基本の設定と規則の並べ替え ----
const setTag = (html, name) => (html.match(new RegExp(`<input[^>]*data-set="${name}"[^>]*>`)) ?? [""])[0];

test("設定タブ: 基本の設定の入力。settings が無ければ既定値、あればその値。会議の件名の既定は、画面では変えない", () => {
  const none = load();
  delete none.settings;
  const html = setv(none);
  assert.ok(setTag(html, "workday-start").includes('value="09:00"') && setTag(html, "workday-end").includes('value="18:00"'));
  assert.ok(setTag(html, "waitingLongDays").includes('value="7"'));
  assert.ok(setTag(html, "label-group").includes('value="大項目"') && setTag(html, "label-subgroup").includes('value="中項目"'));
  const set = load();
  set.settings = { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: "フェーズ" } };
  const h2 = setv(set);
  assert.ok(setTag(h2, "workday-start").includes('value="08:30"') && setTag(h2, "workday-end").includes('value="17:30"'));
  assert.ok(setTag(h2, "waitingLongDays").includes('value="3"') && setTag(h2, "label-group").includes('value="フェーズ"') && setTag(h2, "label-subgroup").includes('value="中項目"'));
  assert.ok(!h2.includes("settings.workday:"), "正しい値に注意は出ない");
});

test("設定タブ: workday が不正なファイルでも描画でき、入力欄には既定値、横に注意の文言が出る", () => {
  const d = load();
  d.settings = { ...d.settings, workday: { start: "9:00", end: "18:00" }, waitingLongDays: "7" };
  const html = setv(d);
  assert.ok(setTag(html, "workday-start").includes('value="09:00"'));
  assert.ok(setTag(html, "waitingLongDays").includes('value="7"'));
  assert.ok(html.includes("settings.workday:") && html.includes("settings.waitingLongDays:"));
});

test("設定タブ: 規則の↑↓。先頭の↑と末尾の↓は無効", () => {
  const d = load();
  d.settings = { ...d.settings, projectRules: [{ keyword: "r1", projectId: "A" }, { keyword: "r2", projectId: "B" }, { keyword: "r3", projectId: "A" }] };
  const html = setv(d);
  const btn = (kw, delta) => html.match(new RegExp(`<button[^>]*data-rmove="${kw}\\|${delta}"[^>]*>`))?.[0] ?? "";
  assert.ok(btn("r1", -1).includes("disabled") && btn("r3", 1).includes("disabled"));
  for (const [kw, delta] of [["r1", 1], ["r2", -1], ["r2", 1], ["r3", -1]]) assert.ok(btn(kw, delta) && !btn(kw, delta).includes("disabled"), `${kw}|${delta}`);
});

const NHOL = { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-01-01", name: "元日" }, { date: "2026-11-03", name: "文化の日" }, { date: "2026-11-23", name: "勤労感謝の日" }] };
const withSet = (o) => { const d = load(); d.settings = { ...d.settings, ...o }; return d; };

test("設定: 「日本の祝日」の節。未取得は案内、取得済みは取得日・件数・範囲と、今日以降の祝日だけ（読み取り専用）", () => {
  const none = setv(load());
  assert.ok(none.includes("日本の祝日") && none.includes("まだ取得していません") && none.includes("自動で更新") && !none.includes("/project-board:holidays"));
  const html = setv(withSet({ nationalHolidays: NHOL }));
  assert.ok(html.includes("2026-10-25") && html.includes("3 件") && html.includes("2026-01-01") && html.includes("2026-11-23"), "取得日・件数・範囲");
  assert.ok(html.includes("文化の日") && html.includes("勤労感謝の日"));
  assert.ok(!html.includes("元日"), "今日（10/20）より前は一覧に出さない");
});

test("設定: 「休み（手動）」の節。開始日・終了日・区分・メモの入力、登録済みを昇順で区分とメモつきに出し、区分の変更と削除ができる", () => {
  const html = setv(withSet({ holidays: [{ date: "2026-11-23", kind: "祝日" }, { date: "2026-10-26", kind: "有給", note: "通院" }] }));
  assert.ok(html.includes("休み（手動）"));
  for (const a of ["data-hnew", "data-hto", "data-hkind", "data-hnote", "data-hadd"]) assert.ok(html.includes(a), a);
  assert.deepEqual([...html.matchAll(/<option[^>]*>(祝日|有給|その他)<[/]option>/g)].slice(0, 3).map((m) => m[1]), ["祝日", "有給", "その他"], "追加の区分の選択肢");
  const i = html.indexOf('data-hdel="2026-10-26"'), j = html.indexOf('data-hdel="2026-11-23"');
  assert.ok(i > 0 && j > i, "昇順");
  assert.match(html, /<select[^>]*data-hrowkind="2026-10-26"[^>]*>[^]*?<option selected>有給<[/]option>/);
  assert.ok(html.includes("通院"));
  assert.ok(setv(load()).includes("休みは登録されていません"));
});

test("設定: 「営業日として扱う日」の節。入力と一覧（昇順・削除）と説明", () => {
  const html = setv(withSet({ workdays: [{ date: "2026-11-28", note: "休日出勤" }, { date: "2026-10-31" }] }));
  assert.ok(html.includes("営業日として扱う日") && html.includes("営業日として数えます"));
  for (const a of ["data-wnew", "data-wnote", "data-wadd"]) assert.ok(html.includes(a), a);
  assert.ok(html.indexOf('data-wdel="2026-10-31"') > 0 && html.indexOf('data-wdel="2026-10-31"') < html.indexOf('data-wdel="2026-11-28"'));
  assert.ok(html.includes("休日出勤"));
});

test("設定: 休み・営業日・日本の祝日の値が壊れていても描画でき、注意が出る（前版の文字列の配列を含む）", () => {
  for (const o of [{ holidays: "x" }, { holidays: ["2026-10-26"] }, { holidays: [null, { date: 5 }] }, { workdays: [null] }, { workdays: "x" }, { nationalHolidays: 5 }, { nationalHolidays: { dates: "x" } }, { nationalHolidays: { fetchedAt: "2026-10-25", dates: [null] } }]) {
    const d = withSet(o);
    let html;
    assert.doesNotThrow(() => { html = setv(d); }, JSON.stringify(o));
    assert.ok(html.includes(`settings.${Object.keys(o)[0]}:`), JSON.stringify(o));
  }
});

test("renderSchedule(week): 枠・会議のブロックの時刻は開始–終了（10:00-11:00 形式）", () => {
  const { d } = withToday();
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false });
  assert.ok(html.includes('<span class="tm">11:00-12:00</span>') || html.includes('<span class="tm">11:00-12:00 '), "枠");
  assert.ok(/<span class="tm">\d\d:\d\d-\d\d:\d\d/.test(html.slice(html.indexOf("data-mtg="))), "会議");
});

test("受信箱の提案カード: 登録の表に「営業日」の列（無い行は —）。「修正を依頼する」は暖色のクラス（承認の primary とは別）", () => {
  const rows = [
    { ref: "t1", title: "機器の発注", projectId: "A", group: null, subgroup: null, due: "2026-11-03", businessDays: 14, start: null, predecessors: [] },
    { ref: "t2", title: "納品確認", projectId: "A", group: null, subgroup: null, due: "2026-11-08", businessDays: null, start: null, predecessors: ["t1"] },
  ];
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections: [{ kind: "add", rows }] } })]), { open: true });
  assert.ok(html.includes("<th>営業日</th>"));
  const tr = (n) => html.match(new RegExp(`<tr data-row="${n}">[\\s\\S]*?</tr>`))[0];
  assert.ok(tr(1).includes('<td class="mono">14</td>') && tr(2).includes('<td class="mono">—</td>'));
  assert.match(html, /<button class="btn warm" data-ib-replysend=/);
  assert.match(html, /<button class="btn primary" data-ib-approve=/);
});

test("renderTodayTasks: 枠の時刻はエスケープする", () => {
  const { d } = withToday();
  d.tasks.find((t) => t.id === "A7").sessions[0].start = "<b>x</b>";
  assert.ok(!renderTodayTasks(d, TODAY).includes("<b>x</b>"));
});

test("今日のタスクのパネルは、ヘッダーの日付ラベル用のクラス today を使わない（文字色・大きさが変わるため）", () => {
  const { d } = withToday();
  assert.doesNotMatch(renderTodayTasks(d, TODAY), /class="panel today"/);
});

test("renderSchedule: 休みの日（土日・手動の休み・日本の祝日）は空き時間を出さず weekend 扱い。営業日の指定の日は空きを出す", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }], workdays: [{ date: "2026-10-24" }] };
  const week = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false });
  const col = (date) => week.match(new RegExp(`<div class="col dz[^"]*" data-date="${date}"`))[0];
  const head = (date) => week.match(new RegExp(`data-day="${date}"[^>]*>[^<]*<small class="mono">([^<]*)</small>`))[1];
  assert.match(col("2026-10-22"), /weekend/); // 手動の休み（木）
  assert.match(col("2026-10-25"), /weekend/); // 日曜
  assert.doesNotMatch(col("2026-10-24"), /weekend/, "営業日の指定の土曜");
  assert.equal(head("2026-10-22"), "—");
  assert.equal(head("2026-10-25"), "—");
  assert.match(head("2026-10-24"), /^空き /);
  assert.match(head("2026-10-21"), /^空き /);
  const day = (date) => renderSchedule(d, TODAY, { view: "day", date, now: NOW, showPrio: false });
  assert.ok(!day("2026-10-22").includes('data-free='), "休みの日の日表示に空き枠は出ない");
  assert.ok(day("2026-10-24").includes('data-free='), "営業日の指定の土曜には空き枠が出る");
});

test("受信箱の提案カード: 営業日の列の値もエスケープする（手で書き換えた data.json でも HTML を差し込めない）", () => {
  const rows = [{ ref: "t1", title: "x", projectId: "A", group: null, subgroup: null, due: "2026-11-03", businessDays: "<img src=x onerror=alert(1)>", start: null, predecessors: [] }];
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: { ...PROPOSAL, sections: [{ kind: "add", rows }] } })]), { open: true });
  assert.ok(!html.includes("<img src=x"));
});

test("settingsInputValues: 基本の設定の入力に出す値（形が違う・無い項目は既定値）", async () => {
  const { settingsInputValues } = await import("../plugins/project-board/src/ui/views/settings.js");
  assert.deepEqual(settingsInputValues({}), { workdayStart: "09:00", workdayEnd: "18:00", waitingLongDays: 7, labelGroup: "大項目", labelSubgroup: "中項目" });
  const s = { settings: { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: " フェーズ ", subgroup: "" } } };
  assert.deepEqual(settingsInputValues(s), { workdayStart: "08:30", workdayEnd: "17:30", waitingLongDays: 3, labelGroup: "フェーズ", labelSubgroup: "中項目" });
  for (const bad of [{ workday: { start: "18:00", end: "09:00" } }, { workday: "x" }, { waitingLongDays: 0 }, { waitingLongDays: "3" }]) {
    const v = settingsInputValues({ settings: bad });
    assert.deepEqual([v.workdayStart, v.workdayEnd, v.waitingLongDays], ["09:00", "18:00", 7], JSON.stringify(bad));
  }
});

test("renderSchedule(day): 休みの日（土日・手動の休み・日本の祝日）の日表示には、置けない旨と指定の方法の注意を出す。営業日の指定の日・平日には出さない", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }], workdays: [{ date: "2026-10-24" }] };
  const day = (date) => renderSchedule(d, TODAY, { view: "day", date, now: NOW, showPrio: false });
  for (const off of ["2026-10-22", "2026-10-25"]) {
    const h = day(off);
    assert.ok(h.includes("この日は休みです") && h.includes("営業日として扱う日"), off);
  }
  for (const ok of ["2026-10-21", "2026-10-24"]) assert.ok(!day(ok).includes("この日は休みです"), ok);
});

test("renderSchedule(day): 日本の祝日の日表示にも注意が出る。週表示には出ない", () => {
  const d = load();
  d.settings = { ...d.settings, nationalHolidays: { fetchedAt: "2026-10-20", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] } };
  assert.ok(renderSchedule(d, TODAY, { view: "day", date: "2026-11-03", now: NOW, showPrio: false }).includes("この日は休みです"));
  assert.ok(!renderSchedule(d, TODAY, { view: "week", date: "2026-11-03", now: NOW, showPrio: false }).includes("この日は休みです"));
});

// ---- 営業日の数え方（settings.countWeekendsAndHolidays） ----
test("設定: 「営業日の数え方」は基本の設定の表の先頭の行にあり、土日祝を営業日に数えるスイッチはオフが既定", () => {
  const html = setv(load());
  assert.ok(!html.includes('id="h-count"'), "独立した節は無い");
  assert.ok(html.includes("営業日の数え方"));
  assert.match(html, /<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/);
  assert.doesNotMatch(html.match(/<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/)[0], /checked/);
  assert.ok(html.includes("土日祝を営業日に数える"));
  const basic = html.slice(html.indexOf('id="h-basic"'), html.indexOf('id="h-days"'));
  assert.ok(basic.includes("営業日の数え方") && basic.indexOf("営業日の数え方") < basic.indexOf("勤務時間"), "基本の設定の中で、先頭の行");
  assert.ok(!html.includes("この一覧は日数計算に使いません"));
  assert.ok(!html.includes("期間内の土日と日本の祝日も除きません"));
});

test("設定: スイッチがオンのとき checked になり、「日本の祝日」と「休み（手動）」の節に説明が出る", () => {
  const d = load();
  d.settings = { ...d.settings, countWeekendsAndHolidays: true };
  const html = setv(d);
  assert.match(html.match(/<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/)[0], /checked/);
  const nat = html.slice(html.indexOf('id="h-nat"'), html.indexOf('id="h-hol"'));
  assert.ok(nat.includes("いまは土日祝を営業日に数える設定なので、この一覧は日数計算に使いません"));
  const hol = html.slice(html.indexOf('id="h-hol"'), html.indexOf('id="h-wrk"'));
  assert.ok(hol.includes("土日祝を営業日に数えるときは、期間内の土日と日本の祝日も除きません"));
});

test("設定: スイッチの値が真偽値でない（\"true\"）ときはオフとして描き、注意を節に出す", () => {
  const d = load();
  d.settings = { ...d.settings, countWeekendsAndHolidays: "true" };
  const html = setv(d);
  assert.doesNotMatch(html.match(/<input type="checkbox" data-set="countWeekendsAndHolidays"[^>]*>/)[0], /checked/);
  const sec = html.slice(html.indexOf('id="h-basic"'), html.indexOf('id="h-days"'));
  assert.ok(sec.includes("settings.countWeekendsAndHolidays"), "注意が基本の設定の営業日の数え方の行に出る");
  assert.ok(!html.includes("この一覧は日数計算に使いません"));
});

test("renderSchedule: 土日祝を営業日に数える設定がオンなら、土日・祝日は休みの日にならない。手動の休みは休みの日のまま", () => {
  const d = load();
  d.settings = { ...d.settings, countWeekendsAndHolidays: true, holidays: [{ date: "2026-10-22", kind: "有給" }] };
  const week = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW, showPrio: false });
  const col = (date) => week.match(new RegExp(`<div class="col dz[^"]*" data-date="${date}"`))[0];
  assert.match(col("2026-10-22"), /weekend/, "手動の休み");
  assert.doesNotMatch(col("2026-10-24"), /weekend/, "土曜");
  assert.doesNotMatch(col("2026-10-25"), /weekend/, "日曜");
  const day = (date) => renderSchedule(d, TODAY, { view: "day", date, now: NOW, showPrio: false });
  assert.ok(day("2026-10-25").includes('data-free='), "日曜にも空き枠が出る");
  assert.ok(!day("2026-10-22").includes('data-free='), "手動の休みの日には出ない");
});

test("設定: 「営業日の数え方」の説明は、営業日後の期限とスケジュールの作業枠について書き、日程の移動（暦日で計算）には触れない", () => {
  const html = setv(load());
  const sec = html.slice(html.indexOf("営業日の数え方"), html.indexOf("勤務時間"));
  assert.ok(sec.includes("営業日後の期限") && sec.includes("スケジュールの作業枠"));
  assert.ok(!sec.includes("日程の移動"));
});

test("renderSchedule(day): 土日祝を営業日に数える設定がオンなら、休みの日の注意は「休み」だけを挙げる（土日・日本の祝日は休みにならない）。オフは今までの文", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }] };
  const day = (data, date) => renderSchedule(data, TODAY, { view: "day", date, now: NOW, showPrio: false });
  assert.ok(day(d, "2026-10-22").includes("この日は休みです（土日・日本の祝日・休み）"), "オフ");
  const on = { ...d, settings: { ...d.settings, countWeekendsAndHolidays: true } };
  const h = day(on, "2026-10-22");
  assert.ok(h.includes("この日は休みです（休み）") && h.includes("営業日として扱う日"));
  assert.ok(!h.includes("土日・日本の祝日"));
  assert.ok(!day(on, "2026-10-25").includes("この日は休みです"), "日曜は休みでない");
});

// ---- ガントのバーは、開始日のマスから期限日のマスの右端まで（期限の日を含む） ----
test("renderGantt: タスクのバー・プロジェクト全体のバー・実績のバーの右端は、期限（終了）日のマスの右端。期限の表示はその右に付く", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  const s0 = /data-s0="([^"]+)"/.exec(html)[1], span = +/data-span="(\d+)"/.exec(html)[1];
  const edge = (date) => ((diffDays(date, s0) + 1) / span) * 100; // その日のマスの右端（%）
  const right = (m) => +m[1] + +m[2];
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} と ${b}`);
  const A5 = d.tasks.find((t) => t.id === "A5"), P = d.projects.find((p) => p.id === "A");
  const bar = /<i class="gbar[^"]*"[^>]*data-gt="A5"[^>]*style="left:([\d.]+)%;width:([\d.]+)%/.exec(html);
  near(right(bar), edge(A5.due), "タスクのバー");
  const sum = /<i class="gbar gsum"[^>]*style="left:([\d.]+)%;width:([\d.]+)%/.exec(html);
  near(right(sum), edge(P.due), "プロジェクト全体のバー");
  const act = /<i class="gact" style="left:([\d.]+)%;width:([\d.]+)%;[^>]*title="実績 10\/14〜10\/20"/.exec(html);
  near(right(act), edge("2026-10-20"), "実績のバー");
  const row = html.split('<div class="g-row">').find((r) => r.includes('data-gt="A5"'));
  near(+/class="g-due mono" style="left:([\d.]+)%/.exec(row)[1], edge(A5.due), "タスクの期限の表示");
  const sumRow = html.split('<div class="g-row g-sumrow">')[1];
  near(+/class="g-due mono" style="left:([\d.]+)%/.exec(sumRow)[1], edge(P.due), "プロジェクト全体の期限の表示");
});

test("renderGantt: 重要度が高の未完了タスクのラベルにだけ印（imp-high）が付き、中・低・未設定・完了したタスクには付かない", () => {
  const d = load();
  const set = (id, imp, status) => { const t = d.tasks.find((x) => x.id === id); t.importance = imp; if (status) t.status = status; };
  set("A1", "high", "Done"); set("A2", "mid", "Cancelled"); set("A3", "high", "Waiting"); set("A4", "mid", "To Do"); set("A5", "low", "In Progress"); set("A6", null, "To Do");
  const html = gantt(d, ["A"]);
  const label = (id) => /<div class="g-label([^"]*)"/.exec(html.split('<div class="g-row">').find((r) => r.includes(`data-gt="${id}"`)))[1];
  assert.deepEqual(["A1", "A2", "A3", "A4", "A5", "A6"].map(label), ["", "", " imp-high", "", "", ""]);
});

test("renderGantt: 開始も前のタスクもない（期限だけの）タスクは点で、期限の日のマスの中央に置く。期限の表示は翌日の左端", () => {
  const d = load();
  const a1 = d.tasks.find((t) => t.id === "A1");
  a1.start = null; a1.predecessors = []; // 期限だけ → 点
  const html = gantt(d, ["A"]);
  const s0 = /data-s0="([^"]+)"/.exec(html)[1], span = +/data-span="(\d+)"/.exec(html)[1];
  const row = html.split('<div class="g-row">').find((r) => r.includes('data-gt="A1"'));
  const m = /<i class="dot mk[^"]*"[^>]*data-gt="A1"[^>]*style="left:calc\(([\d.]+)% \+ ([\d.]+)%\)/.exec(row);
  assert.ok(m, "点で描かれ、左は『期限の日の左端 + 半マス』");
  assert.ok(Math.abs(+m[1] + +m[2] - ((diffDays(a1.due, s0) + 0.5) / span) * 100) < 0.01, `マスの中央: ${m[1]} + ${m[2]}`);
  const left = +/class="g-due mono" style="left:([\d.]+)%/.exec(row)[1];
  assert.ok(Math.abs(left - ((diffDays(a1.due, s0) + 1) / span) * 100) < 0.01, `期限の表示は翌日の左端: ${left}`);
});

test("renderGantt: 開始が期限と同じ日のタスクと、前のタスクの期限が期限と同じ日のタスクは、1 日分の棒（両端のつまみつき）で、点にしない", () => {
  const d = load();
  const a1 = d.tasks.find((t) => t.id === "A1");
  a1.start = a1.due; a1.predecessors = [];
  const a2 = d.tasks.find((t) => t.id === "A2");
  a2.start = null; a2.predecessors = ["A1"]; a2.due = a1.due;
  const html = gantt(d, ["A"]);
  const span = +/data-span="(\d+)"/.exec(html)[1];
  for (const id of ["A1", "A2"]) {
    const row = html.split('<div class="g-row">').find((r) => r.includes(`data-gt="${id}"`));
    assert.doesNotMatch(row, /class="dot mk/, `${id}: 点にしない`);
    const m = /<i class="gbar[^"]*"[^>]*data-gt="[^"]*"[^>]*style="left:[\d.]+%;width:([\d.]+)%/.exec(row);
    assert.ok(m && Math.abs(+m[1] - (1 / span) * 100) < 0.01, `${id}: 幅は 1 日分`);
    assert.match(row, /data-gh="l"[\s\S]*data-gh="r"/, `${id}: 両端のつまみ`);
  }
});

test("renderProjects・renderSchedule: showPrio が true でも false でも data-pref=\"prio\" の取っ手が 1 つ出る。aria-expanded は開閉に合わせ、閉じると「今日の優先」は出ない", () => {
  const d = load();
  const views = {
    projects: (showPrio) => renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", showPrio }),
    schedule: (showPrio) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, showPrio }),
  };
  for (const [name, render] of Object.entries(views)) {
    const open = render(true), shut = render(false);
    assert.equal(count(open, /data-pref="prio"/g), 1, `${name}: 開いているとき`);
    assert.equal(count(shut, /data-pref="prio"/g), 1, `${name}: 閉じているとき`);
    assert.match(open, /data-pref="prio"[^>]*aria-expanded="true"/, name);
    assert.match(shut, /data-pref="prio"[^>]*aria-expanded="false"/, name);
    assert.ok(open.includes(">今日の優先</h2>"), `${name}: 開いているとき見出しが出る`);
    assert.ok(!shut.includes(">今日の優先</h2>"), `${name}: 閉じると見出しが出ない`);
  }
});

test("renderGantt: 先行タスクのあるバーに data-pre（空白区切り）が付く。先行のないバーには付かない", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  assert.match(html, /data-gt="A6"[^>]*data-pre="A4 A5"/);
  assert.match(html, /data-gt="A2"[^>]*data-pre="A1"/);
  assert.doesNotMatch(html, /data-gt="A1"[^>]*data-pre=/);
});

test("ibExamples: 依頼の例は、対象のプロジェクトの終わっていないタスクの ID で埋める。別のプロジェクトの ID を混ぜない", () => {
  const data = { tasks: [
    { id: "X1", projectId: "X", status: "Done" }, { id: "X2", projectId: "X", status: "To Do" }, { id: "X3", projectId: "X", status: "Doing" },
    { id: "Y1", projectId: "Y", status: "To Do" },
  ] };
  const ex = ibExamples(data, "X", "2026-11-01");
  assert.equal(ex.due, "X2 が 5 日遅れた（原因: ベンダー）。");
  assert.match(ex.add, /結合テスト 2026-11-15 .*前のタスク X2$/, "期限の例は今日の 14 日後");
  assert.match(ibExamples(data, "", "2026-11-01").due, /^X2 /, "対象が空なら、先頭のタスクのプロジェクト");
  assert.match(ibExamples(data, "Y", "2026-11-01").due, /^Y1 /);
  assert.ok(!Object.values(ex).some((s) => /[<>]/.test(s)), "<…> の穴埋めを残さない");
  assert.match(ibExamples({ tasks: [] }, "", "2026-11-01").due, /^A1 /);
});

test("renderTaskPop: 件名・メモ・ID はエスケープされ、窓には編集の入力と「リストで開く」「削除」が出る", () => {
  const d = load();
  const t = d.tasks.find((x) => x.id === "A4"); t.title = '"><img src=x onerror=1>'; t.memo = "<script>x</script>";
  const html = renderTaskPop(d, { id: "A4", x: 10.4, y: 20.6 }, "<select>状態</select>");
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>x"));
  for (const k of ["title", "start", "due", "importance", "memo"]) assert.ok(html.includes(`data-f="${k}" data-id="A4"`), k);
  assert.ok(html.includes('data-goto="A4"') && html.includes('data-del="A4"') && html.includes("data-addpre=\"A4\"") || html.includes('data-rmpre="A4|A3"'));
  assert.ok(html.includes("left:10px;top:21px") && html.includes("<select>状態</select>"));
  assert.equal(renderTaskPop(d, { id: "ZZ", x: 0, y: 0 }, ""), "");
});

test("assignLevels: 前のラベルと重なるなら、重ならない最初の段へ置く。段は必要な数だけ増える", () => {
  // x = ラベルの左端、w = 幅
  const lv = assignLevels([{ x: 0, w: 100 }, { x: 10, w: 100 }, { x: 20, w: 100 }, { x: 105, w: 50 }, { x: 300, w: 50 }]);
  assert.deepEqual(lv, [0, 1, 2, 0, 0]); // 4 つ目は、1 つ目の端(100)を過ぎているので 0 段目へ戻る
  assert.deepEqual(assignLevels([]), []);
  assert.deepEqual(assignLevels([{ x: 0, w: 50 }, { x: 50, w: 50 }]), [0, 0], "端が接するだけなら重ならない");
});

test("renderGantt: 近い日付のマイルストーン 3 件は、1 段ごとに 18px ずらして置き、行の高さを段数に合わせて広げる。離れていれば 1 段で 44px", () => {
  const d = load();
  d.projects[0].milestones = [{ name: "あ", date: "2026-08-31" }, { name: "い", date: "2026-09-01" }, { name: "う", date: "2026-09-02" }];
  const html = gantt(d, ["A"]);
  assert.deepEqual([...html.matchAll(/class="ms"[^>]*top:(\d+)px/g)].map((m) => +m[1]), [6, 24, 42]);
  assert.deepEqual([...html.matchAll(/class="ms-l"[^>]*top:(\d+)px/g)].map((m) => +m[1]), [2, 20, 38]);
  assert.match(html, /g-msrow[^]*?width:var\(--lanew\);height:62px/); // 3 段 × 18 + 8
  d.projects[0].milestones = [{ name: "あ", date: "2026-08-31" }, { name: "い", date: "2027-02-20" }];
  assert.match(gantt(d, ["A"]), /g-msrow[^]*?height:44px/);
});

test("layoutMilestones: 実測のラベル幅で段を決め直し、各要素の top と行の高さを書く。幅 0（隠れている）の行・マイルストーンの無い本体は触らない", () => {
  const el = (offsetLeft, offsetWidth) => ({ offsetLeft, offsetWidth, style: {} });
  const lane = (marks, labels, offsetWidth = 500) => ({ offsetWidth, style: {}, querySelectorAll: (s) => (s === ".ms" ? marks : labels) });
  const body = (l) => ({ querySelector: () => l });
  const marks = [el(0, 9), el(0, 9), el(0, 9)];
  const labels = [el(0, 100), el(50, 100), el(300, 100)];
  const shown = lane(marks, labels);
  const hidden = lane([el(0, 9), el(0, 9)], [el(0, 0), el(0, 0)], 0);
  layoutMilestones([body(shown), body(hidden), body(null)]);
  assert.deepEqual(marks.map((m) => m.style.top), ["6px", "24px", "6px"]);
  assert.deepEqual(labels.map((l) => l.style.top), ["2px", "20px", "2px"]);
  assert.equal(shown.style.height, "44px"); // 2 段 × 18 + 8 = 44
  assert.equal(hidden.style.height, undefined);
});

// ---- 設定タブ: 節の折りたたみ ----
const FOLD_IDS = ["basic", "days", "nat", "hol", "wrk", "rules", "wbs"];
const foldTag = (html, id) => (html.match(new RegExp(`<details[^>]*data-fold="${id}"[^>]*>`)) ?? [""])[0];

test("設定: 7 つの節（基本の設定・休みと営業日・日本の祝日・休み（手動）・営業日として扱う日・キーワード規則・WBS の取り込み記録）が details で、既定はすべて開く", () => {
  const html = setv(load());
  for (const id of FOLD_IDS) assert.match(foldTag(html, id), /<details[^>]* open[ >]/, id);
  assert.equal([...html.matchAll(/<details /g)].length, 7);
  assert.equal([...html.matchAll(/<summary/g)].length, 7);
});

test("設定: 日本の祝日・休み（手動）・営業日として扱う日は、「休みと営業日」の節の中にある。ほかの節の中には入れ子にならない", () => {
  const html = setv(load());
  const days = html.slice(html.indexOf('data-fold="days"'), html.indexOf('data-fold="rules"'));
  for (const id of ["nat", "hol", "wrk"]) assert.ok(days.includes(`data-fold="${id}"`), id);
  assert.ok(html.indexOf('data-fold="basic"') < html.indexOf('data-fold="days"'));
  assert.ok(!html.slice(html.indexOf('data-fold="basic"'), html.indexOf('data-fold="days"')).includes('data-fold="nat"'));
});

test("設定: opts.closed の節だけ open が付かない。親を閉じても、子の開閉は変えない", () => {
  const html = setv(load(), { closed: ["hol", "rules"] });
  for (const id of ["hol", "rules"]) assert.doesNotMatch(foldTag(html, id), / open/, id);
  for (const id of ["basic", "days", "nat", "wrk", "wbs"]) assert.match(foldTag(html, id), / open[ >]/, id);
  assert.match(foldTag(setv(load(), { closed: ["days"] }), "hol"), / open[ >]/);
});

test("設定: 節を閉じても、中の入力と注意は描く（閉じるのは表示だけ）", () => {
  const d = load();
  d.settings = { ...d.settings, waitingLongDays: "7" };
  const html = setv(d, { closed: FOLD_IDS });
  assert.ok(setTag(html, "waitingLongDays") && html.includes("settings.waitingLongDays:"));
  assert.match(html, /<input type="checkbox" data-set="countWeekendsAndHolidays"/);
});

test("設定: 折りたたむ節は、見出しで名前を付ける（aria-labelledby が見出しの id を指す）", () => {
  const html = setv(load());
  for (const id of FOLD_IDS) {
    assert.match(foldTag(html, id), new RegExp(`aria-labelledby="h-${id}"`), id);
    assert.ok(html.includes(`id="h-${id}"`), id);
  }
});

test("設定: 閉じている節の見出しに、中の注意の件数を出す。開いている節・注意のない節には出さない", () => {
  const d = load();
  d.settings = { ...d.settings, waitingLongDays: "7", countWeekendsAndHolidays: "true", holidays: "x" };
  const head = (html, id) => html.match(new RegExp(`data-fold="${id}"[^>]*><summary>([^]*?)</summary>`))?.[1] ?? "";
  const closed = setv(d, { closed: FOLD_IDS });
  assert.match(head(closed, "basic"), /注意 2 件/, "営業日の数え方と待ち長期化の日数");
  assert.match(head(closed, "hol"), /注意 1 件/);
  assert.match(head(closed, "days"), /注意 1 件/, "閉じた親の見出しには、子の注意を数える");
  for (const id of ["nat", "wrk", "rules", "wbs"]) assert.doesNotMatch(head(closed, id), /注意/, id);
  const open = setv(d);
  for (const id of FOLD_IDS) assert.doesNotMatch(head(open, id), /注意/, id);
  assert.doesNotMatch(head(setv(load(), { closed: FOLD_IDS }), "basic"), /注意/, "注意が無ければ出さない");
});

test("設定: 規則のエラー（ruleError）も、閉じた「キーワード規則」の見出しに 1 件として出す", () => {
  const head = (html) => html.match(/data-fold="rules"[^>]*><summary>([^]*?)<\/summary>/)[1];
  assert.match(head(setv(load(), { closed: ["rules"], ruleError: "同じキーワードがあります" })), /注意 1 件/);
  assert.doesNotMatch(head(setv(load(), { closed: ["rules"] })), /注意/);
});

test("タスクの並べ替え: 編集画面のリストとガントに「⠿」ハンドル（data-mvh）と、見出し・行の落とし先（data-mvgrp・data-mvrow）が出る", () => {
  const d = load();
  const list = renderProjects(d, TODAY, { filter: "A", view: "list" });
  const edit = gantt(d, ["A"]);
  const proj = d.tasks.filter((t) => t.projectId === "A");
  for (const [name, html] of [["リスト", list], ["ガント", edit]]) {
    assert.equal(count(html, /data-mvh="/g), proj.length, `${name}: タスクごとに 1 つのハンドル`);
    assert.equal(count(html, /data-mvrow="/g), proj.length, `${name}: 行の落とし先`);
    assert.ok(count(html, /data-mvgrp="A"/g) >= 4, `${name}: セクションの見出し（設計・調達・構築×2 と （なし））`);
  }
  assert.match(list, /data-mvgrp="A" data-mvg="調達" data-mvsg="機器選定"/);
});

test("renderProjects（リスト）: 名前と状態は .pstick にあり、種別・開始・期限・進捗は .phead に残る。入力欄の data-pf は変わらない", () => {
  const cases = { タスクあり: load(), タスク0件: (() => { const d = load(); d.tasks = []; return d; })() };
  for (const [name, d] of Object.entries(cases)) {
    const html = renderProjects(d, TODAY, { filter: "A", view: "list" });
    const stick = html.slice(html.indexOf('<div class="pstick">'), html.indexOf('<div class="phead">'));
    const head = html.slice(html.indexOf('<div class="phead">'), html.indexOf('<div class="twrap">'));
    assert.ok(html.includes('<div class="pstick">') && html.includes('<div class="tscroll tlist">'), `${name}: 構造がある`);
    assert.equal((stick.match(/data-pf="name"/g) ?? []).length, 1, `${name}: 名前の入力欄は .pstick に 1 つ`);
    assert.equal((stick.match(/data-pf="status"/g) ?? []).length, 1, `${name}: 状態の選択欄は .pstick に 1 つ`);
    assert.ok(!head.includes('data-pf="name"') && !head.includes('data-pf="status"'), `${name}: .phead には名前・状態がない`);
    for (const f of ["type", "start", "due"]) assert.ok(head.includes(`data-pf="${f}"`), `${name}: .phead に ${f}`);
  }
});

test("renderProjects（リスト）: .phead（種別・開始・期限・進捗・稼働・注意の印）も .pstick の中にあり、名前・状態の行（.prow）の次に並ぶ。固定する範囲に、プロジェクトの見出し全体が入る", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  const start = html.indexOf('<div class="pstick">');
  // .pstick の閉じ（最初の <div の深さが 0 に戻る位置）を探す
  let depth = 0, end = -1;
  for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { end = start + m.index + m[0].length; break; } }
  const stick = html.slice(start, end);
  assert.ok(end > start, ".pstick の閉じが見つかる");
  assert.ok(stick.startsWith('<div class="pstick"><div class="prow">'), "最初が名前・状態の行（.prow）");
  assert.ok(stick.indexOf('data-pf="name"') < stick.indexOf('<div class="phead">') && stick.indexOf('data-pf="status"') < stick.indexOf('<div class="phead">'), "名前・状態は .phead の前");
  for (const f of ["type", "start", "due"]) assert.ok(stick.includes(`data-pf="${f}"`), `.pstick の中に ${f}`);
  assert.ok(stick.includes("class=\"hrs\"") || stick.includes("mono hrs"), "稼働も .pstick の中");
  assert.ok(html.slice(end).trimStart().startsWith('<div class="twrap"><div class="thstrip" aria-hidden="true"></div><div class="tscroll tlist">'), ".pstick の直後が、列見出しの複製(.thstrip)と表の枠を包む .twrap");
});

test("renderGantt（編集画面）: プロジェクトごとに .pgstick と .gwrap（.gstrip + .gscroll）に分かれ、.pg-head は .pgstick の中にある", () => {
  const html = gantt(load(), ["A", "B", "C"]);
  assert.equal(count(html, /<section class="pg"/g), 3);
  assert.equal(count(html, /<div class="pgstick"><div class="pg-head">/g), 3);
  assert.equal(count(html, /<div class="gwrap"><div class="gstrip" aria-hidden="true"><\/div><div class="gscroll"/g), 3);
  assert.equal(count(html, /class="gscroll"/g), 3);
  const attrs = [...html.matchAll(/class="gscroll" (data-todayfrac="[^"]*" data-s0="[^"]*" data-span="[^"]*")/g)].map((m) => m[1]);
  assert.equal(attrs.length, 3);
  assert.equal(new Set(attrs).size, 1, "全プロジェクトで同じ値（ドラッグが各 .gscroll から読む）");
  for (const sec of html.split('<section class="pg"').slice(1)) {
    assert.equal(count(sec, /class="gbody"/g), 1);
    assert.ok(sec.indexOf('<div class="g-row g-head">') > sec.indexOf('class="gbody"'), "日付軸は .gbody の中");
    assert.ok(sec.indexOf('class="pg-head"') < sec.indexOf('class="gwrap"'), "見出しは枠の外（前）");
  }
});

test("renderProjects: チップは .chips-row に入り、プロジェクト名のプルダウンと「＋ プロジェクトを追加」は .ptool-end に入る（30 プロジェクトでも同じ形）", () => {
  const d = load();
  for (let i = 0; i < 27; i++) d.projects.push({ ...d.projects[1], id: `Z${i}`, name: `追加 ${i}` });
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    const tool = html.slice(html.indexOf('<div class="toolbar ptool">'), html.indexOf('<div class="cols'));
    const row = tool.slice(tool.indexOf('<div class="chips-row"'), tool.indexOf('<div class="ptool-end">'));
    assert.equal(count(tool, /class="chips-row"/g), 1, view);
    assert.equal(count(row, /data-filter="/g), 31, `${view}: すべて + 30 プロジェクトのチップが全部 .chips-row の中`);
    assert.ok(!row.includes("data-addproject") && !row.includes("data-projectpick"), `${view}: 追加ボタンとプルダウンは、スクロールする行の外`);
    const end = tool.slice(tool.indexOf('<div class="ptool-end">'));
    assert.ok(end.includes("data-addproject") && end.includes("data-projectpick"), view);
    assert.ok(!html.includes("data-groupfilter"), `${view}: 大項目の絞り込みはない`);
  }
});

test("絞り込みのチップは、状態が「完了」のプロジェクトを出さない（選択中のあいだだけ出す）。プルダウンには、完了も含む全プロジェクトが出る", () => {
  const d = load();
  d.projects[1].status = "完了"; // B
  const chipIds = (html) => [...html.slice(html.indexOf('<div class="chips-row"'), html.indexOf('<div class="ptool-end">')).matchAll(/data-filter="([^"]+)"/g)].map((m) => m[1]);
  const opts = (html) => [...html.slice(html.indexOf("data-projectpick"), html.indexOf("</select>", html.indexOf("data-projectpick"))).matchAll(/<option value="([^"]+)"( selected)?>/g)].map((m) => [m[1], !!m[2]]);
  for (const view of ["gantt", "list"]) {
    const all = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    assert.deepEqual(chipIds(all), ["all", "A", "C"], `${view}: 完了の B はチップに出ない`);
    assert.deepEqual(opts(all).map((o) => o[0]), ["all", "A", "B", "C"], `${view}: プルダウンには B も出る`);
    assert.deepEqual(opts(all).filter((o) => o[1]), [["all", true]], `${view}: すべてが選択中`);
    const b = renderProjects(d, TODAY, { filter: "B", view, window: "m6" });
    assert.deepEqual(chipIds(b), ["all", "A", "B", "C"], `${view}: 完了の B を選んでいるあいだは、B のチップが出る`);
    assert.deepEqual(opts(b).filter((o) => o[1]), [["B", true]], `${view}: プルダウンも B が選択中`);
  }
  assert.deepEqual(chipIds(renderProjects(load(), TODAY, { filter: "all", view: "list" })), ["all", "A", "B", "C"], "完了がなければ、全部出る");
});

test("renderList: .twrap は表（.tlist）だけを含み、メモ・マイルストーン・履歴は .twrap の外", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  const a = html.indexOf('<div class="twrap">');
  assert.ok(a > 0);
  let depth = 0, end = -1;
  for (const m of html.slice(a).matchAll(/<div\b|<\/div>/g)) { depth += m[0] === "</div>" ? -1 : 1; if (depth === 0) { end = a + m.index + 6; break; } }
  const wrap = html.slice(a, end);
  assert.equal(count(wrap, /<table\b/g), 1);
  assert.ok(!wrap.includes("マイルストーン") && !wrap.includes("日程変更の履歴") && !wrap.includes("変更はその場でファイルに保存"), "表の外のものを含まない");
  assert.ok(html.indexOf("マイルストーン", end) > end, "マイルストーンは .twrap の後");
});

// ---- チェックリストの M/N 表示（今日の優先・今日のタスク） ----
const ckTask = (n, done) => ({ checklist: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: `項目${i + 1}`, done: i < done })) });

test("checkMeterHtml: 項目なしは空。あれば割合の幅と M/N。remain で残り件数。全部済みは all", () => {
  assert.equal(checkMeterHtml({}), "");
  assert.equal(checkMeterHtml({ checklist: [] }), "");
  const a = checkMeterHtml(ckTask(5, 2));
  assert.ok(a.includes("width:40%") && a.includes(">2/5<") && a.includes('class="ck-n mono"'));
  assert.ok(checkMeterHtml(ckTask(5, 2), { remain: true }).includes("2/5（残り 3 件）"));
  assert.ok(checkMeterHtml(ckTask(4, 4)).includes('class="ck-n mono all"'));
});

test("renderTodayTasks: チェックリストのあるタスクの行に M/N（残り K 件）。ないタスクの行には出ない", () => {
  const { d } = withToday();
  const [a5, a7] = items(renderTodayTasks(d, TODAY));
  assert.ok(a5.html.includes("2/4（残り 2 件）") && a5.html.includes("ck-meter"));
  assert.ok(!a7.html.includes("ck-meter"));
});

test("renderPrio: チェックリストのあるタスクの行に M/N（残り K 件）。ないタスクの行には出ない", () => {
  const html = renderPrio(load(), TODAY, { sched: true });
  assert.ok(html.includes("2/4（残り 2 件）"));
  assert.equal(count(html, /ck-meter/g), 1, "チェックリストのあるタスク（A5）だけ");
});

// ---- ガントのチェックリスト表示 ----
const grow = (html, id) => html.split('<div class="g-row">').find((r) => r.includes(`<span class="id">${id}</span>`)) ?? "";

test("renderGantt: チェックリストのあるタスクは、ラベルに線と M/N、バーに割合の塗り。バーの右の期限には数字を出さない", () => {
  const r = grow(gantt(load(), ["A"]), "A5"); // In Progress・2/4
  assert.ok(r.includes("ck-meter") && count(r, />2\/4</g) === 1, "ラベルに M/N");
  assert.ok(/class="gbar[^"]*\bck\b/.test(r) && r.includes('<u class="gck" style="width:50%"></u>'), "バーの塗り");
  assert.match(/class="g-due mono"[^>]*>([^<]*)</.exec(r)[1], /^\d+\/\d+$/, "バーの右は期限の日付だけ");
});

test("renderGantt: 項目なしのタスクには、線も数字も塗りも出ない。0 件済みは幅 0%", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  const r4 = grow(html, "A4");
  assert.ok(!r4.includes("ck-meter") && !r4.includes("gck"));
  d.tasks.find((t) => t.id === "A4").checklist = [{ id: "c1", text: "a", done: false }, { id: "c2", text: "b", done: false }];
  assert.ok(grow(gantt(d, ["A"]), "A4").includes('class="gck" style="width:0%"'));
});

test("renderGantt: Done のタスクは、ラベルの M/N が all（緑）で、バーに塗りを出さない", () => {
  const r = grow(gantt(load(), ["A"]), "A1"); // Done・3/3
  assert.ok(r.includes('class="ck-n mono all"') && r.includes(">3/3<"));
  assert.ok(!r.includes("gck"));
});

test("renderGantt: 点（期限だけのタスク）は、ラベルに M/N を出し、塗りは出さない", () => {
  const d = load();
  const t = d.tasks.find((x) => x.id === "A6");
  Object.assign(t, { start: null, predecessors: [], checklist: [{ id: "c1", text: "a", done: true }, { id: "c2", text: "b", done: false }] });
  const r = grow(gantt(d, ["A"]), "A6");
  assert.ok(r.includes("dot mk") && r.includes(">1/2<") && !r.includes("gck"));
});

// ---- チェックリストの編集欄（リストの展開・ガントの編集の窓） ----
test("checklistEditorHtml: 項目ごとに取っ手・チェック・文言・削除、末尾に追加欄。文言はエスケープ。項目なしでも追加欄は出る", () => {
  const t = { id: "A5", checklist: [{ id: "c1", text: '<b>"x"&', done: true }, { id: "c2", text: "b", done: false }, { id: "c3", text: "c", done: false }] };
  const h = checklistEditorHtml(t);
  assert.equal(count(h, /data-ckid="/g), 3);
  for (const a of ["data-ckmv", "data-ckdone", "data-cktext", "data-ckdel"]) assert.equal(count(h, new RegExp(`${a}="A5\\|c\\d"`, "g")), 3, a);
  assert.equal(count(h, /data-ckadd="A5"/g), 1);
  assert.ok(h.includes('value="&lt;b&gt;&quot;x&quot;&amp;"') && !h.includes("<b>\"x\""));
  assert.equal(count(h, /type="checkbox"[^>]*checked/g), 1);
  const textInput = (id) => new RegExp(`<input[^>]*data-cktext="A5\\|${id}"[^>]*>`).exec(h)[0];
  assert.ok(textInput("c1").includes("done") && !textInput("c2").includes("done"), "済みの文言だけ done");
  const e = checklistEditorHtml({ id: "A4" });
  assert.ok(e.includes('data-ckadd="A4"') && !e.includes("data-ckid"));
});

test("renderProjects(list): 列「チェック」。閉じていれば ▸ M/N（項目なしは ＋ 追加）、開いていればその行の直後に編集欄", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { view: "list", filter: "A" });
  assert.ok(html.includes("<th>チェック</th>"));
  assert.ok(/data-cktoggle="A5" aria-expanded="false"[^>]*>▸ 2\/4</.test(html) && /data-cktoggle="A4" aria-expanded="false"[^>]*>＋ 追加</.test(html));
  assert.ok(!html.includes("ck-tr"));
  const open = renderProjects(d, TODAY, { view: "list", filter: "A", checkOpen: new Set(["A5"]) });
  assert.ok(/aria-expanded="true"[^>]*>▾ 2\/4</.test(open));
  const i = open.indexOf('data-row="A5"'), p = open.indexOf('data-ckpanel="A5"'), nxt = open.indexOf('<tr data-row="', i + 1);
  assert.ok(i >= 0 && p > i && p < nxt, "A5 の行の直後");
  assert.equal(count(open, /data-ckpanel=/g), 1);
});

test("renderTaskPop: チェックリストの欄を、期限の下・前のタスクの上に置く", () => {
  const h = renderTaskPop(load(), { id: "A5", x: 10, y: 10 }, "");
  const due = h.indexOf('data-f="due"'), ck = h.indexOf("ckedit"), pre = h.indexOf("前のタスク");
  assert.ok(due >= 0 && ck > due && pre > ck);
});

// ---- Done にするときの警告 ----
test("doneAskHtml: stage が check なら、未完了の項目の一覧と 3 つのボタン。文言はエスケープする", () => {
  const h = doneAskHtml({ id: "A5", status: "Done", n: 0, future: [], open: ["a<b>", "b"], stage: "check", checkAll: false });
  assert.ok(h.includes("未完了の項目が 2 件あります") && h.includes('role="alert"'));
  assert.ok(h.includes("<li>a&lt;b&gt;</li>") && !h.includes("<li>a<b>"));
  for (const a of ['data-ckall="A5"', 'data-ckkeep="A5"', "data-doneno"]) assert.ok(h.includes(a), a);
  assert.ok(!h.includes("data-doneok"));
});

test("doneAskHtml: stage が future、または stage なし（従来の形）なら、予定枠の確認（data-doneok）のまま", () => {
  for (const pd of [{ id: "A5", status: "Done", n: 1, future: ["S3"], open: [], stage: "future" }, { id: "A5", status: "Done", n: 1, future: ["S3"] }]) {
    const h = doneAskHtml(pd);
    assert.ok(h.includes('data-doneok="A5"') && h.includes("未来の予定の枠 1 件") && !h.includes("data-ckall"));
  }
});

test("受信箱の提案カード: 登録の行には項目（チェックリスト）の件数を添える", () => {
  const html = cardOf([
    { kind: "add", rows: [{ ref: "t1", title: "疎通確認", projectId: "A", group: null, subgroup: null, due: "2026-12-10", businessDays: null, start: null, predecessors: [], checklist: ["a", "b"] }] },
  ]);
  assert.ok(html.includes("項目 2 件"));
});
test("受信箱の履歴: 処理待ち・処理中の依頼にも「却下する」を出す（見張りが止まったときに、画面から取り下げられる）", () => {
  for (const status of ["pending", "working"]) {
    const html = ib(withInbox([reqOf("R1", status)]), { open: true });
    assert.ok(html.includes('data-ib-reject="R1"'), status);
  }
  assert.ok(!ib(withInbox([reqOf("R1", "applied", { result: { at: T0, by: "html", summary: "x" } })]), { open: true }).includes("data-ib-reject"));
});
