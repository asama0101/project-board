import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planDone } from "../plugins/project-board/src/ui/donecheck.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/project-board/data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "10:15" };

test("planDone: Done にするとき、未チェックの項目の文言と、解除される未来の予定枠を返す（A5 は 2/4 済みで、明日の予定枠 S3 がある）", () => {
  assert.deepEqual(planDone(load(), "A5", "Done", NOW), { open: ["作業時間を見積もる", "レビューを受ける"], future: ["S3"] });
});

test("planDone: Cancelled は未来の予定枠だけ。他の状態へは何も返さない", () => {
  assert.deepEqual(planDone(load(), "A5", "Cancelled", NOW), { open: [], future: ["S3"] });
  assert.deepEqual(planDone(load(), "A5", "In Progress", NOW), { open: [], future: [] });
  assert.deepEqual(planDone(load(), "A5", "Waiting", NOW), { open: [], future: [] });
});

test("planDone: 全部済み・項目なしのタスクは open が空", () => {
  assert.deepEqual(planDone(load(), "A1", "Done", NOW).open, []); // 3/3
  assert.deepEqual(planDone(load(), "A4", "Done", NOW), { open: [], future: [] }); // 項目なし
});
