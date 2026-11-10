import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays, toMin, toHHMM, weekday } from "../plugins/project-board/src/core/dates.js";
import { validate, OP_KINDS, PROPOSE_OPS } from "../plugins/project-board/src/core/schema.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-board/data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "12:00" };
const v = (d) => validate(d, NOW);
const task = (d, id) => d.tasks.find((t) => t.id === id);
const hit = (list, word) => list.some((m) => m.includes(word));

test("mid・low は検証エラーになる", () => {
  for (const bad of ["mid", "low"]) {
    const d = load();
    task(d, d.tasks[0].id).importance = bad;
    assert.ok(hit(v(d).errors, "重要度は高（high）かなしにしてください。data.json の importance を直してください"), bad);
  }
  const ok = load();
  ok.tasks[0].importance = "high";
  assert.deepEqual(v(ok).errors, []);
});

test("サンプルデータはエラーなし", () => {
  assert.deepEqual(v(load()).errors, []);
});

test("日付・時刻の演算", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-03-01", "2026-02-28"), 1);
  assert.equal(weekday("2026-10-20"), 2);
  assert.equal(toMin("09:30"), 570);
  assert.equal(toHHMM(570), "09:30");
  assert.throws(() => addDays("2026-02-30", 1));
});

test("チェックリスト: 正しい形はエラーなし。配列でない・id の重複・text が空・done が真偽値でない・id が文字列でないはエラー", () => {
  const d = load();
  task(d, "A4").checklist = [{ id: "c1", text: "a", done: false }, { id: "c2", text: "b", done: true }];
  assert.deepEqual(v(d).errors, []);
  const bad = (cl) => { const e = load(); task(e, "A4").checklist = cl; return v(e).errors; };
  assert.ok(hit(bad("x"), "A4"));
  assert.ok(hit(bad([{ id: "c1", text: "a", done: false }, { id: "c1", text: "b", done: false }]), "c1"));
  assert.ok(hit(bad([{ id: "c1", text: "  ", done: false }]), "A4"));
  assert.ok(hit(bad([{ id: "c1", text: "a", done: "yes" }]), "A4"));
  assert.ok(hit(bad([{ id: 1, text: "a", done: false }]), "A4"));
});

test("不明な状態値はエラー", () => {
  const d = load(); task(d, "A1").status = "Not Started";
  assert.ok(hit(v(d).errors, "A1"));
  const p = load(); p.projects[0].status = "不明";
  assert.ok(hit(v(p).errors, "プロジェクト A"));
});

test("存在しない前のタスク・projectId はエラー", () => {
  const d = load(); task(d, "A2").predecessors = ["ZZ"];
  assert.ok(hit(v(d).errors, "ZZ"));
  const e = load(); task(e, "A2").projectId = "Q";
  assert.ok(hit(v(e).errors, "projectId"));
});

test("前のタスクの循環はエラー", () => {
  const d = load(); task(d, "A1").predecessors = ["A2"];
  assert.ok(hit(v(d).errors, "循環"));
});

test("日付形式の不正・プロジェクト開始>期限・枠の不正はエラー", () => {
  const a = load(); task(a, "A1").due = "2026/07/31";
  assert.ok(hit(v(a).errors, "A1"));
  const b = load(); b.projects[0].start = "2027-04-01";
  assert.ok(hit(v(b).errors, "開始日"));
  const c = load(); task(c, "A5").sessions[0].end = "12:00";
  assert.ok(hit(v(c).errors, "S1"));
  const e = load(); task(e, "B2").sessions[0] = { id: "S4", date: "2026-10-14", start: "14:00", end: "16:00", kind: "actual" };
  assert.ok(hit(v(e).errors, "重な"));
});

test("警告: Waiting で待ち先なし／終了済みで未来の予定／start>due（前のタスクがあっても start は有効で、無視の警告は出ない）", () => {
  const a = load(); task(a, "A3").waitingOn = null;
  assert.ok(hit(v(a).warnings, "A3"));
  const b = load(); task(b, "A6").start = "2026-12-01";
  assert.ok(!hit(v(b).warnings, "A6"), "前のタスクがあっても、start は無視されない");
  const b2 = load(); task(b2, "A6").start = "2027-03-01"; // 前のタスクがあるタスクも、start > due は警告する
  assert.ok(hit(v(b2).warnings, "A6"));
  const c = load(); task(c, "A5").status = "Done"; task(c, "A5").doneAt = "2026-10-20";
  assert.ok(hit(v(c).warnings, "A5"));
  const d = load(); task(d, "A5").start = "2027-01-10";
  assert.ok(hit(v(d).warnings, "A5"));
  assert.deepEqual(v(a).errors, []);
});

test("空データは有効", () => {
  const d = { version: 1, settings: { ...load().settings, projectRules: [] }, projects: [], tasks: [], events: [], changeLog: [] };
  assert.deepEqual(v(d).errors, []);
});

test("警告: 前のタスクの期限が自分の期限より後（I2）", () => {
  const d = load(); task(d, "A2").due = "2020-01-01";
  assert.ok(hit(v(d).warnings, "A2"));
});

test("waitingOn.since が無い・不正ならエラー、deltaDays が整数でなければエラー（I4, M5）", () => {
  const a = load(); delete task(a, "A3").waitingOn.since;
  assert.ok(hit(v(a).errors, "A3"));
  const b = load(); b.changeLog[0].deltaDays = "<b>";
  assert.ok(hit(v(b).errors, "deltaDays"));
});

// ---- 追加した項目（大項目・中項目、会議のひも付けと確認、設定、取り込みの記録） ----
test("会議の projectId が存在しないプロジェクトなら error", () => {
  const d = load(); d.events[0].projectId = "ZZ";
  assert.ok(hit(v(d).errors, "projectId"));
  const ok = load(); ok.events[0].projectId = "A"; ok.events[0].projectBy = "rule";
  assert.deepEqual(v(ok).errors, []);
});

test("projectBy が rule/manual 以外なら error", () => {
  const d = load(); d.events[0].projectBy = "auto";
  assert.ok(hit(v(d).errors, "projectBy"));
});

test("confirmed が真偽値でなければ error", () => {
  const d = load(); d.events[0].confirmed = "yes";
  assert.ok(hit(v(d).errors, "confirmed"));
  const ok = load(); ok.events[0].confirmed = true;
  assert.deepEqual(v(ok).errors, []);
});

test("projectRules の keyword が空、または projectId が存在しないなら error", () => {
  const a = load(); a.settings.projectRules = [{ keyword: "", projectId: "A" }];
  assert.ok(hit(v(a).errors, "projectRules"));
  const b = load(); b.settings.projectRules = [{ keyword: "x", projectId: "ZZ" }];
  assert.ok(hit(v(b).errors, "projectRules"));
});

test("wbsImports は、存在するプロジェクトのキーと、file（文字列か null）・at（日付）・件数（0 以上の整数）を持つ。不正なら error", () => {
  const ok = load(); ok.settings.wbsImports = { A: { file: "plan.xlsx", at: "2026-10-20", added: 2, updated: 0 }, B: { file: null, at: "2026-10-20", added: 0, updated: 1 } };
  assert.deepEqual(v(ok).errors, []);
  for (const bad of [{ ZZ: { file: null, at: "2026-10-20", added: 0, updated: 0 } }, { A: { file: 3, at: "2026-10-20", added: 0, updated: 0 } }, { A: { file: null, at: "10/20", added: 0, updated: 0 } }, { A: { file: null, at: "2026-10-20", added: -1, updated: 0 } }, { A: { file: null, at: "2026-10-20", added: 1.5, updated: 0 } }, { A: null }]) {
    const d = load(); d.settings.wbsImports = bad;
    assert.ok(hit(v(d).errors, "wbsImports"), JSON.stringify(bad));
  }
});

test("wbsMappings のキーが存在しないプロジェクト、値が文字列でないなら error", () => {
  const a = load(); a.settings.wbsMappings = { ZZ: { title: "B" } };
  assert.ok(hit(v(a).errors, "wbsMappings"));
  const b = load(); b.settings.wbsMappings = { A: { title: 3 } };
  assert.ok(hit(v(b).errors, "wbsMappings"));
  const ok = load(); ok.settings.wbsMappings = { A: { title: "件名", due: "期限" } };
  assert.deepEqual(v(ok).errors, []);
});

test("changeLog の source が wbs/calendar/inbox 以外なら error", () => {
  const a = load(); a.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "fax" });
  assert.ok(hit(v(a).errors, "source"));
  const m = load(); m.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail" });
  assert.ok(hit(v(m).errors, "source"));
  const ok = load(); ok.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "wbs" });
  assert.deepEqual(v(ok).errors, []);
});

test("新しい項目が無い従来のデータも error にならない", () => {
  const d = load();
  for (const t of d.tasks) { delete t.group; delete t.subgroup; delete t.wbsKey; }
  for (const e of d.events) { delete e.projectId; delete e.projectBy; delete e.confirmed; }
  delete d.settings.projectRules; delete d.settings.labels; delete d.settings.wbsMappings;
  assert.deepEqual(v(d).errors, []);
});

test("サンプルは新しい項目を使っている（大項目・会議のひも付け・規則）", () => {
  const d = load();
  assert.ok(d.tasks.some((t) => t.group && t.subgroup));
  assert.ok(d.events.some((e) => e.projectId && e.projectBy === "rule"));
  assert.ok(d.events.some((e) => e.confirmed === true));
  assert.deepEqual(d.settings.projectRules, [{ keyword: "ベンダーX", projectId: "A" }]);
  assert.equal(d.settings.labels.group, "大項目");
});

// ---- 受信箱（inbox） ----
const REQ = (extra = {}) => ({ id: "R1", at: "2026-10-21T10:00:00.000Z", projectId: null, status: "pending", thread: [{ role: "user", at: "2026-10-21T10:00:00.000Z", text: "依頼" }], proposal: null, result: null, ...extra });

test("inbox: 正しければ errors なし。inbox が無い従来のデータも通る。changeLog の source: inbox を認める", () => {
  const d = load();
  assert.deepEqual(v(d).errors, []);
  d.inbox = { watching: { at: "2026-10-21T10:00:00.000Z" }, requests: [REQ(), REQ({ id: "R2", status: "proposed", projectId: "A", proposal: { summary: "s", ops: [{ op: "moveDue", taskId: "A3", deltaDays: 5 }], sections: [], warnings: [], base: {} } })] };
  assert.deepEqual(v(d).errors, []);
  d.changeLog.push({ at: "2026-10-21", taskIds: ["A3"], reason: "受信箱", cause: null, deltaDays: 0, source: "inbox" });
  assert.deepEqual(v(d).errors, []);
});

test("inbox: 不正な status・重複 id・不明な projectId・不正な op・不正な thread・不正な watching は error", () => {
  const bad = [
    { requests: [REQ({ status: "done" })] },
    { requests: [REQ(), REQ()] },
    { requests: [REQ({ projectId: "ZZ" })] },
    { requests: [REQ({ proposal: { summary: "s", ops: [{ op: "deleteTask" }] } })] },
    { requests: [REQ({ thread: [{ role: "bot", at: "x", text: "y" }] })] },
    { requests: [REQ({ thread: "x" })] },
    { requests: "x" },
    { watching: { at: 5 }, requests: [] },
  ];
  for (const inbox of bad) {
    const d = load(); d.inbox = inbox;
    assert.ok(hit(v(d).errors, "inbox"), JSON.stringify(inbox));
  }
});

// ---- settings の形の注意（エラーにはしない） ----
const withSettings = (s) => { const d = load(); d.settings = { ...d.settings, ...s }; return d; };
const settingsWarn = (d, key) => v(d).warnings.filter((m) => m.startsWith(`settings.${key}:`));

test("settings: 形が違う workday・waitingLongDays・labels は注意（エラーにしない）", () => {
  const bad = {
    workday: [{ start: "9:00", end: "18:00" }, { start: "18:00", end: "09:00" }, { start: "09:00" }, "x"],
    waitingLongDays: ["7", 0, 1.5, -2],
    labels: ["x", { group: 1 }, { subgroup: null }],
  };
  for (const [key, values] of Object.entries(bad)) {
    for (const value of values) {
      const d = withSettings({ [key]: value });
      assert.equal(settingsWarn(d, key).length, 1, `${key}=${JSON.stringify(value)}`);
      assert.deepEqual(v(d).errors, [], `${key}=${JSON.stringify(value)}`);
    }
  }
});

test("settings: 正しい値と settings なしのファイルに、settings の注意は出ない", () => {
  const ok = withSettings({ workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: "フェーズ" } });
  assert.deepEqual(v(ok).warnings.filter((m) => m.startsWith("settings.")), []);
  const none = load();
  delete none.settings;
  assert.deepEqual(v(none).warnings.filter((m) => m.startsWith("settings.")), []);
  assert.deepEqual(v(load()).warnings.filter((m) => m.startsWith("settings.")), []);
});

test("settings: null は未設定として扱い（読む側は既定で動く）、注意を出さない。waitingLongDays の注意は既定で動くとは言わない", () => {
  for (const key of ["workday", "waitingLongDays", "labels"]) assert.equal(settingsWarn(withSettings({ [key]: null }), key).length, 0, key);
  const [w] = settingsWarn(withSettings({ waitingLongDays: 0 }), "waitingLongDays");
  assert.ok(!w.includes("既定の 7 で動きます") && w.includes("遅延バッジ"), w);
});

test("settings.holidays・workdays・nationalHolidays: 形が違うと注意（エラーにしない）。正しい形・未設定・null は出ない。前版の文字列の配列も注意", () => {
  const H = { date: "2026-10-26", kind: "有給", note: "x" };
  const bad = {
    holidays: ["2026-10-26", [H, { date: "2026-02-30", kind: "祝日" }], [{ date: "2026-10-26", kind: "休暇" }], [null], "x", {}],
    workdays: [["2026-10-26"], [{ date: "x" }], "x"],
    nationalHolidays: [5, { fetchedAt: "x", dates: [] }, { fetchedAt: "2026-10-25", dates: "x" }, { fetchedAt: "2026-10-25", dates: [{ date: "x" }] }],
  };
  for (const [key, values] of Object.entries(bad)) {
    for (const value of values) {
      const d = withSettings({ [key]: value });
      assert.equal(settingsWarn(d, key).length, 1, `${key}=${JSON.stringify(value)}`);
      assert.deepEqual(v(d).errors, [], `${key}=${JSON.stringify(value)}`);
    }
  }
  const ok = { holidays: [H, { date: "2026-11-23", kind: "祝日" }], workdays: [{ date: "2026-10-31" }], nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] } };
  for (const key of Object.keys(ok)) {
    assert.equal(settingsWarn(withSettings({ [key]: ok[key] }), key).length, 0, key);
    for (const value of [[], null]) if (key !== "nationalHolidays") assert.equal(settingsWarn(withSettings({ [key]: value }), key).length, 0, key);
    assert.equal(settingsWarn(withSettings({ [key]: null }), key).length, 0, key);
  }
});

test("settings.holidays の注意は、形の違う要素を data.json から直接直す旨を添える（画面から消せないため）", () => {
  const [w] = settingsWarn(withSettings({ holidays: ["2026-10-26"] }), "holidays");
  assert.match(w, /data\.json/);
});

test("警告: 終了済みのタスクに残る予定枠の警告は、まだ開始していない枠だけ（進行中の枠は、完了時に残す仕様なので警告しない）", () => {
  const d = load();
  const A1 = task(d, "A1"); // Done
  A1.sessions = [
    { id: "S90", date: NOW.date, start: "10:00", end: "23:00", kind: "planned" }, // 開始済み・未終了（進行中）
    { id: "S91", date: NOW.date, start: "23:00", end: "23:30", kind: "planned" }, // 開始前
  ];
  const now = { date: NOW.date, time: "12:00" };
  const w = validate(d, now).warnings.filter((m) => m.includes("未来の予定枠"));
  assert.equal(w.length, 1, w.join(" / "));
  assert.ok(w[0].includes("S91") && !w[0].includes("S90"));
});

test("settings.countWeekendsAndHolidays: 真偽値でないと注意（エラーにしない）。true・false・null・無しは注意なし", () => {
  for (const value of ["true", 1, [true], {}]) {
    const d = withSettings({ countWeekendsAndHolidays: value });
    assert.equal(settingsWarn(d, "countWeekendsAndHolidays").length, 1, JSON.stringify(value));
    assert.deepEqual(v(d).errors, [], JSON.stringify(value));
  }
  for (const value of [true, false, null]) assert.equal(settingsWarn(withSettings({ countWeekendsAndHolidays: value }), "countWeekendsAndHolidays").length, 0, String(value));
  assert.equal(settingsWarn(load(), "countWeekendsAndHolidays").length, 0);
});

test("inbox: 依頼で受けなくなった操作（setStatus）を持つ保存済みの提案も、検証は通す（データを読み捨てない）", () => {
  const d = load();
  d.inbox = { requests: [REQ({ status: "proposed", projectId: "A", proposal: { summary: "s", ops: [{ op: "setStatus", taskId: "A1", status: "Done" }], sections: [], warnings: [], base: {} } })] };
  assert.deepEqual(v(d).errors, []);
});

test("PROPOSE_OPS は addTask と moveDue だけ。OP_KINDS は保存済みの検証用に残る", () => {
  assert.deepEqual(PROPOSE_OPS, ["addTask", "moveDue"]);
  for (const k of PROPOSE_OPS) assert.ok(OP_KINDS.includes(k), k);
  assert.ok(OP_KINDS.includes("setStatus"));
});

test("作業枠の ID が別のタスクで重複していたら warning（保存は止めない）", () => {
  const d = load();
  const [a, b] = d.tasks.filter((t) => (t.sessions ?? []).length === 0).slice(0, 2);
  a.sessions = [{ id: "S99", date: "2026-10-26", start: "10:00", end: "11:00", kind: "planned" }];
  b.sessions = [{ id: "S99", date: "2026-10-27", start: "10:00", end: "11:00", kind: "planned" }];
  const r = v(d);
  assert.deepEqual(r.errors, []);
  assert.ok(hit(r.warnings, "作業枠の ID が重複しています: S99"));
  assert.ok(!hit(v(load()).warnings, "作業枠の ID が重複"), "サンプルは重複なし");
});

test("reportShowMeetingTitles が残っていても検証は何も言わない", () => {
  const r = v(withSettings({ reportShowMeetingTitles: "x" }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});
