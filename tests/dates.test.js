import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAfter } from "../plugins/project-board/src/core/dates.js";

test("dueAfter: 営業日後の日付（土日を飛ばす。0 は同じ日、休日の起点もそのまま）", () => {
  assert.equal(dueAfter("2026-10-23", 1), "2026-10-26"); // 金 → 月
  assert.equal(dueAfter("2026-10-23", 5), "2026-10-30");
  assert.equal(dueAfter("2026-10-24", 0), "2026-10-24"); // 土の 0 営業日
  assert.equal(dueAfter("2026-10-24", 1), "2026-10-26"); // 土 → 次の営業日が 1 営業日後
  assert.equal(dueAfter("2026-12-30", 3), "2027-01-04");
});

test("dueAfter: 休み（off）を飛ばす。土日と重なる休み・重複した休みでもずれない", () => {
  assert.equal(dueAfter("2026-10-23", 1, { off: ["2026-10-26"] }), "2026-10-27");
  assert.equal(dueAfter("2026-10-23", 1, { off: ["2026-10-24"] }), "2026-10-26"); // 土曜の休み
  assert.equal(dueAfter("2026-10-23", 1, { off: ["2026-10-26", "2026-10-26"] }), "2026-10-27");
  assert.equal(dueAfter("2026-10-26", 0, { off: ["2026-10-26"] }), "2026-10-26"); // 休みの 0 営業日
});

test("dueAfter: 営業日の指定（on）は、土日も休みも打ち消す。on と off が同じ日なら on が勝つ", () => {
  assert.equal(dueAfter("2026-10-23", 1, { on: ["2026-10-24"] }), "2026-10-24"); // 土曜が営業日
  assert.equal(dueAfter("2026-10-23", 1, { off: ["2026-10-26"], on: ["2026-10-26"] }), "2026-10-26");
  assert.equal(dueAfter("2026-10-23", 2, { off: ["2026-10-26"], on: ["2026-10-24"] }), "2026-10-27");
});

test("dueAfter: 負数・小数・数値でない営業日、不正な日付は例外", () => {
  assert.throws(() => dueAfter("2026-10-20", -1), /営業日/);
  assert.throws(() => dueAfter("2026-10-20", 1.5), /営業日/);
  assert.throws(() => dueAfter("2026-10-20", "3"), /営業日/);
  assert.throws(() => dueAfter("2026-13-01", 3), /日付/);
});

test("dueAfter: countWeekends が true なら土日を飛ばさない。休み（off）は飛ばす。false・省略は今まで", () => {
  assert.equal(dueAfter("2026-10-30", 1, {}), "2026-11-02"); // 金 → 月（今まで）
  assert.equal(dueAfter("2026-10-30", 1, { countWeekends: true }), "2026-10-31"); // 金 → 土
  assert.equal(dueAfter("2026-10-30", 2, { countWeekends: true, off: ["2026-10-31"] }), "2026-11-02"); // 土が手動の休みなら飛ばす
  assert.equal(dueAfter("2026-10-30", 1, { countWeekends: false }), "2026-11-02");
});

test("dueAfter: 営業日が 3650 日（約 10 年）を超えるなら、数え始めずに例外にする（打ち間違いで止まらない）", () => {
  assert.equal(dueAfter("2026-10-23", 3650).length, 10);
  assert.throws(() => dueAfter("2026-10-23", 3651), /3650/);
  assert.throws(() => dueAfter("2026-10-23", 1000000000), /3650/);
  assert.equal(dueAfter("2026-10-23", 0), "2026-10-23");
});
