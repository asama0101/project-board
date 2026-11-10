import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "pjl-intake-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
/** サンプルを複製した作業フォルダと、そこへ JSON を書く道具 */
function work() {
  const dir = join(base, String(++n));
  rmSync(dir, { recursive: true, force: true });
  const data = join(dir, "data.json");
  mkdirP(dir);
  copyFileSync(join(REPO, "data/sample.json"), data);
  const put = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
  return { data, put, read: () => readFileSync(data, "utf8"), json: () => JSON.parse(readFileSync(data, "utf8")) };
}
import { mkdirSync } from "node:fs";
const mkdirP = (d) => mkdirSync(d, { recursive: true });
const run = (...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/intake.js"), ...args], { encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr, raw: r.stdout };
};

const ROWS = [
  { group: "設計", subgroup: "要件", title: "要件の確認", due: "2026-11-10" },
  { group: "設計", subgroup: "要件", title: "基本設計", due: "2026-11-20", predecessorKeys: ["設計/要件/要件の確認"] },
];

test("wbs-plan は data.json を1バイトも変えない", () => {
  const w = work(); const before = w.read();
  const r = run("wbs-plan", w.data, "A", w.put("rows.json", ROWS));
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.add.length, 2);
  assert.equal(w.read(), before);
});

test("wbs-apply: タスクが増え、2回目の wbs-plan は add が0件", () => {
  const w = work(); const rows = w.put("rows.json", ROWS);
  const before = w.json().tasks.length;
  const r = run("wbs-apply", w.data, "A", rows);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.summary, { added: 2, updated: 0 });
  assert.equal(w.json().tasks.length, before + 2);
  assert.equal(run("wbs-plan", w.data, "A", rows).out.add.length, 0);
});

test("wbs-apply: --source のファイル名が取り込み記録に入る（なければ null）", () => {
  const w = work(); const rows = w.put("rows.json", ROWS);
  assert.equal(run("wbs-apply", w.data, "A", rows, "--source", "plan.xlsx").status, 0);
  assert.deepEqual(w.json().settings.wbsImports.A, { file: "plan.xlsx", at: w.json().settings.wbsImports.A.at, added: 2, updated: 0 });
  const w2 = work(); const rows2 = w2.put("rows.json", ROWS);
  assert.equal(run("wbs-apply", w2.data, "A", rows2).status, 0);
  assert.equal(w2.json().settings.wbsImports.A.file, null);
});

test("wbs-apply: 前のタスクが循環する rows では終了コード1で data.json は変わらない", () => {
  const w = work(); const before = w.read();
  const rows = w.put("rows.json", [
    { title: "X1", due: "2026-11-01", predecessorKeys: ["X2"] }, { title: "X2", due: "2026-11-02", predecessorKeys: ["X1"] },
  ]);
  const r = run("wbs-apply", w.data, "A", rows);
  assert.equal(r.status, 1);
  assert.ok(r.err.length > 0);
  assert.equal(w.read(), before);
});

test("calendar-apply: 会議が追加され、規則でプロジェクトが付く。calendar-plan は書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", [{ externalId: "ext-new", title: "ベンダーX 週次", date: "2026-10-22", start: "15:00", end: "16:00" }]);
  const before = w.read();
  const p = run("calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(p.status, 0, p.err);
  assert.equal(p.out.added.length, 1);
  assert.equal(w.read(), before);
  assert.equal(run("calendar-apply", w.data, fetched, "2026-10-19", "2026-10-25").status, 0);
  const e = w.json().events.find((x) => x.externalId === "ext-new");
  assert.deepEqual([e.projectId, e.projectBy], ["A", "rule"]);
});

test("calendar-apply: 反映後のデータが検証に通らないときは、終了コード 1 で何も書かない", () => {
  const w = work();
  const d = w.json();
  d.events.push({ id: "mz", date: "2026-10-22", start: "09:00", end: "10:00", title: "x", source: "mcp", skip: false, externalId: "ext-z", projectId: "ZZ" });
  writeFileSync(w.data, JSON.stringify(d));
  const before = w.read();
  const fetched = w.put("fetched.json", [{ externalId: "ext-z", title: "x", date: "2026-10-22", start: "09:00", end: "10:00" }]);
  const r = run("calendar-apply", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(r.status, 1);
  assert.match(r.err, /ZZ/);
  assert.equal(w.read(), before);
});

test("rules-apply: manual のひも付けは変わらない", () => {
  const w = work();
  const d = w.json(); d.events.find((e) => e.id === "m3").projectId = "B"; d.events.find((e) => e.id === "m3").projectBy = "manual";
  writeFileSync(w.data, JSON.stringify(d));
  assert.equal(run("rules-apply", w.data).status, 0);
  const e = w.json().events;
  assert.equal(e.find((x) => x.id === "m3").projectId, "B");
  assert.equal(e.find((x) => x.id === "m2").projectId, "A");
});

test("rules-set→rules-list→rules-remove の往復。不明なプロジェクトは終了コード1で data.json は変わらない", () => {
  const w = work();
  assert.equal(run("rules-set", w.data, "部内", "B").status, 0);
  assert.deepEqual(run("rules-list", w.data).out.map((r) => r.keyword), ["ベンダーX", "部内"]);
  assert.equal(w.json().events.find((e) => e.id === "m3").projectId, "B");
  assert.equal(run("rules-remove", w.data, "部内").status, 0);
  assert.deepEqual(run("rules-list", w.data).out.map((r) => r.keyword), ["ベンダーX"]);
  const before = w.read();
  assert.equal(run("rules-set", w.data, "x", "ZZ").status, 1);
  assert.equal(w.read(), before);
});

test("mapping-set→mapping-get の往復。mapping-get は保存が無ければ null で、ファイルを書かない", () => {
  const w = work(); const before = w.read();
  assert.equal(run("mapping-get", w.data, "A").out, null);
  assert.equal(w.read(), before);
  assert.equal(run("mapping-set", w.data, "A", w.put("map.json", { title: "作業名", due: "期限" })).status, 0);
  assert.deepEqual(run("mapping-get", w.data, "A").out, { title: "作業名", due: "期限" });
  assert.equal(run("mapping-set", w.data, "A", w.put("bad.json", { due: "期限" })).status, 1);
});

test("引数が足りないと終了コード2と使い方を出す", () => {
  assert.equal(run().status, 2);
  const r = run("wbs-plan");
  assert.equal(r.status, 2);
  assert.match(r.err, /使い方/);
  assert.equal(run("unknown-cmd", "x").status, 2);
});

// ---- 自分だけ・自分と会議室だけの予定を除く（設定は project-board-mcp.json から読む） ----
const runEnv = (env, ...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/intake.js"), ...args], { encoding: "utf8", env: { ...process.env, PJ_LENS_HOME: "", ...env } });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr };
};
const SELF = "me@example.com";
const fetchedSolo = () => [
  { externalId: "solo1", title: "作業ブロック", date: "2026-10-22", start: "09:00", end: "10:00", attendees: [{ type: "person", email: SELF, name: "me" }] },
  { externalId: "solo2", title: "ひとりで会議室", date: "2026-10-22", start: "10:00", end: "11:00", attendees: [{ type: "person", email: SELF, name: "me" }, { type: "resource", email: "r@example.com", name: "会議室 A" }] },
  { externalId: "mtg1", title: "ベンダーX 週次", date: "2026-10-22", start: "15:00", end: "16:00", attendees: [{ type: "person", email: SELF, name: "me" }, { type: "person", email: "v@example.com", name: "v" }] },
];
const homeWith = (cal) => {
  const home = join(base, `home${++n}`);
  mkdirP(home);
  writeFileSync(join(home, "project-board-mcp.json"), JSON.stringify({ schema_version: 1, calendar: { server: "s", listTool: "l", ...cal } }));
  return home;
};

test("calendar-plan・calendar-apply: 設定の selfEmails（PJ_LENS_HOME か --data の置き場）で、自分だけ・自分と会議室だけの予定を取り込まず、excluded に出す。plan は書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const home = homeWith({ selfEmails: [SELF] });
  const before = w.read();
  for (const env of [{ PJ_LENS_HOME: home }, {}]) {
    const args = env.PJ_LENS_HOME ? [] : ["--data", home];
    const p = runEnv(env, "calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25", ...args);
    assert.equal(p.status, 0, p.err);
    assert.deepEqual([p.out.added.map((e) => e.externalId), p.out.excluded.map((e) => e.externalId), p.out.warnings], [["mtg1"], ["solo1", "solo2"], []]);
    assert.equal(w.read(), before);
  }
  const a = runEnv({ PJ_LENS_HOME: home }, "calendar-apply", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(a.status, 0, a.err);
  assert.deepEqual([a.out.summary.added, a.out.summary.excluded], [1, 2]);
  assert.deepEqual(w.json().events.filter((e) => e.source === "mcp" && e.externalId.startsWith("solo")), []);
});

test("calendar-plan: 設定の selfNames だけ（selfEmails なし）でも、名前が一致する自分だけの予定を除く", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const p = runEnv({ PJ_LENS_HOME: homeWith({ selfNames: ["me"] }) }, "calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(p.status, 0, p.err);
  assert.deepEqual([p.out.added.map((e) => e.externalId), p.out.excluded.map((e) => e.externalId), p.out.warnings], [["mtg1"], ["solo1", "solo2"], []]);
});

test("calendar-plan: 設定がない（置き場がない・selfEmails が未設定）ときは、何も除かず、warnings に出す", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  for (const env of [{}, { PJ_LENS_HOME: homeWith({}) }]) {
    const p = runEnv(env, "calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25");
    assert.equal(p.status, 0, p.err);
    assert.deepEqual([p.out.added.length, p.out.excluded.length], [3, 0]);
    assert.match(p.out.warnings[0], /selfEmails/);
  }
});

test("calendar-plan: excluded には、参加者（メールアドレス）を含めず、externalId・件名・日時だけを出す", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const p = runEnv({ PJ_LENS_HOME: homeWith({ selfEmails: [SELF] }) }, "calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(p.status, 0, p.err);
  assert.deepEqual(p.out.excluded[0], { externalId: "solo1", title: "作業ブロック", date: "2026-10-22", start: "09:00", end: "10:00" });
  assert.ok(!JSON.stringify(p.out.excluded).includes("example.com"));
});

test("calendar-plan・calendar-apply: 設定ファイルの指定が正しくない（selfEmails が文字列、など）ときは、理由を出して止まり、何も書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", fetchedSolo());
  const before = w.read();
  const env = { PJ_LENS_HOME: homeWith({ selfEmails: SELF }) };
  for (const cmd of ["calendar-plan", "calendar-apply"]) {
    const r = runEnv(env, cmd, w.data, fetched, "2026-10-19", "2026-10-25");
    assert.equal(r.status, 1);
    assert.match(r.err, /project-board-mcp\.json.*selfEmails/s);
  }
  assert.equal(w.read(), before);
});

test("calendar-plan: 取り込み済みの会議が対象外になって削除される場合は、removedByExclusion に、確認済み（confirmed）かどうかとあわせて出る（エージェントの文章に頼らず、確認済みの実績が消えることを見せるため）", () => {
  const w = work();
  const d = w.json();
  d.events.push({ id: "m90", date: "2026-10-22", start: "09:00", end: "10:00", title: "作業ブロック", source: "mcp", skip: false, externalId: "solo1", confirmed: true });
  d.events.push({ id: "m91", date: "2026-10-22", start: "10:00", end: "11:00", title: "ひとりで会議室", source: "mcp", skip: true, externalId: "solo2" });
  d.events.push({ id: "m92", date: "2026-10-23", start: "10:00", end: "11:00", title: "予定表から消えた会議", source: "mcp", skip: false, externalId: "gone" });
  writeFileSync(w.data, JSON.stringify(d));
  const fetched = w.put("fetched.json", fetchedSolo());
  const p = runEnv({ PJ_LENS_HOME: homeWith({ selfEmails: [SELF] }) }, "calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(p.status, 0, p.err);
  assert.deepEqual(p.out.removedByExclusion, [
    { id: "m90", title: "作業ブロック", date: "2026-10-22", confirmed: true },
    { id: "m91", title: "ひとりで会議室", date: "2026-10-22", confirmed: false },
  ]);
  const removedIds = p.out.removed.map((e) => e.id);
  assert.ok(["m90", "m91", "m92"].every((id) => removedIds.includes(id)), "3 件とも removed に出る");
  assert.ok(!p.out.removedByExclusion.some((e) => e.id === "m92"), "予定表から消えた会議（m92）は、removedByExclusion に出ない");
});

// ---- calendar-auto（見張り中の自動更新。承認の確認なしで書く）。時刻に依存しないよう、十分に古い日・先の日を使う ----
const OLD = "2000-01-01", FAR = "2999-01-01";
const autoWork = () => {
  const w = work();
  const d = w.json();
  d.events = [
    { id: "m1", date: OLD, start: "09:00", end: "10:00", title: "終わった会議", source: "mcp", skip: false, externalId: "old", confirmed: true },
    { id: "m2", date: FAR, start: "09:00", end: "10:00", title: "予定表から消えた会議", source: "mcp", skip: false, externalId: "gone" },
    { id: "m3", date: FAR, start: "11:00", end: "12:00", title: "手入力", source: "manual", skip: false },
  ];
  writeFileSync(w.data, JSON.stringify(d));
  return w;
};

test("calendar-auto: 承認の確認なしで書く。消えた未来の会議は削除し、終わった会議（確認済み）は残す。結果に summary・held が出る", () => {
  const w = autoWork();
  const fetched = w.put("fetched.json", [{ externalId: "new", title: "新しい会議", date: FAR, start: "15:00", end: "16:00" }]);
  const r = run("calendar-auto", w.data, fetched, OLD, "2999-12-31");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.summary, { added: 1, updated: 0, removed: 1, excluded: 0, held: 1 });
  assert.deepEqual(r.out.held, [{ id: "m1", title: "終わった会議", date: OLD, change: "removed" }]);
  assert.equal(r.out.blocked, null);
  assert.deepEqual(w.json().events.map((e) => e.externalId ?? e.id).sort(), ["m3", "new", "old"]);
});

test("calendar-auto: 取得が 0 件なら、削除しない。blocked に理由が出る", () => {
  const w = autoWork();
  const fetched = w.put("fetched.json", []);
  const r = run("calendar-auto", w.data, fetched, OLD, "2999-12-31");
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.summary.removed, 0);
  assert.equal(r.out.blocked.count, 1);
  assert.deepEqual(w.json().events.map((e) => e.id).sort(), ["m1", "m2", "m3"]);
});

test("calendar-auto: 日付が正しくないときは使い方を出して終了コード 2。何も書かない", () => {
  const w = autoWork();
  const fetched = w.put("fetched.json", []);
  const before = w.read();
  assert.equal(run("calendar-auto", w.data, fetched, "x", "y").status, 2);
  assert.equal(w.read(), before);
});
