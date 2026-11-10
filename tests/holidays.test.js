import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarOf, offDayChecker, restDayChecker, decodeHolidayCsv, parseHolidayCsv, pickRecent } from "../plugins/project-board/src/core/holidays.js";

test("calendarOf: 手動の休みと日本の祝日が off、営業日の指定が on。未設定は空", () => {
  const s = {
    holidays: [{ date: "2026-10-26", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
    workdays: [{ date: "2026-10-31" }],
  };
  assert.deepEqual(calendarOf(s), { off: ["2026-10-26", "2026-11-03"], on: ["2026-10-31"] });
  assert.deepEqual(calendarOf({}), { off: [], on: [] });
  assert.deepEqual(calendarOf(undefined), { off: [], on: [] });
});

test("calendarOf: 形が違う値・要素（前版の文字列の配列、null、日付でない）は無視し、例外にしない", () => {
  for (const bad of [{ holidays: ["2026-10-26"] }, { holidays: "x" }, { holidays: [null, { date: "x" }, { kind: "祝日" }] }, { workdays: [null, 5] }, { workdays: {} }, { nationalHolidays: 5 }, { nationalHolidays: { dates: "x" } }, { nationalHolidays: { dates: [null, { date: "x" }] } }]) {
    assert.deepEqual(calendarOf(bad), { off: [], on: [] }, JSON.stringify(bad));
  }
});

test("parseHolidayCsv: ヘッダ・空行・日付でない行を飛ばし、2026/1/1 を 2026-01-01 にして昇順で返す", () => {
  const csv = "国民の祝日・休日月日,国民の祝日・休日名称\r\n2026/11/3,文化の日\r\n2026/1/1,元日\r\n\r\nゴミ行\r\n2026/2/30,実在しない日\r\n2026/10/12,スポーツの日\r\n";
  assert.deepEqual(parseHolidayCsv(csv), [
    { date: "2026-01-01", name: "元日" }, { date: "2026-10-12", name: "スポーツの日" }, { date: "2026-11-03", name: "文化の日" },
  ]);
});

test("parseHolidayCsv: 有効な行が 0 のときは例外", () => {
  for (const bad of ["", "<html>error</html>", "国民の祝日・休日月日,国民の祝日・休日名称\r\n"]) assert.throws(() => parseHolidayCsv(bad), /祝日の一覧を読み取れませんでした/, JSON.stringify(bad));
});

test("decodeHolidayCsv: Shift_JIS のバイト列を読める（「元日」= 8C B3 93 FA）", () => {
  assert.equal(decodeHolidayCsv(Uint8Array.from([0x8c, 0xb3, 0x93, 0xfa])), "元日");
});

test("pickRecent: today の年の前年以降だけを返す", () => {
  const rows = [{ date: "2024-01-01", name: "a" }, { date: "2025-01-01", name: "b" }, { date: "2027-01-01", name: "c" }];
  assert.deepEqual(pickRecent(rows, "2026-10-25").map((r) => r.date), ["2025-01-01", "2027-01-01"]);
});

test("offDayChecker: 土日・休み・日本の祝日は休みの日。営業日の指定の日は、それらでも休みでない", () => {
  const s = {
    holidays: [{ date: "2026-10-27", kind: "有給" }, { date: "2026-10-28", kind: "祝日" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
    workdays: [{ date: "2026-10-24" }, { date: "2026-10-28" }, { date: "2026-11-03" }],
  };
  const off = offDayChecker(s);
  assert.deepEqual(["2026-10-26", "2026-10-29", "2026-11-02"].map(off), [false, false, false], "平日");
  assert.deepEqual(["2026-10-25", "2026-10-27", "2026-11-07"].map(off), [true, true, true], "日曜・手動の休み・土曜");
  assert.deepEqual(["2026-10-24", "2026-10-28", "2026-11-03"].map(off), [false, false, false], "営業日の指定が勝つ（土曜・手動の休み・日本の祝日）");
  assert.equal(offDayChecker(undefined)("2026-10-24"), true);
  assert.equal(offDayChecker({ holidays: "x", workdays: 5 })("2026-10-26"), false);
});

test("calendarOf・offDayChecker: オンのとき、土日と日本の祝日を休みにしない。手動の休みは休み。true 以外はオフ", () => {
  const s = {
    countWeekendsAndHolidays: true,
    holidays: [{ date: "2026-10-26", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
    workdays: [{ date: "2026-10-31" }],
  };
  assert.deepEqual(calendarOf(s), { off: ["2026-10-26"], on: ["2026-10-31"], countWeekends: true });
  const off = offDayChecker(s);
  assert.equal(off("2026-10-24"), false, "土");
  assert.equal(off("2026-11-03"), false, "祝日");
  assert.equal(off("2026-10-26"), true, "手動の休み");
  for (const v of ["true", 1, false]) assert.deepEqual(calendarOf({ ...s, countWeekendsAndHolidays: v }), { off: ["2026-10-26", "2026-11-03"], on: ["2026-10-31"] }, String(v));
  assert.equal(offDayChecker({ countWeekendsAndHolidays: "true" })("2026-10-24"), true);
});

test("restDayChecker: 土日・手動の休み・祝日は true。営業日の指定は false。土日祝を営業日に数える設定でも同じ", () => {
  const base = { holidays: [{ date: "2026-10-22" }], nationalHolidays: { dates: [{ date: "2026-11-03" }] }, workdays: [{ date: "2026-10-24" }] };
  for (const s of [base, { ...base, countWeekendsAndHolidays: true }]) {
    const rest = restDayChecker(s);
    assert.equal(rest("2026-10-22"), true, "手動の休み");
    assert.equal(rest("2026-11-03"), true, "祝日");
    assert.equal(rest("2026-10-25"), true, "日曜");
    assert.equal(rest("2026-10-24"), false, "営業日に指定した土曜");
    assert.equal(rest("2026-10-21"), false, "水曜");
  }
});
