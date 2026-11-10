import { test } from "node:test";
import assert from "node:assert/strict";
import { freeSlots, rankTasks, addMeeting, updateMeeting, deleteMeeting, syncMcpEvents } from "../plugins/project-board/src/core/schedule.js";

const WD = { start: "09:00", end: "18:00" };
const ev = (start, end, extra = {}) => ({ id: `${start}${end}`, date: "2026-10-20", start, end, title: "会議", source: "manual", skip: false, externalId: null, ...extra });
const base = (events = []) => ({ settings: { workday: WD, waitingLongDays: 7 }, projects: [{ id: "P" }], tasks: [], events, changeLog: [] });

test("freeSlots: 重なる会議の統合と勤務時間への切り詰め", () => {
  const f = freeSlots([ev("10:00", "11:00"), ev("10:30", "12:00"), ev("08:00", "09:30")], "2026-10-20", WD);
  assert.deepEqual(f, [{ start: "09:30", end: "10:00" }, { start: "12:00", end: "18:00" }]);
});

test("freeSlots: 会議なし／終日会議／別の日／skip", () => {
  assert.deepEqual(freeSlots([], "2026-10-20", WD), [{ start: "09:00", end: "18:00" }]);
  assert.deepEqual(freeSlots([ev("08:00", "19:00")], "2026-10-20", WD), []);
  assert.deepEqual(freeSlots([ev("10:00", "11:00", { date: "2026-10-21" })], "2026-10-20", WD), [{ start: "09:00", end: "18:00" }]);
  assert.deepEqual(freeSlots([ev("10:00", "11:00", { skip: true })], "2026-10-20", WD), [{ start: "09:00", end: "18:00" }]);
  assert.deepEqual(freeSlots([ev("09:00", "12:00"), ev("12:00", "18:00")], "2026-10-20", WD), []);
});

test("addMeeting: manual を付け、空白の件名は「会議」、終了≦開始は例外、ID は重複しない", () => {
  const a = addMeeting(base([{ id: "m5" }]), { title: "  ", date: "2026-10-20", start: "10:00", end: "11:00" });
  const m = a.data.events.find((e) => e.id === a.id);
  assert.deepEqual([m.source, m.title, m.skip, m.externalId], ["manual", "会議", false, null]);
  assert.equal(a.id, "m6");
  assert.throws(() => addMeeting(base(), { title: "x", date: "2026-10-20", start: "11:00", end: "11:00" }));
});

test("updateMeeting: 手入力は日付・時間を移せる／MCP 由来は skip だけ", () => {
  const d = base([ev("10:00", "11:00", { id: "m1" }), ev("13:00", "14:00", { id: "m2", source: "mcp", externalId: "x" })]);
  const moved = updateMeeting(d, "m1", { date: "2026-10-22", start: "15:00", end: "16:00" });
  assert.deepEqual(moved.events[0].date + moved.events[0].start, "2026-10-2215:00");
  assert.throws(() => updateMeeting(d, "m1", { start: "12:00", end: "11:00" }));
  assert.throws(() => updateMeeting(d, "m2", { title: "改名" }));
  assert.throws(() => updateMeeting(d, "m2", { start: "14:00" }));
  assert.equal(updateMeeting(d, "m2", { skip: true }).events[1].skip, true);
  assert.equal(d.events[1].skip, false, "元のデータは変えない");
});

test("deleteMeeting: 手入力のみ", () => {
  const d = base([ev("10:00", "11:00", { id: "m1" }), ev("13:00", "14:00", { id: "m2", source: "mcp", externalId: "x" })]);
  assert.equal(deleteMeeting(d, "m1").events.length, 1);
  assert.throws(() => deleteMeeting(d, "m2"));
});

test("syncMcpEvents: 追加・更新・消えた MCP 会議の削除、skip と手入力と範囲外は残す", () => {
  const d = base([
    ev("09:00", "10:00", { id: "m1", source: "mcp", externalId: "a", skip: true, title: "旧" }),
    ev("10:00", "11:00", { id: "m2", source: "mcp", externalId: "gone" }),
    ev("11:00", "12:00", { id: "m3" }),
    ev("11:00", "12:00", { id: "m4", source: "mcp", externalId: "far", date: "2026-12-01" }),
  ]);
  const r = syncMcpEvents(d, [
    { externalId: "a", title: "新", date: "2026-10-20", start: "09:00", end: "10:30" },
    { externalId: "b", title: "追加", date: "2026-10-21", start: "13:00", end: "14:00" },
  ], { start: "2026-10-19", end: "2026-10-25" });
  const byExt = Object.fromEntries(r.events.filter((e) => e.externalId).map((e) => [e.externalId, e]));
  assert.deepEqual([byExt.a.title, byExt.a.end, byExt.a.skip, byExt.a.id], ["新", "10:30", true, "m1"]);
  assert.equal(byExt.b.source, "mcp");
  assert.equal(byExt.gone, undefined);
  assert.ok(r.events.some((e) => e.id === "m3"));
  assert.ok(byExt.far);
  assert.equal(new Set(r.events.map((e) => e.id)).size, r.events.length);
});

// ---- 優先順位（SPEC の式を手計算で検証） ----
const T = (id, due, extra = {}) => ({ id, projectId: "P", title: id, due, status: "To Do", predecessors: [], waitingOn: null, importance: null, start: null, doneAt: null, sessions: [], ...extra });
function rankData() {
  const tasks = [
    T("R1", "2026-10-16", { status: "Waiting", waitingOn: { party: "ベンダーA", since: "2026-10-11" } }),
    T("R2", "2026-10-23", { importance: "high" }),
    T("R3", "2026-10-21", { importance: "high" }),
    T("R4", "2026-10-22"),
  ];
  const direct = (parent, n) => { for (let i = 0; i < n; i++) tasks.push(T(`${parent}-s${i}`, "2027-03-01", { predecessors: [parent] })); };
  direct("R1", 4); direct("R2", 6); direct("R3", 3);
  // R4 は連鎖 4 件（推移的に数える）
  tasks.push(T("R4-c0", "2027-03-01", { predecessors: ["R4"] }));
  for (let i = 1; i < 4; i++) tasks.push(T(`R4-c${i}`, "2027-03-01", { predecessors: [`R4-c${i - 1}`] }));
  return { ...base(), tasks };
}

test("rankTasks: 手計算の点数と順序", () => {
  const r = rankTasks(rankData(), "2026-10-20");
  assert.deepEqual(r.map((x) => [x.taskId, x.score]), [["R1", 151], ["R3", 55.5], ["R2", 52.5], ["R4", 42]]);
});

test("rankTasks: Waiting は chase で待ち先名を含み、理由は日本語", () => {
  const [r1] = rankTasks(rankData(), "2026-10-20");
  assert.equal(r1.action, "chase");
  assert.ok(r1.reasons.some((x) => x.includes("ベンダーA") && x.includes("9日")));
  assert.ok(r1.reasons.includes("期限超過 4日"));
  assert.ok(r1.reasons.includes("次のタスク 4 件を止めている"));
  assert.equal(rankTasks(rankData(), "2026-10-20")[1].action, "work");
  assert.ok(rankTasks(rankData(), "2026-10-20")[1].reasons.includes("重要度: 高"));
});

test("rankTasks: Done／Cancelled と、前のタスクが未完了のタスクは含まれない。前のタスクが完了なら含まれる", () => {
  const d = { ...base(), tasks: [T("A", "2026-10-25", { status: "Done" }), T("B", "2026-10-25", { predecessors: ["A"] }), T("C", "2026-10-25", { predecessors: ["B"] }), T("D", "2026-10-25", { status: "Cancelled" })] };
  assert.deepEqual(rankTasks(d, "2026-10-20").map((x) => x.taskId), ["B"]);
});

test("rankTasks: 同点は期限の昇順→ID 昇順。タスク 0 件は空", () => {
  const d = { ...base(), tasks: [T("Z", "2027-06-01"), T("B", "2027-06-01"), T("A", "2027-07-01")] };
  assert.deepEqual(rankTasks(d, "2026-10-20").map((x) => x.taskId), ["B", "Z", "A"]);
  assert.deepEqual(rankTasks(base(), "2026-10-20"), []);
});

test("rankTasks: 循環があっても終了する", () => {
  const d = { ...base(), tasks: [T("A", "2026-10-25", { predecessors: ["B"] }), T("B", "2026-10-25", { predecessors: ["A"] }), T("C", "2026-10-25")] };
  assert.deepEqual(rankTasks(d, "2026-10-20").map((x) => x.taskId), ["C"]);
});

// ---- チェックリストの量を加えた点数（今日は 2026-10-20） ----
const CK = (n, done = 0) => Array.from({ length: n + done }, (_, i) => ({ id: `c${i + 1}`, text: `項目${i + 1}`, done: i < done }));
const scoreOf = (tasks, id = "X") => rankTasks({ ...base(), tasks }, "2026-10-20").find((r) => r.taskId === id).score;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("rankTasks: 期限点 (30−残り日数)×1.5 に、未チェック n 件の倍率 1+min(n,10)/10 をかける", () => {
  near(scoreOf([T("X", "2026-10-25", { checklist: CK(3) })]), 48.75);
  near(scoreOf([T("X", "2026-10-25")]), 37.5);
  near(scoreOf([T("X", "2026-10-25", { importance: "high" })]), 49.5);
  near(scoreOf([T("X", "2026-10-20")]), 45);
});

test("rankTasks: 済みの項目は数えない。未チェックが 10 件を超えても倍率は 2.0 まで", () => {
  near(scoreOf([T("X", "2026-10-25", { checklist: CK(3, 2) })]), 48.75);
  near(scoreOf([T("X", "2026-10-17", { checklist: CK(10) })]), 199);
  near(scoreOf([T("X", "2026-10-17", { checklist: CK(15) })]), 199);
});

test("rankTasks: 期限が 30 日より先なら期限点は 0（倍率をかけても 0）", () => {
  near(scoreOf([T("X", "2026-11-19", { checklist: CK(5) })]), 0);
  near(scoreOf([T("X", "2026-11-24", { checklist: CK(5) })]), 0);
});

test("rankTasks: Waiting は倍率なし・+15 なし。chase と待ち先の理由は残る", () => {
  const t = T("X", "2026-10-25", { status: "Waiting", waitingOn: { party: "ベンダーA", since: "2026-10-11" }, checklist: CK(3) });
  near(scoreOf([t]), 37.5);
  const r = rankTasks({ ...base(), tasks: [t] }, "2026-10-20")[0];
  assert.equal(r.action, "chase");
  assert.ok(r.reasons.some((x) => x.includes("ベンダーA")));
});

test("rankTasks: 後ろに未完了のタスクがあっても点は増えないが、理由には残る", () => {
  const tasks = [T("X", "2026-10-25"), T("Y", "2027-03-01", { predecessors: ["X"] })];
  near(scoreOf(tasks), 37.5);
  assert.ok(rankTasks({ ...base(), tasks }, "2026-10-20").find((r) => r.taskId === "X").reasons.includes("次のタスク 1 件を止めている"));
});

test("syncMcpEvents: 消した会議の ID を使い回さず、同じ externalId の重複は 1 件にする（M4）", () => {
  const d = base([ev("09:00", "10:00", { id: "m1", source: "mcp", externalId: "a" }), ev("10:00", "11:00", { id: "m3", source: "mcp", externalId: "gone" })]);
  const f = { externalId: "b", title: "新", date: "2026-10-20", start: "13:00", end: "14:00" };
  const r = syncMcpEvents(d, [{ externalId: "a", title: "a", date: "2026-10-20", start: "09:00", end: "10:00" }, f, f], { start: "2026-10-19", end: "2026-10-25" });
  assert.equal(r.events.filter((e) => e.externalId === "b").length, 1);
  assert.ok(!r.events.some((e) => e.externalId === "b" && e.id === "m3"));
});

test("updateTask 相当: Waiting で待ち先なしでも、他の項目の変更は通る（M11）", async () => {
  const { updateTask } = await import("../plugins/project-board/src/ui/edit.js");
  const d = { projects: [{ id: "P" }], tasks: [{ id: "P1", projectId: "P", title: "t", due: "2026-10-30", status: "Waiting", waitingOn: null, predecessors: [], sessions: [] }] };
  assert.equal(updateTask(d, "P1", { memo: "x" }, "2026-10-20").tasks[0].memo, "x");
  assert.throws(() => updateTask(d, "P1", { status: "Waiting" }, "2026-10-20"));
});

// ---- 会議の確認とプロジェクト（Task 3） ----
import { meetingKind, confirmMeeting } from "../plugins/project-board/src/core/schedule.js";

test("meetingKind: skip→skipped / confirmed→actual / 過去→unconfirmed / 未来→planned（終了ちょうどは過去）", () => {
  const now = { date: "2026-10-20", time: "12:00" };
  assert.equal(meetingKind(ev("09:00", "10:00", { skip: true }), now), "skipped");
  assert.equal(meetingKind(ev("09:00", "10:00", { confirmed: true }), now), "actual");
  assert.equal(meetingKind(ev("09:00", "10:00"), now), "unconfirmed");
  assert.equal(meetingKind(ev("11:00", "12:00"), now), "unconfirmed", "終了ちょうどは過去");
  assert.equal(meetingKind(ev("11:00", "12:01"), now), "planned");
  assert.equal(meetingKind(ev("09:00", "10:00", { date: "2026-10-21" }), now), "planned");
});

test("confirmMeeting: 未来と skip は例外、過去なら confirmed:true", () => {
  const now = { date: "2026-10-20", time: "12:00" };
  const d = base([ev("09:00", "10:00"), ev("13:00", "14:00", { id: "f" }), ev("10:00", "11:00", { id: "s", skip: true })]);
  assert.equal(confirmMeeting(d, "09:0010:00", now).events[0].confirmed, true);
  assert.throws(() => confirmMeeting(d, "f", now), /未来/);
  assert.throws(() => confirmMeeting(d, "s", now), /参加しない/);
  assert.throws(() => confirmMeeting(d, "none", now));
});

test("updateMeeting: projectId を手動で付けると manual、'' で自動に戻り規則が再適用される。mcp の会議でも projectId と confirmed は変更できる", () => {
  const d = base([ev("09:00", "10:00", { id: "m1", title: "ベンダーX 打合せ", source: "mcp", externalId: "e1" })]);
  d.projects = [{ id: "A" }, { id: "B" }];
  d.settings.projectRules = [{ keyword: "ベンダーX", projectId: "A" }];
  const a = updateMeeting(d, "m1", { projectId: "B" });
  assert.deepEqual([a.events[0].projectId, a.events[0].projectBy], ["B", "manual"]);
  const b = updateMeeting(a, "m1", { projectId: "" });
  assert.deepEqual([b.events[0].projectId, b.events[0].projectBy], ["A", "rule"]);
  assert.equal(updateMeeting(b, "m1", { confirmed: true }).events[0].confirmed, true);
  assert.throws(() => updateMeeting(d, "m1", { projectId: "ZZ" }));
  assert.throws(() => updateMeeting(d, "m1", { title: "x" }), "mcp の件名は従来どおり変更不可");
});

test("addMeeting: confirmed:false、projectId を渡すと manual", () => {
  const d = base([]); d.projects = [{ id: "A" }];
  const r = addMeeting(d, { date: "2026-10-20", start: "10:00", end: "11:00", title: "x", projectId: "A" });
  const m = r.data.events[0];
  assert.deepEqual([m.confirmed, m.projectId, m.projectBy], [false, "A", "manual"]);
  const n = addMeeting(d, { date: "2026-10-20", start: "10:00", end: "11:00", title: "y" }).data.events[0];
  assert.deepEqual([n.confirmed, n.projectId ?? null], [false, null]);
  assert.throws(() => addMeeting(d, { date: "2026-10-20", start: "10:00", end: "11:00", projectId: "ZZ" }));
});

test("syncMcpEvents: 取得後も confirmed と projectId/projectBy が保たれる", () => {
  const d = base([ev("09:00", "10:00", { id: "m1", source: "mcp", externalId: "e1", confirmed: true, projectId: "A", projectBy: "manual" })]);
  const r = syncMcpEvents(d, [{ externalId: "e1", title: "改題", date: "2026-10-20", start: "09:00", end: "10:00" }], { start: "2026-10-20", end: "2026-10-20" });
  const m = r.events[0];
  assert.deepEqual([m.title, m.confirmed, m.projectId, m.projectBy], ["改題", true, "A", "manual"]);
});

// ---- 最終レビューの修正: 規則は、会議を追加・件名を変えたときにも当たる ----
test("addMeeting: 件名が規則に当たれば、プロジェクトが自動で付く（rule）。手動指定は優先", () => {
  const d = base([]); d.projects = [{ id: "A" }, { id: "B" }];
  d.settings.projectRules = [{ keyword: "ベンダーX", projectId: "A" }];
  const m = addMeeting(d, { date: "2026-10-20", start: "10:00", end: "11:00", title: "ベンダーX 定例" }).data.events[0];
  assert.deepEqual([m.projectId, m.projectBy], ["A", "rule"]);
  const man = addMeeting(d, { date: "2026-10-20", start: "10:00", end: "11:00", title: "ベンダーX 定例", projectId: "B" }).data.events[0];
  assert.deepEqual([man.projectId, man.projectBy], ["B", "manual"]);
});

test("updateMeeting: 件名を変えると、規則で付けたプロジェクトが付け直される（手動は変わらない）", () => {
  const d = base([ev("09:00", "10:00", { id: "m1", title: "ベンダーX 打合せ" }), ev("10:00", "11:00", { id: "m2", title: "ベンダーX 別件", projectId: "B", projectBy: "manual" })]);
  d.projects = [{ id: "A" }, { id: "B" }];
  d.settings.projectRules = [{ keyword: "ベンダーX", projectId: "A" }];
  const a = updateMeeting(d, "m1", { title: "ベンダーX 打合せ" }); // 規則がまだ付いていない会議に、更新のたびに適用される
  assert.deepEqual([a.events[0].projectId, a.events[0].projectBy], ["A", "rule"]);
  const b = updateMeeting(a, "m1", { title: "社内レビュー" });
  assert.equal(b.events[0].projectId ?? null, null);
  const c = updateMeeting(a, "m2", { title: "社内レビュー" });
  assert.deepEqual([c.events[1].projectId, c.events[1].projectBy], ["B", "manual"]);
});

// ---- 見送った Minor の修正: 日時が変わった会議は、確認済みを外す ----
test("updateMeeting: 確認済みの会議の日時を変えると未確認に戻る（時間以外の変更や、confirmed を明示したときは除く）", () => {
  const d = base([ev("09:00", "10:00", { id: "m1", confirmed: true })]);
  assert.equal(updateMeeting(d, "m1", { start: "09:30" }).events[0].confirmed, false);
  assert.equal(updateMeeting(d, "m1", { date: "2026-10-21" }).events[0].confirmed, false);
  assert.equal(updateMeeting(d, "m1", { title: "改題" }).events[0].confirmed, true);
  assert.equal(updateMeeting(d, "m1", { start: "09:30", confirmed: true }).events[0].confirmed, true);
  assert.equal(updateMeeting(d, "m1", { start: "09:00" }).events[0].confirmed, true, "同じ時刻なら変えない");
});

test("syncMcpEvents: 取得で日時が変わった確認済みの会議は未確認に戻り、同じ日時なら確認済みのまま", () => {
  const d = base([ev("09:00", "10:00", { id: "m1", source: "mcp", externalId: "e1", confirmed: true })]);
  const r = { start: "2026-10-20", end: "2026-10-20" };
  const moved = syncMcpEvents(d, [{ externalId: "e1", title: "会議", date: "2026-10-20", start: "10:00", end: "11:00" }], r);
  assert.equal(moved.events[0].confirmed, false);
  const same = syncMcpEvents(d, [{ externalId: "e1", title: "改題", date: "2026-10-20", start: "09:00", end: "10:00" }], r);
  assert.equal(same.events[0].confirmed, true);
});

test("syncMcpEvents: 取得に無いだけの「参加しない」の会議は消さない。対象外になった会議（excludedIds）は消す", () => {
  const d = base([
    ev("09:00", "10:00", { id: "m1", source: "mcp", externalId: "skipped", skip: true }),
    ev("10:00", "11:00", { id: "m2", source: "mcp", externalId: "solo", skip: true }),
  ]);
  const range = { start: "2026-10-19", end: "2026-10-25" };
  assert.deepEqual(syncMcpEvents(d, [], range, new Set(["solo"])).events.map((e) => e.id), ["m1"]);
});
