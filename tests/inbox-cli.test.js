import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { validate } from "../plugins/project-board/src/core/schema.js";
import { markApplied } from "../plugins/project-board/src/core/inbox.js";
import { addDays, dueAfter, today } from "../plugins/project-board/src/core/dates.js";

const REPO = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "pjl-inbox-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
function work() {
  const dir = join(base, String(++n));
  mkdirSync(dir, { recursive: true });
  const data = join(dir, "data.json");
  copyFileSync(join(REPO, "data/sample.json"), data);
  const put = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
  return { data, put, read: () => readFileSync(data, "utf8"), json: () => JSON.parse(readFileSync(data, "utf8")), write: (d) => writeFileSync(data, JSON.stringify(d, null, 2) + "\n") };
}
const CLI = join(REPO, "tools/inbox.js");
const NO_NET = "http://127.0.0.1:1/syukujitsu.csv"; // 祝日の取得先。閉じたポートにして、テストが内閣府のサイトへ出ないようにする
const run = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, PJ_LENS_HOLIDAYS_URL: NO_NET } });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr, raw: r.stdout };
};
const OPS = [
  { op: "moveDue", taskId: "A3", deltaDays: 45 },
  { op: "addTask", ref: "t1", projectId: "A", title: "疎通確認テスト", due: "2026-12-10", predecessors: ["A4"] },
];
/** 依頼 R1 を proposed まで進める */
function proposed(w) {
  assert.equal(run("submit", w.data, "A", "A3 が 45 日遅れた。疎通確認テストを登録して").status, 0);
  assert.equal(run("claim", w.data, "R1").status, 0);
  const r = run("propose", w.data, "R1", w.put("ops.json", OPS), "--summary", "2 種類の変更案", "--reason", "ベンダーX の納期回答が遅れた", "--cause", "ベンダー");
  assert.equal(r.status, 0, r.err);
  return r;
}

test("submit → list → claim → propose: 提案が書かれ、承認するまで tasks と changeLog は変わらない", () => {
  const w = work();
  const tasksBefore = JSON.stringify(w.json().tasks), logBefore = w.json().changeLog.length;
  const s = run("submit", w.data, "A", "A3 が 45 日遅れた");
  assert.deepEqual([s.status, s.out.id, s.out.status], [0, "R1", "pending"]);
  assert.deepEqual(run("list", w.data).out.map((r) => [r.id, r.status, r.projectId, r.text]), [["R1", "pending", "A", "A3 が 45 日遅れた"]]);
  const c = run("claim", w.data, "R1");
  assert.equal(c.out.status, "working");
  const p = proposed(work());
  assert.equal(p.out.status, "proposed");
  assert.deepEqual(p.out.sections.map((x) => x.kind).sort(), ["add", "due"]);
  const w2 = work(); proposed(w2);
  const got = run("get", w2.data, "R1").out;
  assert.deepEqual([got.status, got.proposal.reason, got.proposal.cause, got.proposal.summary], ["proposed", "ベンダーX の納期回答が遅れた", "ベンダー", "2 種類の変更案"]);
  assert.equal(JSON.stringify(w2.json().tasks), tasksBefore);
  assert.equal(w2.json().changeLog.length, logBefore);
});

test("approve: 変更が書かれ、applied（by: claude）。2 回目は終了コード 1 でデータ不変", () => {
  const w = work(); proposed(w);
  const a = run("approve", w.data, "R1");
  assert.equal(a.status, 0, a.err);
  const d = w.json();
  assert.equal(d.tasks.find((t) => t.id === "A3").due, "2026-11-30");
  assert.ok(d.tasks.some((t) => t.title === "疎通確認テスト"));
  assert.deepEqual([d.inbox.requests[0].status, d.inbox.requests[0].result.by], ["applied", "claude"]);
  assert.equal(d.changeLog.at(-1).source, "inbox");
  const before = w.read();
  const again = run("approve", w.data, "R1");
  assert.equal(again.status, 1);
  assert.match(again.err, /applied/);
  assert.equal(w.read(), before);
});

test("approve: HTML で先に applied になっていたら、何も変えず終了コード 1", () => {
  const w = work(); proposed(w);
  w.write(markApplied(w.json(), "R1", { by: "html", summary: "反映しました", now: "2026-10-21T10:00:00.000Z" }));
  const before = w.read();
  const r = run("approve", w.data, "R1");
  assert.equal(r.status, 1);
  assert.equal(w.read(), before);
});

test("propose: 存在しない前のタスクの ops は終了コード 1 で、データは変わらない", () => {
  const w = work();
  run("submit", w.data, "A", "x"); run("claim", w.data, "R1");
  const before = w.read();
  const r = run("propose", w.data, "R1", w.put("bad.json", [{ op: "addTask", ref: "t1", projectId: "A", title: "x", due: "2026-12-10", predecessors: ["X9"] }]));
  assert.equal(r.status, 1);
  assert.match(r.err, /X9/);
  assert.equal(w.read(), before);
});

test("approve: 提案のあとに対象のタスクが変わっていたら、failed にして終了コード 1。再提案で pending に戻せる", () => {
  const w = work(); proposed(w);
  const d = w.json(); d.tasks.find((t) => t.id === "A3").due = "2026-10-20"; w.write(d);
  const r = run("approve", w.data, "R1");
  assert.equal(r.status, 1);
  assert.match(r.err, /データが変わりました/);
  assert.equal(w.json().inbox.requests[0].status, "failed");
  assert.ok(!w.json().tasks.some((t) => t.title === "疎通確認テスト"), "適用されていない");
});

test("approve: 保存済みの提案に、依頼で受けなくなった操作（setStatus）があれば、failed にして終了コード 1。data.json のほかは変わらない", () => {
  const w = work(); proposed(w);
  const d = w.json();
  d.inbox.requests[0].proposal.ops = [{ op: "setStatus", taskId: "A3", status: "Done" }];
  w.write(d);
  const r = run("approve", w.data, "R1");
  assert.equal(r.status, 1);
  assert.match(r.err, /画面で行ってください/);
  const after = w.json();
  assert.equal(after.inbox.requests[0].status, "failed");
  assert.equal(after.tasks.find((t) => t.id === "A3").status, d.tasks.find((t) => t.id === "A3").status);
  assert.deepEqual({ ...after, inbox: null }, { ...d, inbox: null });
});

test("ask・reject・fail の遷移と、状態違い・不明な ID の終了コード", () => {
  const w = work();
  run("submit", w.data, "-", "どれか分からない依頼"); run("claim", w.data, "R1");
  assert.equal(run("ask", w.data, "R1", "どのプロジェクトですか").out.status, "question");
  assert.equal(run("reject", w.data, "R1").out.status, "rejected");
  run("submit", w.data, "A", "削除して"); run("claim", w.data, "R2");
  assert.equal(run("fail", w.data, "R2", "削除は依頼できません").out.status, "failed");
  assert.equal(run("claim", w.data, "R1").status, 1, "rejected は claim できない");
  assert.equal(run("get", w.data, "R9").status, 1);
  assert.equal(run("nope", w.data).status, 2);
  assert.equal(run().status, 2);
});

/** wait を起動して、終了まで標準出力の JSON 行を集める */
function startWait(w, extra = []) {
  const child = spawn(process.execPath, [CLI, "wait", w.data, "--interval", "150", ...extra], { encoding: "utf8" });
  let buf = "";
  child.stdout.on("data", (c) => { buf += c; });
  const done = new Promise((res) => child.on("exit", () => res(buf.split("\n").filter(Boolean).map((l) => JSON.parse(l)))));
  return { child, done };
}

test("wait: 起動時に pending の依頼を request イベントで出し、見ている印（watching.at）を書き、timeout で終わる", async () => {
  const w = work();
  run("submit", w.data, "A", "先に届いていた依頼");
  const ev = await startWait(w, ["--timeout", "2"]).done;
  assert.ok(ev.some((e) => e.event === "request" && e.id === "R1" && e.status === "pending"), JSON.stringify(ev));
  assert.equal(ev.at(-1).event, "end");
  assert.ok(Date.now() - Date.parse(w.json().inbox.watching.at) < 30000);
});

test("wait: 待っている間に届いた依頼を出す。提案の承認（decision）は出さない", async () => {
  const w = work();
  const { done } = startWait(w, ["--timeout", "5"]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(700);
  assert.equal(run("submit", w.data, "A", "A3 が 45 日遅れた").status, 0);
  await sleep(600); // pending のまま、wait の確認の間隔（150ms）を越える
  assert.equal(run("claim", w.data, "R1").status, 0);
  assert.equal(run("propose", w.data, "R1", w.put("ops.json", OPS), "--cause", "ベンダー").status, 0);
  await sleep(600); // proposed のまま、確認の間隔を越える
  assert.equal(run("approve", w.data, "R1").status, 0);
  const ev = await done;
  assert.ok(ev.some((e) => e.event === "request" && e.id === "R1"), JSON.stringify(ev));
  assert.ok(!ev.some((e) => e.event === "decision"), JSON.stringify(ev));
});

test("submit --working: working の依頼ができ、businessDays 入りの propose → approve で登録される。wait は request として知らせない", async () => {
  const w = work();
  const s = run("submit", w.data, "A", "文章の要約", "--working");
  assert.equal(s.status, 0, s.err);
  assert.equal(s.out.status, "working");
  const ops = [{ op: "addTask", ref: "t1", projectId: "A", title: "文章から登録", businessDays: 10, predecessors: ["A4"] }];
  const p = run("propose", w.data, "R1", w.put("ops.json", ops), "--summary", "仮日程の案");
  assert.equal(p.status, 0, p.err);
  const proposed = w.json().inbox.requests[0].proposal;
  assert.ok(proposed.ops[0].due && !("businessDays" in proposed.ops[0]));
  assert.equal(run("approve", w.data, "R1").status, 0);
  const t = w.json().tasks.find((x) => x.title === "文章から登録");
  assert.equal(t.due, proposed.ops[0].due);
  assert.equal(t.due, "2026-12-11");
  const w2 = work();
  run("submit", w2.data, "A", "横取りされない依頼", "--working");
  const ev = await startWait(w2, ["--timeout", "1"]).done;
  assert.ok(!ev.some((e) => e.event === "request"), JSON.stringify(ev));
});

test("propose: addTask・moveDue 以外の操作（setStatus など）は終了コード 1 で、画面で行うよう伝え、データは変わらない", () => {
  const w = work();
  run("submit", w.data, "-", "A3 を完了にして", "--working");
  const before = w.read();
  for (const op of [{ op: "setStatus", taskId: "A3", status: "Done" }, { op: "addProject", ref: "p1", name: "x" }, { op: "removeTask", taskId: "A7" }]) {
    const r = run("propose", w.data, "R1", w.put("ops.json", [op]));
    assert.equal(r.status, 1, op.op);
    assert.match(r.err, new RegExp(`この操作は依頼では受けられません: ${op.op}（画面で行ってください）`));
  }
  assert.equal(w.read(), before);
});

test("propose は、提案済みの依頼にもう一度できる（直した ops で差し替わり、approve は直した方を反映する）", () => {
  const w = work();
  run("submit", w.data, "A", "文章の要約", "--working");
  const ops = (businessDays) => [{ op: "addTask", ref: "t1", projectId: "A", title: "再提案のタスク", businessDays, predecessors: ["A4"] }];
  assert.equal(run("propose", w.data, "R1", w.put("o1.json", ops(10))).status, 0);
  const again = run("propose", w.data, "R1", w.put("o2.json", ops(3)));
  assert.equal(again.status, 0, again.err);
  assert.equal(run("approve", w.data, "R1").status, 0);
  assert.equal(w.json().tasks.find((x) => x.title === "再提案のタスク").due, "2026-12-02");
});

test("propose: moveDue と businessDays 指定の addTask の併用は、終了コード 1 で、データは変わらない", () => {
  const w = work();
  run("submit", w.data, "A", "x"); run("claim", w.data, "R1");
  const before = w.read();
  const ops = [{ op: "moveDue", taskId: "A4", deltaDays: 10 }, { op: "addTask", ref: "t1", projectId: "A", title: "併用", businessDays: 3, predecessors: ["A4"] }];
  const r = run("propose", w.data, "R1", w.put("both.json", ops));
  assert.equal(r.status, 1);
  assert.match(r.err, /moveDue.*businessDays/);
  assert.equal(w.read(), before);
});

// --- propose: 営業日で期限を置くとき、日本の祝日が未取得・古い・範囲外なら取得する（取れなくても提案は止めない）
/** 内閣府の一覧の形で祝日を返すサーバー（名前は ASCII。Shift_JIS の部分集合なので復号できる）。呼ばれた回数を数える */
async function holidayServer(status, dates = []) {
  const s = { hits: 0 };
  const body = `date,name\r\n${dates.map((d) => `${d.replaceAll("-", "/")},test\r\n`).join("")}`;
  const server = createServer((req, res) => { s.hits++; res.writeHead(status, { "content-type": "text/csv" }); res.end(status === 200 ? body : "error"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  s.url = `http://127.0.0.1:${server.address().port}/syukujitsu.csv`;
  s.close = () => new Promise((r) => server.close(r));
  return s;
}
const runWith = (url, ...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, PJ_LENS_HOLIDAYS_URL: url } });
  let out = "", err = "";
  p.stdout.on("data", (c) => (out += c));
  p.stderr.on("data", (c) => (err += c));
  p.on("close", (status) => { let json = null; try { json = JSON.parse(out); } catch { /* JSON でない */ } resolve({ status, out: json, err }); });
});
const NEXT_BD = dueAfter(today(), 1); // 今日の次の平日（この日を祝日にする）
const FAR = addDays(today(), 400); // 一覧の末尾（範囲が足りている状態にする）
const BD_OPS = [{ op: "addTask", ref: "t1", projectId: "A", title: "営業日の登録", businessDays: 1 }]; // 前のタスクなし → 今日から 1 営業日
const addDue = (r) => r.out.sections.find((s) => s.kind === "add").rows[0].due;
const ready = (w) => { run("submit", w.data, "A", "x", "--working"); return w; };

test("propose(businessDays): 祝日が未取得・取得から 30 日超・範囲外（今日の取得でない）なら取得して保存し、期限が祝日を飛ばす", async () => {
  const stale = { fetchedAt: addDays(today(), -31), source: "u", dates: [{ date: FAR, name: "x" }] };
  const short = { fetchedAt: addDays(today(), -5), source: "u", dates: [{ date: addDays(today(), -1), name: "x" }] }; // 一覧が昨日で終わっている
  for (const nh of [undefined, stale, short]) {
    const w = ready(work());
    if (nh) w.write({ ...w.json(), settings: { ...w.json().settings, nationalHolidays: nh } });
    const s = await holidayServer(200, [NEXT_BD, FAR]);
    const r = await runWith(s.url, "propose", w.data, "R1", w.put("bd.json", BD_OPS));
    await s.close();
    assert.equal(r.status, 0, r.err);
    assert.equal(s.hits, 1);
    assert.deepEqual(w.json().settings.nationalHolidays.dates, [{ date: NEXT_BD, name: "test" }, { date: FAR, name: "test" }]);
    assert.equal(addDue(r), dueAfter(NEXT_BD, 1), "祝日にした日を飛ばす");
    assert.deepEqual(r.out.warnings, []);
    assert.equal(w.json().inbox.requests[0].proposal.sections.find((x) => x.kind === "add").rows[0].due, dueAfter(NEXT_BD, 1), "保存した提案も同じ");
  }
});

test("propose(businessDays): 取得に失敗しても提案は作られ、warnings に書かれ、祝日は保存されない", async () => {
  const w = ready(work());
  const s = await holidayServer(500);
  const r = await runWith(s.url, "propose", w.data, "R1", w.put("bd.json", BD_OPS));
  await s.close();
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.status, "proposed");
  assert.ok(r.out.warnings.some((x) => x.includes("祝日を取得できませんでした")), JSON.stringify(r.out.warnings));
  assert.equal(w.json().settings.nationalHolidays, undefined);
  assert.equal(addDue(r), NEXT_BD);
});

test("propose: businessDays の無い提案は祝日を取得しない。今日取得済みで範囲外のときも取得せず、範囲の注意だけ出す", async () => {
  const s = await holidayServer(200, [NEXT_BD, FAR]);
  const w1 = ready(work());
  const r1 = await runWith(s.url, "propose", w1.data, "R1", w1.put("ops.json", OPS));
  assert.equal(r1.status, 0, r1.err);
  const w2 = ready(work());
  const yesterday = addDays(today(), -1);
  w2.write({ ...w2.json(), settings: { ...w2.json().settings, nationalHolidays: { fetchedAt: today(), source: "u", dates: [{ date: yesterday, name: "x" }] } } });
  const r2 = await runWith(s.url, "propose", w2.data, "R1", w2.put("bd.json", BD_OPS));
  await s.close();
  assert.equal(r2.status, 0, r2.err);
  assert.equal(s.hits, 0);
  assert.deepEqual(r2.out.warnings, [`祝日の一覧は ${yesterday} までです。それ以降は手動登録の休みだけで計算しています`]);
  assert.equal(addDue(r2), NEXT_BD);
});

test("propose(businessDays): 土日祝を営業日に数える設定がオンなら、祝日を取得せず（取得先が壊れていても注意なし）、土日を飛ばさず、手動の休みは飛ばす", async () => {
  // 前のタスク A4 の期限は 2026-11-27（金）。実行する日に左右されないよう、この日から数える
  const FRI_OPS = [{ op: "addTask", ref: "t1", projectId: "A", title: "営業日の登録", businessDays: 1, predecessors: ["A4"] }];
  const s = await holidayServer(500);
  const w = ready(work());
  assert.equal(w.json().tasks.find((t) => t.id === "A4").due, "2026-11-27");
  w.write({ ...w.json(), settings: { ...w.json().settings, countWeekendsAndHolidays: true } });
  const r = await runWith(s.url, "propose", w.data, "R1", w.put("bd.json", FRI_OPS));
  assert.equal(r.status, 0, r.err);
  assert.equal(s.hits, 0, "取得しない");
  assert.deepEqual(r.out.warnings, []);
  assert.equal(w.json().settings.nationalHolidays, undefined);
  assert.equal(addDue(r), "2026-11-28", "金曜の次の 1 営業日は土曜（オフなら 2026-11-30）");
  const w2 = ready(work());
  w2.write({ ...w2.json(), settings: { ...w2.json().settings, countWeekendsAndHolidays: true, holidays: [{ date: "2026-11-28", kind: "有給" }] } });
  const r2 = await runWith(s.url, "propose", w2.data, "R1", w2.put("bd.json", FRI_OPS));
  await s.close();
  assert.equal(r2.status, 0, r2.err);
  assert.equal(addDue(r2), "2026-11-29", "手動の休みは飛ばす");
});

test("addTask の checklist: propose → approve で、項目つきでタスクが登録される", () => {
  const ops = [{ op: "addTask", ref: "t1", projectId: "A", title: "疎通確認テスト", due: "2026-12-10", checklist: ["ping", "tracert"] }];
  const w = work();
  assert.equal(run("submit", w.data, "A", "疎通確認テストを登録して").status, 0);
  assert.equal(run("claim", w.data, "R1").status, 0);
  const p = run("propose", w.data, "R1", w.put("ops.json", ops), "--summary", "登録", "--reason", "依頼", "--cause", "社内");
  assert.equal(p.status, 0, p.err);
  assert.deepEqual(p.out.sections.map((x) => x.kind), ["add"]);
  const a = run("approve", w.data, "R1");
  assert.equal(a.status, 0, a.err);
  const d = w.json();
  assert.deepEqual(d.tasks.find((t) => t.title === "疎通確認テスト").checklist.map((c) => c.text), ["ping", "tracert"]);
  assert.deepEqual(validate(d).errors, []);
});

test("値を取るフラグ（--summary など）に値が無いときは、使い方の誤りとして終了コード 2 で止まる。何も書かない", () => {
  const w = work();
  const before = readFileSync(w.data, "utf8");
  const r = run("propose", w.data, "R1", w.put("ops.json", OPS), "--summary");
  assert.equal(r.status, 2);
  assert.match(r.err, /--summary の値がありません/);
  assert.equal(readFileSync(w.data, "utf8"), before);
});

test("wait: 見ている印を書けない（data.json が検証に通らない）ときも、warn イベントは出さない", async () => {
  const w = work();
  const bad = w.json();
  bad.tasks[0].status = "壊れた状態";
  w.write(bad);
  const ev = await startWait(w, ["--timeout", "1"]).done;
  assert.ok(!ev.some((e) => e.event === "warn"), JSON.stringify(ev));
  assert.equal(ev.at(-1).event, "end");
});
