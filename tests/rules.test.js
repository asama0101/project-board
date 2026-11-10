import { test } from "node:test";
import assert from "node:assert/strict";
import { matchProject, assignMeetingProjects, setProjectRule, removeProjectRule, renameProjectRule, ruleMeetingCounts, moveProjectRule } from "../plugins/project-board/src/core/rules.js";

const ev = (id, title, extra = {}) => ({ id, date: "2026-10-20", start: "10:00", end: "11:00", title, source: "mcp", skip: false, externalId: id, ...extra });
const data = (events, rules = [], projects = ["A", "B"]) => ({
  settings: { projectRules: rules }, projects: projects.map((id) => ({ id })), tasks: [], events, changeLog: [],
});
const R = [{ keyword: "ベンダーX", projectId: "A" }, { keyword: "回線", projectId: "B" }];

test("matchProject: 大文字小文字を区別せず先の規則を優先、空の keyword は無視", () => {
  const rules = [{ keyword: "", projectId: "X" }, { keyword: "vendor", projectId: "A" }, { keyword: "定例", projectId: "B" }];
  assert.equal(matchProject("Vendor 打合せ 定例", rules), "A");
  assert.equal(matchProject("部内会議", rules), null);
  assert.equal(matchProject("", rules), null);
});

test("assignMeetingProjects: 規則で付け、manual は変えず、規則が消えたら rule の分だけ外れる", () => {
  const d = data([ev("m1", "ベンダーX 打合せ"), ev("m2", "回線 工事", { projectId: "A", projectBy: "manual" }), ev("m3", "部内会議")], R);
  const a = assignMeetingProjects(d);
  const get = (x, id) => x.events.find((e) => e.id === id);
  assert.deepEqual([get(a, "m1").projectId, get(a, "m1").projectBy], ["A", "rule"]);
  assert.deepEqual([get(a, "m2").projectId, get(a, "m2").projectBy], ["A", "manual"]);
  assert.equal(get(a, "m3").projectId ?? null, null);
  const cleared = assignMeetingProjects({ ...a, settings: { projectRules: [] } });
  assert.equal(get(cleared, "m1").projectId ?? null, null);
  assert.equal(get(cleared, "m1").projectBy, undefined);
  assert.deepEqual([get(cleared, "m2").projectId, get(cleared, "m2").projectBy], ["A", "manual"]);
  assert.equal(get(d, "m1").projectId, undefined, "元のデータは変わらない");
});

test("assignMeetingProjects: 存在しないプロジェクトの規則は無視する", () => {
  const d = data([ev("m1", "ベンダーX 打合せ")], R, ["B"]);
  assert.equal(assignMeetingProjects(d).events[0].projectId ?? null, null);
});

test("setProjectRule/removeProjectRule: 追加・置き換え・削除ができ、既存の会議に反映される。空の keyword と不明なプロジェクトは例外", () => {
  const d = data([ev("m1", "NW 定例")], []);
  const a = setProjectRule(d, "定例", "A");
  assert.deepEqual(a.settings.projectRules, [{ keyword: "定例", projectId: "A" }]);
  assert.equal(a.events[0].projectId, "A");
  const b = setProjectRule(a, "定例", "B");
  assert.deepEqual(b.settings.projectRules, [{ keyword: "定例", projectId: "B" }]);
  assert.equal(b.events[0].projectId, "B");
  const c = removeProjectRule(b, "定例");
  assert.deepEqual(c.settings.projectRules, []);
  assert.equal(c.events[0].projectId ?? null, null);
  assert.throws(() => setProjectRule(d, " ", "A"));
  assert.throws(() => setProjectRule(d, "x", "ZZ"));
});

test("assignMeetingProjects: projectBy の無い projectId（手で書かれたもの）は変えず、関係のない会議は同じオブジェクトのまま", () => {
  const d = data([ev("m1", "部内会議", { projectId: "B" }), ev("m2", "部内会議")], R);
  const a = assignMeetingProjects(d);
  assert.equal(a.events[0].projectId, "B");
  assert.equal(a.events[1], d.events[1]);
});

test("renameProjectRule: キーワードだけ変え、順序・プロジェクトを保ち、会議へ付け直す", () => {
  const d = assignMeetingProjects(data([ev("m1", "ベンダーX 打合せ"), ev("m2", "回線 工事")], R));
  const r = renameProjectRule(d, "ベンダーX", " 納入業者 ");
  assert.deepEqual(r.settings.projectRules, [{ keyword: "納入業者", projectId: "A" }, { keyword: "回線", projectId: "B" }]);
  const get = (id) => r.events.find((e) => e.id === id);
  assert.equal(get("m1").projectId ?? null, null, "旧キーワードで付いた会議は外れる");
  assert.equal(get("m2").projectId, "B");
});

test("renameProjectRule: 空・不明な元・他の規則と同じキーワード（大文字小文字を無視）は例外。自分自身への変更（大文字小文字だけ）は通る", () => {
  const d = data([], [{ keyword: "Vendor", projectId: "A" }, { keyword: "回線", projectId: "B" }]);
  assert.throws(() => renameProjectRule(d, "Vendor", "  "));
  assert.throws(() => renameProjectRule(d, "無い", "x"));
  assert.throws(() => renameProjectRule(d, "Vendor", "回線"));
  assert.equal(renameProjectRule(d, "Vendor", "VENDOR").settings.projectRules[0].keyword, "VENDOR");
});

test("ruleMeetingCounts: 規則の並びで、その規則で付いている会議の件数。先に当たった規則だけが数え、manual は数えない", () => {
  const rules = [{ keyword: "ベンダー", projectId: "A" }, { keyword: "ベンダーX", projectId: "B" }, { keyword: "未使用", projectId: "A" }];
  const d = assignMeetingProjects(data([ev("m1", "ベンダーX 打合せ"), ev("m2", "ベンダー 定例"), ev("m3", "ベンダー 臨時", { projectId: "B", projectBy: "manual" })], rules));
  assert.deepEqual(ruleMeetingCounts(d), [2, 0, 0]);
  assert.deepEqual(ruleMeetingCounts(data([], [])), []);
  assert.deepEqual(ruleMeetingCounts({ settings: {}, events: [] }), []);
});

test("moveProjectRule: 1 つ上・下へ動かす。先頭の上・末尾の下は変えない。無いキーワードは例外。元のデータは変えない", () => {
  const rules = [{ keyword: "a", projectId: "A" }, { keyword: "b", projectId: "B" }, { keyword: "c", projectId: "A" }];
  const d = data([], rules);
  const kw = (x) => x.settings.projectRules.map((r) => r.keyword).join("");
  assert.equal(kw(moveProjectRule(d, "b", -1)), "bac");
  assert.equal(kw(moveProjectRule(d, "b", 1)), "acb");
  assert.equal(kw(moveProjectRule(d, "a", -1)), "abc");
  assert.equal(kw(moveProjectRule(d, "c", 1)), "abc");
  assert.equal(kw(moveProjectRule(d, " B ", -1)), "bac", "大文字小文字・前後の空白を無視");
  assert.throws(() => moveProjectRule(d, "zzz", 1), /zzz/);
  assert.equal(kw(d), "abc");
});

test("moveProjectRule: 入れ替えると、両方に当たる rule の会議は新しい先頭の規則のものになり、manual の会議は変わらない", () => {
  const rules = [{ keyword: "ベンダーX", projectId: "A" }, { keyword: "見積", projectId: "B" }];
  const d = assignMeetingProjects(data([ev("m1", "ベンダーX 見積会議"), ev("m2", "ベンダーX 見積会議", { projectId: "C", projectBy: "manual" })], rules, ["A", "B", "C"]));
  const get = (x, id) => x.events.find((e) => e.id === id);
  assert.equal(get(d, "m1").projectId, "A");
  const moved = moveProjectRule(d, "見積", -1);
  assert.deepEqual([get(moved, "m1").projectId, get(moved, "m1").projectBy], ["B", "rule"]);
  assert.deepEqual([get(moved, "m2").projectId, get(moved, "m2").projectBy], ["C", "manual"]);
});

test("assignMeetingProjects: projectBy が null で projectId のある会議は、手で書かれたものとして変えない", () => {
  const d = data([ev("m1", "無関係", { projectId: "A", projectBy: null })], R);
  assert.equal(assignMeetingProjects(d).events[0].projectId, "A");
});
