import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionKind, addSession, moveSession, resizeSession, confirmSession, removeSession, taskActual, futurePlanned, runningPlanned } from "../plugins/project-board/src/core/sessions.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-board/data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "12:00" }; // 火曜
const task = (d, id) => d.tasks.find((t) => t.id === id);
const sess = (d, id) => d.tasks.flatMap((t) => t.sessions).find((s) => s.id === id);

test("sessionKind: 実績は常に actual、過ぎた予定は unconfirmed、途中は planned", () => {
  assert.equal(sessionKind({ kind: "actual", date: "2026-10-30", start: "10:00", end: "11:00" }, NOW), "actual");
  const p = { kind: "planned", date: "2026-10-20", start: "10:00", end: "11:00" };
  assert.equal(sessionKind(p, { date: "2026-10-20", time: "11:00" }), "unconfirmed");
  assert.equal(sessionKind(p, { date: "2026-10-20", time: "10:30" }), "planned");
  assert.equal(sessionKind(p, { date: "2026-10-21", time: "08:00" }), "unconfirmed");
});

test("addSession: 過去は actual／未来は planned／同じタスクに複数／ID は重複しない", () => {
  const d = load();
  const a = addSession(d, "A4", { date: "2026-10-19", start: "13:00", end: "14:00" }, NOW);
  assert.equal(a.error, undefined);
  assert.equal(task(a.data, "A4").sessions[0].kind, "actual");
  const b = addSession(a.data, "A4", { date: "2026-10-22", start: "13:00", end: "14:00" }, NOW);
  assert.equal(task(b.data, "A4").sessions[1].kind, "planned");
  const ids = b.data.tasks.flatMap((t) => t.sessions.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(task(d, "A4").sessions.length, 0, "元のデータは変えない");
});

test("addSession: 勤務時間外・土日・重なり・終了≦開始は error、会議との重なりは warning", () => {
  const d = load();
  const add = (slot) => addSession(d, "A4", slot, NOW);
  assert.ok(add({ date: "2026-10-22", start: "08:00", end: "09:30" }).error);
  assert.ok(add({ date: "2026-10-22", start: "17:30", end: "18:30" }).error);
  assert.ok(add({ date: "2026-10-24", start: "10:00", end: "11:00" }).error); // 土曜
  assert.ok(add({ date: "2026-10-22", start: "11:00", end: "11:00" }).error);
  assert.ok(add({ date: "2026-10-22", start: "11:00", end: "10:00" }).error);
  assert.ok(add({ date: "2026-10-22", start: "11:00", end: "12:30" }).error, "S5(10-12)と重なる");
  const w = add({ date: "2026-10-21", start: "10:30", end: "11:30" });
  assert.equal(w.error, undefined);
  assert.ok(w.warning);
});

test("スキップした会議とは重ならない扱い", () => {
  const d = load(); d.events.find((e) => e.id === "m3").skip = true;
  const r = addSession(d, "A4", { date: "2026-10-21", start: "10:00", end: "11:00" }, NOW);
  assert.equal(r.warning, undefined);
});

test("moveSession: 別の日へ移動、長さを保つ、自分の旧枠とは重ならない", () => {
  const d = load();
  const m = moveSession(d, "S5", { date: "2026-10-23", start: "14:00" }, NOW);
  assert.equal(m.error, undefined);
  assert.deepEqual([sess(m.data, "S5").date, sess(m.data, "S5").start, sess(m.data, "S5").end], ["2026-10-23", "14:00", "16:00"]);
  const self = moveSession(d, "S5", { date: "2026-10-22", start: "10:30" }, NOW);
  assert.equal(self.error, undefined);
  assert.ok(moveSession(d, "S5", { date: "2026-10-21", start: "14:30" }, NOW).error, "S3(14-16)と重なる");
  assert.ok(moveSession(d, "S5", { date: "2026-10-22", start: "17:00" }, NOW).error, "18:00 を超える");
});

test("resizeSession: 15分未満・18:00 超過・重なりは error", () => {
  const d = load();
  assert.equal(sess(resizeSession(d, "S5", "13:00").data, "S5").end, "13:00");
  assert.ok(resizeSession(d, "S5", "10:10").error);
  assert.ok(resizeSession(d, "S3", "18:15").error);
  const d2 = load(); task(d2, "A4").sessions.push({ id: "S9", date: "2026-10-22", start: "12:30", end: "13:30", kind: "planned" });
  assert.ok(resizeSession(d2, "S5", "13:00").error);
});

test("confirmSession: 過去の予定は actual、未来は error", () => {
  const d = load();
  d.tasks.find((t) => t.id === "A5").sessions[2] = { id: "S3", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned" };
  assert.equal(sess(confirmSession(d, "S3", NOW).data, "S3").kind, "actual");
  assert.ok(confirmSession(load(), "S5", NOW).error);
});

test("removeSession と、枠の操作でタスクの状態は変わらない", () => {
  const d = load();
  const r = removeSession(d, "S1");
  assert.equal(sess(r, "S1"), undefined);
  assert.ok(sess(r, "S2"));
  const before = JSON.stringify(d.tasks.map((t) => [t.id, t.status, t.doneAt]));
  let x = addSession(d, "A4", { date: "2026-10-19", start: "13:00", end: "14:00" }, NOW).data;
  x = moveSession(x, "S5", { date: "2026-10-23", start: "14:00" }, NOW).data;
  x = resizeSession(x, "S5", "17:00").data;
  x = removeSession(x, "S2");
  assert.equal(JSON.stringify(x.tasks.map((t) => [t.id, t.status, t.doneAt])), before);
});

test("taskActual / futurePlanned", () => {
  const d = load();
  const t = task(d, "A5");
  assert.deepEqual(taskActual(d, "A5"), { hours: 3.5, firstDate: "2026-10-14", count: 3 });
  assert.deepEqual(taskActual(d, "A4"), { hours: 0, firstDate: null, count: 0 });
  assert.deepEqual(futurePlanned(d, "A5", NOW), ["S3"]);
  assert.deepEqual(futurePlanned(d, "A1", NOW), []);
  assert.equal(t.sessions.length, 3);
});

test("実績の枠を未来へ動かす・延ばすと予定に戻る（I3）", () => {
  const d = load();
  const m = moveSession(d, "S1", { date: "2026-10-28", start: "13:00" }, NOW);
  assert.equal(sess(m.data, "S1").kind, "planned");
  assert.equal(sess(moveSession(d, "S1", { date: "2026-10-16", start: "13:00" }, NOW).data, "S1").kind, "actual", "過去へなら実績のまま");
  // 10/20 09:00-10:00 の実績を 14:00 まで延ばす（現在 12:00 より後）
  const d2 = load(); d2.tasks.find((t) => t.id === "A4").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "10:00", kind: "actual" });
  d2.events = [];
  assert.equal(sess(resizeSession(d2, "S9", "14:00", NOW).data, "S9").kind, "planned");
  assert.equal(sess(resizeSession(d2, "S9", "11:00", NOW).data, "S9").kind, "actual");
});

test("addSession・moveSession: 土日・手動の休み・日本の祝日には置けない。営業日として扱う日に指定した日には置ける", () => {
  const d = load();
  d.settings = {
    ...d.settings,
    holidays: [{ date: "2026-10-27", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
  };
  const slot = (date) => ({ date, start: "10:00", end: "11:00" });
  const add = (date, data = d) => addSession(data, "A4", slot(date), NOW);
  assert.match(add("2026-10-24").error, /土日には置けません/);
  assert.match(add("2026-10-27").error, /休みの日には置けません/);
  assert.match(add("2026-11-03").error, /休みの日には置けません/);
  assert.match(add("2026-10-27").error, /営業日として扱う日/, "置く方法を添える");
  assert.equal(add("2026-10-29").error, undefined, "平日は置ける");
  const w = { ...d, settings: { ...d.settings, workdays: [{ date: "2026-10-24" }, { date: "2026-10-27" }, { date: "2026-11-03" }] } };
  for (const date of ["2026-10-24", "2026-10-27", "2026-11-03"]) assert.equal(add(date, w).error, undefined, date);
  const moved = moveSession(w, "S5", { date: "2026-10-24", start: "10:00" }, NOW);
  assert.equal(moved.error, undefined, "動かす先にも効く");
  assert.match(moveSession(d, "S5", { date: "2026-10-27", start: "10:00" }, NOW).error, /休みの日には置けません/);
});

test("休みの日にすでにある枠は、同じ日の中なら伸縮も移動もできる（日付を変えて休みの日へ動かすことはできない）", () => {
  const d = load();
  d.settings = { ...d.settings, holidays: [{ date: "2026-10-22", kind: "有給" }] }; // S5 は 10-22 10:00-12:00
  assert.equal(resizeSession(d, "S5", "12:30", NOW).error, undefined, "伸縮");
  assert.equal(moveSession(d, "S5", { date: "2026-10-22", start: "13:00" }, NOW).error, undefined, "同じ日の中の移動");
  assert.match(moveSession(d, "S4", { date: "2026-10-22", start: "13:00" }, NOW).error, /休みの日には置けません/, "別の日の枠を休みの日へ動かすのは不可");
  assert.equal(moveSession(d, "S5", { date: "2026-10-23", start: "13:00" }, NOW).error, undefined, "休みの日から平日へは動かせる");
});

test("置けない日のエラーは、どこで指定するかを添える（設定タブ）", () => {
  const e = addSession(load(), "A4", { date: "2026-10-24", start: "10:00", end: "11:00" }, NOW).error;
  assert.match(e, /設定タブ.*営業日として扱う日/);
});

test("futurePlanned: まだ開始していない予定の枠だけ。進行中（開始済みで未終了）の枠・終了した枠・実績は含めない", () => {
  const d = load();
  const A5 = task(d, "A5");
  A5.sessions.push(
    { id: "S20", date: "2026-10-20", start: "11:00", end: "13:00", kind: "planned" }, // NOW 12:00: 進行中
    { id: "S21", date: "2026-10-20", start: "12:00", end: "13:00", kind: "planned" }, // ちょうど開始した枠も進行中
    { id: "S22", date: "2026-10-20", start: "12:30", end: "13:30", kind: "planned" }, // 開始前
    { id: "S23", date: "2026-10-20", start: "09:00", end: "10:00", kind: "planned" }, // 終了済み（未確認）
  );
  assert.deepEqual(futurePlanned(d, "A5", NOW), ["S3", "S22"]);
});

test("runningPlanned: 進行中（開始済みで未終了）の予定枠の ID。開始前・終了済み・実績は含めない", () => {
  const d = load();
  task(d, "A5").sessions.push(
    { id: "S20", date: "2026-10-20", start: "11:00", end: "13:00", kind: "planned" }, // NOW 12:00: 進行中
    { id: "S21", date: "2026-10-20", start: "12:00", end: "13:00", kind: "planned" }, // ちょうど開始: 進行中
    { id: "S22", date: "2026-10-20", start: "12:30", end: "13:30", kind: "planned" }, // 開始前
    { id: "S23", date: "2026-10-20", start: "09:00", end: "12:00", kind: "planned" }, // ちょうど終了: 終了済み
  );
  assert.deepEqual(runningPlanned(d, "A5", NOW), ["S20", "S21"]);
  assert.deepEqual(runningPlanned(d, "A1", NOW), []);
});

test("addSession: 土日祝を営業日に数える設定がオンなら、土日・祝日にも置ける。手動の休みには置けず、文は「休みの日」。オフに戻すと再び置けない", () => {
  const d = load();
  d.settings = {
    ...d.settings,
    countWeekendsAndHolidays: true,
    holidays: [{ date: "2026-10-31", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
  };
  const add = (date, data = d) => addSession(data, "A4", { date, start: "10:00", end: "11:00" }, NOW);
  assert.equal(add("2026-10-24").error, undefined, "土");
  assert.equal(add("2026-10-25").error, undefined, "日");
  assert.equal(add("2026-11-03").error, undefined, "祝日");
  const e = add("2026-10-31").error; // 土曜の手動の休み
  assert.match(e, /休みの日には置けません/);
  assert.doesNotMatch(e, /土日/);
  const off = { ...d, settings: { ...d.settings, countWeekendsAndHolidays: false } };
  assert.match(add("2026-10-24", off).error, /土日には置けません/);
  assert.match(add("2026-11-03", off).error, /休みの日には置けません/);
});
