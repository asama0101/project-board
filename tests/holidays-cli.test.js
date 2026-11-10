import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { validate } from "../plugins/project-board/src/core/schema.js";
import { addDays, today } from "../plugins/project-board/src/core/dates.js";
import { needsHolidayUpdate } from "../plugins/project-board/tools/holidays.js";

const REPO = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
const CLI = join(REPO, "tools/holidays.js");
const base = mkdtempSync(join(tmpdir(), "pjl-hol-"));
after(() => rmSync(base, { recursive: true, force: true }));

// 内閣府の一覧と同じ形（Shift_JIS）: 国民の祝日・休日月日,国民の祝日・休日名称 / <今年>/10/12,スポーツの日 / <今年>/11/3,文化の日
// 取得は「今年の前年以降」だけを残すので、日付は実行した年から作る（固定の年だと、年が変わるとテストが落ちる）
const YEAR = new Date().getFullYear();
const sjis = (hex) => Buffer.from(hex, "hex");
const CSV_SJIS = Buffer.concat([
  sjis("8d9196af82cc8f6a93fa81458b7893fa8c8e93fa2c8d9196af82cc8f6a93fa81458b7893fa96bc8fcc0d0a"), // ヘッダ行（末尾は CRLF）
  Buffer.from(`${YEAR}/10/12,`), sjis("8358837c815b836382cc93fa0d0a"), // スポーツの日
  Buffer.from(`${YEAR}/11/3,`), sjis("95b689bb82cc93fa0d0a"), // 文化の日
]);

let n = 0;
function work(settings) {
  const data = join(base, `data${++n}.json`);
  copyFileSync(join(REPO, "data/sample.json"), data);
  if (settings) { const d = JSON.parse(readFileSync(data, "utf8")); d.settings = { ...d.settings, ...settings }; writeFileSync(data, JSON.stringify(d, null, 2)); }
  return { data, text: () => readFileSync(data, "utf8"), json: () => JSON.parse(readFileSync(data, "utf8")) };
}

/** 本文を返すローカルサーバーを立てる。サーバーが応答できるよう、CLI は非同期で動かす */
async function serve(status, body) {
  const server = createServer((req, res) => { res.writeHead(status, { "content-type": "text/csv" }); res.end(body); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/syukujitsu.csv`, close: () => new Promise((r) => server.close(r)) };
}
const runAsync = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
  let out = "", err = "";
  p.stdout.on("data", (c) => (out += c));
  p.stderr.on("data", (c) => (err += c));
  p.on("close", (status) => { let json = null; try { json = JSON.parse(out); } catch { /* JSON でない出力 */ } resolve({ status, out: json, raw: out, err }); });
});

test("update: 一覧を取得して settings.nationalHolidays に書く。他の設定を保ち、検証に通る", async () => {
  const w = work({ waitingLongDays: 5 });
  const s = await serve(200, CSV_SJIS);
  const r = await runAsync(["update", w.data], { PJ_LENS_HOLIDAYS_URL: s.url });
  await s.close();
  assert.equal(r.status, 0, r.err);
  const d = w.json();
  assert.deepEqual(d.settings.nationalHolidays.dates, [{ date: `${YEAR}-10-12`, name: "スポーツの日" }, { date: `${YEAR}-11-03`, name: "文化の日" }]);
  assert.equal(d.settings.nationalHolidays.source, s.url);
  assert.match(d.settings.nationalHolidays.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(d.settings.waitingLongDays, 5);
  assert.deepEqual(validate(d).errors, []);
  assert.deepEqual([r.out.ok, r.out.count, r.out.from, r.out.to], [true, 2, `${YEAR}-10-12`, `${YEAR}-11-03`]);
});

test("update: HTTP エラー・不正な本文・接続できないときは、終了コード 1 で data.json は変わらない", async () => {
  for (const [status, body] of [[500, "error"], [200, "<html>not csv</html>"], [200, ""]]) {
    const w = work();
    const before = w.text();
    const s = await serve(status, body);
    const r = await runAsync(["update", w.data], { PJ_LENS_HOLIDAYS_URL: s.url });
    await s.close();
    assert.equal(r.status, 1, `${status} ${body}: ${r.err}`);
    assert.ok(r.err.length > 0);
    assert.equal(w.text(), before);
  }
  const w = work();
  const before = w.text();
  const s = await serve(200, CSV_SJIS);
  const url = s.url;
  await s.close(); // 閉じたポートへ
  const r = await runAsync(["update", w.data], { PJ_LENS_HOLIDAYS_URL: url });
  assert.equal(r.status, 1, r.err);
  assert.equal(w.text(), before);
});

test("status: 未取得と取得後（取得日・件数・範囲・経過日数）", async () => {
  const w = work();
  const none = await runAsync(["status", w.data]);
  assert.equal(none.status, 0, none.err);
  assert.deepEqual(none.out, { fetched: false });
  const s = await serve(200, CSV_SJIS);
  await runAsync(["update", w.data], { PJ_LENS_HOLIDAYS_URL: s.url });
  await s.close();
  const st = await runAsync(["status", w.data]);
  assert.equal(st.out.fetched, true);
  assert.deepEqual([st.out.count, st.out.from, st.out.to, st.out.ageDays], [2, `${YEAR}-10-12`, `${YEAR}-11-03`, 0]);
});

test("引数なしは使い方を出して終了コード 2", () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /update/);
});

test("status: fetchedAt が日付でない（手で壊した）ときは例外にせず、未取得として扱う", async () => {
  const w = work({ nationalHolidays: { fetchedAt: "2026/10/01", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] } });
  const r = await runAsync(["status", w.data]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out, { fetched: false });
});

test("update: 接続できないときの理由は日本語（接続できなかった旨）", async () => {
  const w = work();
  const s = await serve(200, CSV_SJIS);
  const url = s.url;
  await s.close();
  const r = await runAsync(["update", w.data], { PJ_LENS_HOLIDAYS_URL: url });
  assert.equal(r.status, 1);
  assert.match(r.err, /接続できませんでした/);
});

// ---- needsHolidayUpdate・ensure ----
const nat = (ageDays, from = "2000-01-01", to = addDays(today(), 200)) => ({ nationalHolidays: { fetchedAt: addDays(today(), -ageDays), source: "u", dates: [{ date: from, name: "a" }, { date: to, name: "b" }] } });

test("needsHolidayUpdate: 未取得・30 日超・一覧の最終日が今日以前・範囲外のとき true。新しい取得（30 日以内で最終日が未来）は false", () => {
  assert.deepEqual(needsHolidayUpdate({}), { need: true, reason: "未取得" });
  assert.deepEqual(needsHolidayUpdate(nat(31)), { need: true, reason: "30日超" });
  assert.deepEqual(needsHolidayUpdate(nat(10, "2000-01-01", addDays(today(), -1))), { need: true, reason: "一覧の最終日が今日以前" });
  assert.deepEqual(needsHolidayUpdate(nat(10)), { need: false, reason: null });
  assert.deepEqual(needsHolidayUpdate(nat(10), addDays(today(), 300)), { need: true, reason: "範囲外" });
  assert.deepEqual(needsHolidayUpdate(nat(10), addDays(today(), 100)), { need: false, reason: null });
});

test("needsHolidayUpdate: 今日取得したものは、最終日が今日以前でも範囲外でも取り直さない", () => {
  assert.equal(needsHolidayUpdate(nat(0, "2000-01-01", addDays(today(), -1))).need, false);
  assert.equal(needsHolidayUpdate(nat(0), addDays(today(), 999)).need, false);
});

test("ensure: 条件に当てはまらないときは取得せず {fetched:false}。当てはまるときは取得して保存し {fetched:true,reason}", async () => {
  const fresh = work(nat(5));
  const before = fresh.text();
  const none = await runAsync(["ensure", fresh.data], { PJ_LENS_HOLIDAYS_URL: "http://127.0.0.1:1/x.csv" });
  assert.deepEqual([none.status, none.out], [0, { fetched: false, reason: null }]);
  assert.equal(fresh.text(), before);
  const old = work(nat(40));
  const s = await serve(200, CSV_SJIS);
  const got = await runAsync(["ensure", old.data], { PJ_LENS_HOLIDAYS_URL: s.url });
  await s.close();
  assert.equal(got.status, 0, got.err);
  assert.deepEqual([got.out.fetched, got.out.reason], [true, "30日超"]);
  assert.equal(old.json().settings.nationalHolidays.dates.length, 2);
  assert.deepEqual(validate(old.json()).errors, []);
});

test("ensure: 取得に失敗すると終了コード 1 で、data.json は変わらない", async () => {
  const w = work();
  const before = w.text();
  const r = await runAsync(["ensure", w.data], { PJ_LENS_HOLIDAYS_URL: "http://127.0.0.1:1/x.csv" });
  assert.equal(r.status, 1);
  assert.ok(r.err.length > 0);
  assert.equal(w.text(), before);
});

test("needsHolidayUpdate・ensure: 土日祝を営業日に数える設定がオンなら、未取得でも取得せず、data.json を変えない。true 以外はオフ", async () => {
  assert.deepEqual(needsHolidayUpdate({ countWeekendsAndHolidays: true }), { need: false, reason: null });
  assert.deepEqual(needsHolidayUpdate({ countWeekendsAndHolidays: true }, "2099-01-01"), { need: false, reason: null });
  assert.equal(needsHolidayUpdate({ countWeekendsAndHolidays: "true" }).need, true);
  const w = work({ countWeekendsAndHolidays: true });
  const before = w.text();
  const s = await serve(200, CSV_SJIS);
  const r = await runAsync(["ensure", w.data], { PJ_LENS_HOLIDAYS_URL: s.url });
  await s.close();
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out, { fetched: false, reason: null });
  assert.equal(w.text(), before);
  assert.equal(w.json().settings.nationalHolidays, undefined);
});
