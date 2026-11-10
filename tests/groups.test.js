import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLabels, groupSections } from "../plugins/project-board/src/core/groups.js";

const t = (id, group, subgroup) => ({ id, group, subgroup });

test("groupLabels: 既定と上書き（空文字は無視）", () => {
  assert.deepEqual(groupLabels(undefined), { group: "大項目", subgroup: "中項目" });
  assert.deepEqual(groupLabels({ labels: { group: "フェーズ", subgroup: "  " } }), { group: "フェーズ", subgroup: "中項目" });
});

const shape = (s) => s.map((x) => [x.group, x.subgroup, x.tasks.map((y) => y.id)]);

test("groupSections: 大項目ごとに束ね、中項目は大項目の中で登場順。タスクの順序を保つ", () => {
  const s = groupSections([t("1", "設計", "要件"), t("2", "構築", null), t("3", "設計", "要件"), t("4", undefined, undefined), t("5", "設計", "方式")]);
  assert.deepEqual(shape(s), [
    ["設計", "要件", ["1", "3"]], ["設計", "方式", ["5"]], ["構築", "", ["2"]], ["", "", ["4"]],
  ]);
});

test("groupSections: 大項目が空で中項目だけあるタスクは末尾のブロックに入る", () => {
  const s = groupSections([t("1", "", "メモ"), t("2", "A", "x"), t("3", null, null)]);
  assert.deepEqual(s.map((x) => [x.group, x.subgroup]), [["A", "x"], ["", "メモ"], ["", ""]]);
});

test("groupSections: ensureNone は空の「なし」を末尾に足し、すでにあれば足さない", () => {
  assert.deepEqual(groupSections([], { ensureNone: true }), [{ group: "", subgroup: "", tasks: [] }]);
  assert.deepEqual(shape(groupSections([t("1", "A", "")], { ensureNone: true })), [["A", "", ["1"]], ["", "", []]]);
  assert.deepEqual(shape(groupSections([t("1", null, null)], { ensureNone: true })), [["", "", ["1"]]]);
});
