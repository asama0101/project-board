import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickPython, choosePython, venvDir, venvPython, ensureEnv, readPin } from "../plugins/project-board/tools/xlsx.js";

const REPO = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const ng = { status: 1, stdout: "", stderr: "error" };

test("pickPython: py -3 が使えればそれを、なければ python、python3 の順。Python 2 は選ばない", () => {
  const calls = [];
  const mk = (table) => (cmd, args) => { calls.push([cmd, ...args]); return table[[cmd, ...args].join(" ")] ?? ng; };
  assert.deepEqual(pickPython(mk({ "py -3 --version": ok("Python 3.12.1\n") })), ["py", "-3"]);
  assert.deepEqual(pickPython(mk({ "python --version": ok("Python 3.11.0\n") })), ["python"]);
  assert.deepEqual(pickPython(mk({ "python --version": { status: 0, stdout: "", stderr: "Python 2.7.18\n" }, "python3 --version": ok("Python 3.9.0\n") })), ["python3"]);
  assert.equal(pickPython(mk({})), null);
});

const PIN = "3.1.5";
const calls_of = () => { const calls = []; return { calls, push: (c, a) => calls.push([c, ...a]) }; };
// -c の import 検査: システム側は系の接頭辞（startswith）、専用の venv 側は固定した版との一致
const isSystemCheck = (a) => a[a.length - 2] === "-c" && a[a.length - 1].includes("startswith");
const isVenvCheck = (a) => a[a.length - 2] === "-c" && a[a.length - 1].includes("__version__ ==");
// 作成元の Python に venv を作らせ、専用の venv の Python に pip を実行させる振る舞い。
// existing: <置き場>/venv が既にある(壊れた venv・利用者自身の venv など。使えない)
function venvEnv(dir, { createOk = true, installOk = true, existing = false } = {}) {
  const vdir = venvDir(dir), vpy = venvPython(dir);
  const state = { made: false, calls: [], removed: [], order: [] };
  state.run = (c, a) => {
    state.calls.push([c, ...a]);
    if (isSystemCheck(a)) return ng;
    if (a.includes("venv") && a.includes("-m")) { state.order.push("create"); if (createOk) state.made = true; return createOk ? ok() : { status: 1, stdout: "", stderr: "ERROR: cannot create" }; }
    if (c === vpy && a.includes("install")) { state.order.push("install"); return installOk ? ok() : { status: 1, stdout: "", stderr: "ERROR: no network" }; }
    return ng;
  };
  state.exists = (p) => p === vdir ? state.made || existing : p === vpy ? state.made || existing : false;
  state.remove = (p) => { state.order.push("remove"); state.removed.push(p); if (p === vdir) state.made = false; };
  return state;
}

test("ensureEnv: システムの Python に同じ系の openpyxl があれば、承認なしでも何も入れず、システムを使う", () => {
  const calls = [];
  const r = ensureEnv("/d", { run: (c, a) => { calls.push([c, ...a]); return ok(); }, python: ["python"], exists: () => false, pin: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.source, "system");
  assert.equal(calls.length, 1, "import の検査だけ");
  assert.match(calls[0][2], /defusedxml/);
  assert.match(calls[0][2], /et_xmlfile/);
  assert.match(calls[0][2], /startswith\("3\.1\."\)/, "固定した版と同じ系（3.1.x）を許す");
});

test("ensureEnv: システムの版が範囲外／defusedxml が無いなら使わず、専用の venv に固定した版があれば、その venv の Python を使う", () => {
  const seen = [];
  const run = (c, a, env) => { seen.push({ c, a, env }); return isSystemCheck(a) ? ng : ok(); };
  const r = ensureEnv("/d", { run, python: ["python"], exists: () => true, pin: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.source, "venv");
  assert.deepEqual(r.python, [venvPython("/d"), "-I"], "-I で、環境変数・ユーザー領域・作業フォルダを無視して動かす");
  const v = seen.find((s) => isVenvCheck(s.a));
  assert.equal(v.c, venvPython("/d"), "venv の Python で確かめる");
  assert.equal(v.a[0], "-I");
  assert.ok(v.a[v.a.length - 1].includes(JSON.stringify(PIN)), "専用の venv は固定した版と一致を見る");
});

test("ensureEnv: どちらも無く、承認(approve)なしのときは、何も入れず needsApproval で止まり、入れ先(venv・system)と内容を案内する", () => {
  const calls = [];
  const r = ensureEnv("/d/data dir", { run: (c, a) => { calls.push([c, ...a]); return ng; }, python: ["python"], exists: () => false, pin: PIN });
  assert.equal(r.ok, false);
  assert.equal(r.needsApproval, true);
  assert.ok(r.message.includes(venvDir("/d/data dir")), "venv の入れ先の実パス");
  assert.match(r.message, /入れ先 venv（既定・推奨）/);
  assert.match(r.message, /入れ先 system（--system）/);
  assert.match(r.message, new RegExp(`openpyxl==${PIN}`));
  assert.match(r.message, /setup に --yes を付けて実行します/);
  assert.match(r.message, /システムに入れるときは --system を足します/);
  assert.ok(calls.every(([, ...a]) => !a.includes("-m")), "承認前は venv も pip も実行しない");
});

test("venvDir・venvPython: 他のプラグインと同じ <置き場>/venv。Windows の Scripts\\python.exe", () => {
  assert.equal(venvDir("/d"), join("/d", "venv"));
  assert.equal(venvPython("/d"), join("/d", "venv", "Scripts", "python.exe"));
});

test("ensureEnv: 承認済みなら venv を作り(python -m venv)、その venv の Python で pip install を -I・--isolated・--only-binary で実行する。空白を含む置き場も1つの引数のまま", () => {
  const dir = join(tmpdir(), "pjl x", "data dir");
  const env = venvEnv(dir);
  const r = ensureEnv(dir, { run: env.run, python: ["py", "-3"], exists: env.exists, approve: true, pin: PIN, requirements: "/req uirements.txt", remove: env.remove });
  assert.equal(r.ok, true);
  assert.equal(r.source, "venv");
  assert.deepEqual(r.python, [venvPython(dir), "-I"]);
  assert.deepEqual(env.calls.find((c) => c.includes("venv") && c.includes("-m")), ["py", "-3", "-m", "venv", venvDir(dir)]);
  assert.deepEqual(env.calls.find((c) => c.includes("install")), [venvPython(dir), "-I", "-m", "pip", "install", "--quiet", "--require-hashes", "--only-binary=:all:", "--isolated", "--disable-pip-version-check", "-r", "/req uirements.txt"]);
  assert.ok(!env.calls.some((c) => c.includes("--user") || c.includes("--target")), "システムにも専用フォルダにも入れない");
  assert.deepEqual(env.order, ["create", "install"]);
  assert.deepEqual(env.removed, []);
});

test("ensureEnv: <置き場>/venv が既にあって使えない(壊れた・版のずれた・利用者自身の venv)ときは、消さずに案内して止まり、作らない", () => {
  const env = venvEnv("/d", { existing: true });
  const r = ensureEnv("/d", { run: env.run, python: ["python"], exists: env.exists, approve: true, pin: PIN, remove: env.remove });
  assert.equal(r.ok, false);
  assert.ok(r.message.includes(venvDir("/d")), r.message);
  assert.match(r.message, /消さずに止めました/);
  assert.deepEqual(env.removed, [], "消さない");
  assert.ok(!env.calls.some((c) => c.includes("venv") && c.includes("-m")), "作らない");
});

test("ensureEnv: 承認前の案内に、同名のフォルダが既にあれば消さずに止まると書く", () => {
  const r = ensureEnv("/d", { run: () => ng, python: ["python"], exists: () => false, pin: PIN });
  assert.match(r.message, /同名のフォルダが既にあるときは、消さずに止まります/);
});

test("ensureEnv: venv の作成・pip install が失敗したら ok:false(needsApproval でない)。原因ごとの文言で、--system と CSV を案内し、この実行で作った venv は消す", () => {
  const noCreate = venvEnv("/d", { createOk: false });
  const b = ensureEnv("/d", { run: noCreate.run, python: ["python"], exists: noCreate.exists, approve: true, pin: PIN, remove: noCreate.remove });
  assert.equal(b.ok, false);
  assert.notEqual(b.needsApproval, true);
  assert.match(b.message, /venv を作れませんでした/);
  assert.match(b.message, /venv・ensurepip/);
  assert.match(b.message, /ERROR: cannot create/);
  assert.doesNotMatch(b.message, /ネットワーク/, "作成の失敗を、ネットワークの失敗と取り違えない");
  assert.match(b.message, /--system/);
  assert.match(b.message, /CSV/);
  const offline = venvEnv("/d", { installOk: false });
  const c = ensureEnv("/d", { run: offline.run, python: ["python"], exists: offline.exists, approve: true, pin: PIN, remove: offline.remove });
  assert.equal(c.ok, false);
  assert.match(c.message, /openpyxl/);
  assert.match(c.message, /ERROR: no network/);
  assert.match(c.message, /--system/);
  assert.deepEqual(offline.removed, [venvDir("/d")], "半端な venv を残さない");
});

test("choosePython: 最低版を満たす候補のうち、openpyxl が使える最初のものを選ぶ。どれにも無ければ、最低版を満たす最初の候補", () => {
  const isProbe = (a) => a[a.length - 1].includes("sys.version_info");
  const table = (usable) => (c, a) => {
    if (a.includes("--version")) return ok("Python 3.12.0\n");
    if (isProbe(a)) return ok("/p/" + c + "\n");
    return usable.includes(c) && isSystemCheck(a) ? ok() : ng;
  };
  assert.deepEqual(choosePython({ run: table(["python"]), pin: PIN }), ["python"], "py -3 に無く python にあれば、python");
  assert.deepEqual(choosePython({ run: table([]), pin: PIN }), ["py", "-3"], "どこにも無ければ最初の候補（入れる先）");
  const old = (c, a) => (a.includes("--version") ? ok("Python 3.7.9\n") : isProbe(a) ? { status: 4, stdout: "/p/old\n", stderr: "" } : ng);
  assert.equal(choosePython({ run: old, pin: PIN }), null, "3.8 未満だけなら null");
});

test("ensureEnv: Python が無いときは、承認なしなら needsApproval、承認済みなら Python が無いと案内して失敗する", () => {
  const run = () => ng;
  assert.equal(ensureEnv("/d", { run, python: null, exists: () => false, approve: false, pin: PIN }).needsApproval, true);
  const b = ensureEnv("/d", { run, python: null, exists: () => false, approve: true, pin: PIN });
  assert.equal(b.ok, false);
  assert.match(b.message, /Python 3 が見つかりません/);
});

test("requirements.txt: openpyxl と et_xmlfile を == で固定し、すべてハッシュ付き", () => {
  const text = readFileSync(join(REPO, "requirements.txt"), "utf8");
  assert.match(text, /^openpyxl==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m);
  assert.match(text, /^et_xmlfile==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m);
  assert.match(text, /^defusedxml==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m, "細工した xlsx の XML 爆弾を防ぐ（openpyxl は、入っているときだけ使う）");
  assert.equal(readPin(), /^openpyxl==(\S+)/m.exec(text)[1]);
});

test("統合: fixtures/wbs-merged.xlsx を読むと結合セルが展開され、日付が YYYY-MM-DD になる（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const fixture = fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url));
  assert.ok(existsSync(fixture), "fixture がありません");
  const dataDir = join(tmpdir(), "projectboard-test-xlsx"); // 2回目以降は入れ済みのものを使い回す
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), "--data", dataDir, fixture, "--yes"], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sheets.length, 3);
  const rows = out.sheets[0].rows;
  const flat = rows.flat();
  assert.ok(flat.includes("設計"), "大項目");
  assert.equal(rows.filter((row) => row.includes("設計")).length, 3, "結合セルの大項目が縦に展開される");
  assert.ok(flat.some((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)), "日付は YYYY-MM-DD");
  assert.ok(flat.includes("機器選定"), "前後の全角スペースが除かれる");
  assert.deepEqual(out.sheets[1].indents, [0, 0, 2, 4, 4, 0, 2], "インデントで階層を表す行は、先頭の空白の数を indents で返す");
  assert.deepEqual(out.sheets[1].rows[2], ["要件", null], "文字列は空白を除いて返す");
});

import { realRun } from "../plugins/project-board/tools/xlsx.js";

test("realRun: 1MB を超える標準出力でも切れずに受け取れる（横に長い WBS の JSON を想定）", () => {
  const r = realRun(process.execPath, ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"]);
  assert.equal(r.status, 0, String(r.error));
  assert.equal(r.stdout.length, 5 * 1024 * 1024);
});

test("realRun: 作業フォルダではなく一時フォルダで実行する", () => {
  const r = realRun(process.execPath, ["-e", "process.stdout.write(process.cwd())"]);
  assert.equal(r.status, 0, String(r.error));
  assert.notEqual(r.stdout, process.cwd());
});

test("統合: 作業フォルダに置かれた openpyxl.py は、doctor でも実行されない（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const work = mkdtempSync(join(tmpdir(), "pjl-cwd-"));
  try {
    writeFileSync(join(work, "openpyxl.py"), ['open("MARK.txt", "w").write("ran")', '__version__ = "3.1.5"', ""].join("\n"));
    spawnSync(process.execPath, [XLSX_JS, "doctor", "--data", join(work, "home")], { cwd: work, encoding: "utf8", timeout: 120000, env: { ...process.env, PROJECT_BOARD_HOME: "" } });
    assert.equal(existsSync(join(work, "MARK.txt")), false, "作業フォルダの偽物を実行した");
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("統合: 非表示の行・列は読み取らず、件数を hiddenRows・hiddenColumns で返す", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const dataDir = join(tmpdir(), "projectboard-test-xlsx");
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), "--data", dataDir, fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url)), "--yes"], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const sh = JSON.parse(r.stdout).sheets[2];
  const flat = sh.rows.flat();
  assert.ok(flat.includes("表示される行") && flat.includes("表示される列"));
  assert.ok(!flat.includes("隠れた行") && !flat.includes("隠れた列") && !flat.includes("隠れた行の期限"));
  assert.deepEqual([sh.hiddenRows, sh.hiddenColumns], [1, 1]);
  assert.deepEqual(sh.rows[0], ["項目", "期限"], "非表示の列を除いて詰める");
  assert.equal(JSON.parse(r.stdout).sheets[0].hiddenRows, 0);
});

// --- doctor / setup / 置き場の優先順 (A6・A7・H5) ---
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { after } from "node:test";
import { diagnose } from "../plugins/project-board/tools/xlsx.js";

const XLSX_JS = join(REPO, "tools/xlsx.js");
const scratch = mkdtempSync(join(tmpdir(), "pjl-xlsx-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
// PROJECT_BOARD_HOME が開発者の環境に残っていても影響しないよう、テストごとに明示する
const cli = (args, env = {}) => spawnSync(process.execPath, [XLSX_JS, ...args], { encoding: "utf8", timeout: 300000, env: { ...process.env, PROJECT_BOARD_HOME: "", ...env } });

test("置き場が決まらないときは終了コード 2（doctor・setup・読み取り）", () => {
  for (const args of [["doctor"], ["setup"], ["x.xlsx"]]) {
    const r = cli(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /PROJECT_BOARD_HOME/);
    assert.match(r.stderr, /--data/);
  }
});

test("引数の誤りは終了コード 2（引数なし・サブコマンドに余分な引数）", () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(["doctor", "余分", "--data", join(scratch, "a")]).status, 2);
});

test("置き場の優先順: PROJECT_BOARD_HOME が --data に勝つ。位置引数では渡せない（終了コード 2）", () => {
  const home = join(scratch, "env home");
  const r = cli(["doctor", "--data", join(scratch, "arg")], { PROJECT_BOARD_HOME: home });
  assert.equal(r.status, 3);
  assert.ok(r.stdout.includes(home), r.stdout);
  assert.ok(!r.stdout.includes(join(scratch, "arg")));
  assert.ok(cli(["doctor", "--data", join(scratch, "arg")]).stdout.includes(join(scratch, "arg")), "環境変数がなければ --data");
  assert.equal(cli([join(scratch, "arg"), "doctor"]).status, 2);
  assert.equal(cli([join(scratch, "arg"), "x.xlsx"]).status, 2);
});

test("diagnose: システムに同じ系があれば使える。無く専用の venv に固定した版があれば使える。どちらも無ければ usable:false で案内。何も入れない", () => {
  const calls = [];
  const mk = (sys, venv) => (c, a) => { calls.push([c, ...a]); if (a.includes("-c") && a[a.length - 1].includes("openpyxl")) return (isSystemCheck(a) ? sys : venv) ? ok() : ng; return { status: 0, stdout: "C:\\Python\\python.exe\n", stderr: "" }; };
  const sys = diagnose("/d", { run: mk(true, false), python: ["py", "-3"], exists: () => false, pin: PIN });
  assert.equal(sys.usable, true);
  assert.match(sys.lines.join("\n"), /システムの Python/);
  const venv = diagnose("/d", { run: mk(false, true), python: ["py", "-3"], exists: () => true, pin: PIN });
  assert.equal(venv.usable, true);
  assert.match(venv.lines.join("\n"), /専用の venv/);
  const none = diagnose("/d", { run: mk(false, false), python: ["py", "-3"], exists: () => false, pin: PIN });
  assert.equal(none.usable, false);
  assert.match(none.lines.join("\n"), /setup/);
  assert.match(none.lines.join("\n"), /--system/);
  assert.match(none.lines.join("\n"), /C:\\Python\\python\.exe/, "使う Python のパス");
  assert.ok(calls.every(([, ...a]) => !a.includes("pip") && !a.includes("install")), "診断は何も入れない");
});

test("統合: 空白と日本語を含む置き場で doctor が動き、setup は --yes なしでは何も作らない。--yes で入れ、doctor が 0 になる（Python 3 が無い環境、またはシステムに使える openpyxl がある環境は skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const home = join(scratch, "利用者 名", "データ 置き場");
  let r = cli(["doctor", "--data", home]);
  if (r.status === 0) return t.skip("システムの Python に使える openpyxl があるため、専用の venv へ入れる経路を試せません");
  assert.equal(r.status, 3, r.stderr);
  assert.ok(r.stdout.includes(home), r.stdout);
  assert.match(r.stdout, /Python: .+/);
  assert.equal(existsSync(home), false, "doctor は何も作らない");
  r = cli(["setup", "--data", home]);
  assert.equal(r.status, 3);
  assert.ok(r.stderr.includes(home) && /openpyxl==/.test(r.stderr) && /--yes/.test(r.stderr), r.stderr);
  assert.equal(existsSync(home), false, "承認なしでは作らない");
  r = cli(["setup", "--yes", "--data", home]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(venvPython(home)), true, "専用の venv を作る");
  r = cli(["doctor"], { PROJECT_BOARD_HOME: home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /使えます/);
  const fixture = fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url));
  r = cli([fixture, "--data", home]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).sheets.length, 3);
});

test("統合: fixtures/wbs-stray-cell.xlsx（範囲が A1:XFD1048576 まで広がる、遠い隅のセル）でも、止まらずに 2 行を読む（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const fixture = fileURLToPath(new URL("fixtures/wbs-stray-cell.xlsx", import.meta.url));
  const dataDir = join(tmpdir(), "projectboard-test-xlsx");
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), "--data", dataDir, fixture, "--yes"], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, `${r.error ?? ""}${r.stderr}`);
  const sheet = JSON.parse(r.stdout).sheets[0];
  assert.deepEqual(sheet.rows[0].slice(0, 2), ["件名", "期限"]);
  assert.deepEqual(sheet.rows[1].slice(0, 2), ["A", "2026-11-01"]);
  assert.equal(sheet.rows.length, 2, "遠い隅の空のセルだけの行は、末尾の空行として除く");
  assert.equal(sheet.truncated, true, "読む範囲（5000 行 × 200 列）を超えて切ったことを知らせる");
});

test("ensureEnv(system): 承認前の案内に、システムの注意(固定した版への置き換え・版の衝突・アンインストールで消えない)を書く", () => {
  const r = ensureEnv("/d", { run: () => ng, python: ["python"], exists: () => false, pin: PIN, pythonLabel: "C:\\Py\\python.exe" });
  assert.equal(r.needsApproval, true);
  assert.match(r.message, /入れ先 system（--system）: C:\\Py\\python\.exe のユーザー領域（pip install --user）/);
  assert.match(r.message, /固定した版に置き換わり、元の版には戻せない/);
  assert.match(r.message, /版が衝突/);
  assert.match(r.message, /アンインストールでは消えない/);
});

test("ensureEnv(system): 承認済みなら pip install --user --require-hashes で入れ、import できると確かめて source:system を返す。venv は作らない", () => {
  const calls = [];
  let installed = false;
  const run = (c, a) => {
    calls.push([c, ...a]);
    if (a.includes("install")) { installed = true; return ok(); }
    return isSystemCheck(a) ? (installed ? ok() : ng) : a.includes("pip") ? ok() : ng;
  };
  const r = ensureEnv("/d", { run, python: ["py", "-3"], exists: () => false, approve: true, system: true, pin: PIN, requirements: "/req uirements.txt" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "system");
  assert.deepEqual(r.python, ["py", "-3"]);
  assert.deepEqual(calls.find((c) => c.includes("install")), ["py", "-3", "-m", "pip", "install", "--quiet", "--require-hashes", "--only-binary=:all:", "--user", "-r", "/req uirements.txt"]);
  assert.ok(!calls.some((c) => c.includes("venv") && c.includes("-m")), "venv は作らない");
});

test("ensureEnv(system): 承認なしなら何も入れない。pip が無い(install が失敗する)・install が失敗・入れても import できないときは ok:false で、venv(--system なし)と CSV を案内する", () => {
  const calls = [];
  const noApprove = ensureEnv("/d", { run: (c, a) => { calls.push(a); return ng; }, python: ["python"], exists: () => false, approve: false, system: true, pin: PIN });
  assert.equal(noApprove.needsApproval, true);
  assert.ok(calls.every((a) => !a.includes("install")), "承認前は入れない");
  const noPip = ensureEnv("/d", { run: () => ng, python: ["python"], exists: () => false, approve: true, system: true, pin: PIN });
  assert.match(noPip.message, /pip が使えるか/);
  assert.match(noPip.message, /CSV/);
  const failInstall = ensureEnv("/d", { run: (c, a) => (a.includes("install") || isSystemCheck(a) ? { status: 1, stdout: "", stderr: "Can not perform a '--user' install" } : ok()), python: ["python"], exists: () => false, approve: true, system: true, pin: PIN });
  assert.equal(failInstall.ok, false);
  assert.match(failInstall.message, /venv に入れる/);
  assert.match(failInstall.message, /CSV/);
  assert.match(failInstall.message, /Can not perform a '--user' install/);
  const notVisible = ensureEnv("/d", { run: (c, a) => (isSystemCheck(a) ? ng : ok()), python: ["python"], exists: () => false, approve: true, system: true, pin: PIN });
  assert.equal(notVisible.ok, false);
  assert.match(notVisible.message, /読み込めませんでした/);
  assert.match(notVisible.message, /venv に入れる/);
});

test("ensureEnv: Python が見つからなければ、承認済みでも案内して失敗する(venv・system どちらも)", () => {
  for (const system of [false, true]) {
    const r = ensureEnv("/d", { run: () => ng, python: null, exists: () => false, approve: true, system, pin: PIN });
    assert.equal(r.ok, false);
    assert.match(r.message, /Python 3 が見つかりません/);
  }
});

test("ensureEnv(system): 専用の venv に固定版が既にあれば何も入れず source:venv を返す", () => {
  const calls = [];
  const run = (c, a) => { calls.push(a); return isSystemCheck(a) ? ng : ok(); };
  const r = ensureEnv("/d", { run, python: ["python"], exists: () => true, approve: true, system: true, pin: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.source, "venv");
  assert.ok(calls.every((a) => !a.includes("install")), "何も入れない");
});

test("CLI: setup --system は受け付ける(終了コード 2 にならない)。--yes なしでは何も入れず、終了コード 3 で入れ先を案内する(システムに使える openpyxl がある環境は skip)", (t) => {
  const home = join(scratch, "sys home");
  if (cli(["doctor", "--data", home]).status === 0) return t.skip("システムの Python に使える openpyxl があるため、承認待ちの経路を試せません");
  const r = cli(["setup", "--system", "--data", home]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /入れ先 system（--system）/);
  assert.equal(existsSync(home), false, "承認なしでは何も作らない");
});

test("CLI: 旧 --into は受け付けない(余分な引数として終了コード 2)。--system は使い方に出る", () => {
  const dir = mkdtempSync(join(tmpdir(), "pjl-into-"));
  try {
    for (const args of [["setup", "--into", "system"], ["setup", "--into"]]) {
      const r = spawnSync(process.execPath, [XLSX_JS, ...args, "--data", dir], { encoding: "utf8", env: { ...process.env, PROJECT_BOARD_HOME: "" } });
      assert.equal(r.status, 2, args.join(" "));
      assert.match(r.stderr, /setup \[--system\] \[--yes\]/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
