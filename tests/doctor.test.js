import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks, render } from "../plugins/project-board/tools/doctor.js";
import { readPin } from "../plugins/project-board/tools/xlsx.js";

const DOCTOR = fileURLToPath(new URL("../plugins/project-board/tools/doctor.js", import.meta.url));
const DIR = "C:\\data\\project-board";

// py -3 だけが存在する Python の振る舞い。version: --version の出力、probeOk: 3.8 以上か、importOk: openpyxl 等を import できるか、pipOk: pip が使えるか、venvOk: venv・ensurepip を使えるか
const pyStub = ({ version = "Python 3.12.1", probeOk = true, importOk = true, pipOk = true, venvOk = true } = {}) => (cmd, args) => {
  const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const ng = { status: 1, stdout: "", stderr: "" };
  if (cmd !== "py") return ng;
  if (args.includes("pip")) return pipOk ? ok("pip 24.0") : ng;
  if (args.includes("--version")) return version ? ok(version + "\n") : ng;
  if (args.includes("-c")) {
    const code = args[args.indexOf("-c") + 1];
    if (code.includes("import venv")) return venvOk ? ok() : ng;
    if (code.includes("sys.executable")) return probeOk ? ok("C:\\Py\\python.exe\n") : { status: 4, stdout: "C:\\Py\\python.exe\n", stderr: "" };
    return importOk ? ok() : ng;
  }
  return ng;
};

const base = () => ({
  dir: DIR,
  nodeVersion: "24.13.1",
  canWrite: () => true,
  exists: () => false,
  holidays: async () => ({ dates: [1, 2, 3] }),
  run: pyStub(),
  readMcp: () => ({ calendar: { server: "s", listTool: "t" } }),
  readPlugin: () => ({ version: "2.0.0", repository: "https://github.com/o/project-board" }),
  readMarketplace: () => ({ "project-board": { source: { source: "github", repo: "o/project-board" } } }),
  latest: async () => "2.0.0",
});
const find = (items, name) => items.find((i) => i.name.includes(name));

test("すべて満たすとき: 全項目 OK、終了コード 0。項目は 6 つで、ブラウザは含まない", async () => {
  const items = await runChecks(base());
  assert.deepEqual(items.map((i) => i.name.split("（")[0]), ["project-board の版", "Node.js", "保存先", "祝日一覧への接続", "Excel の読み取り", "予定表の MCP の指定"]);
  assert.deepEqual(items.map((i) => i.level), ["ok", "ok", "ok", "ok", "ok", "ok"]);
  const r = render(items);
  assert.equal(r.exitCode, 0);
  assert.match(r.lines.join("\n"), /必須の項目はすべて満たしています/);
});

test("Node.js が 24 未満: 要対処。入れ方と確認の手順を出し、終了コード 3", async () => {
  const items = await runChecks({ ...base(), nodeVersion: "22.11.0" });
  const n = find(items, "Node.js");
  assert.equal(n.level, "ng");
  assert.match(n.fix.join("\n"), /winget install/);
  assert.match(n.fix.join("\n"), /node --version/);
  assert.equal(render(items).exitCode, 3);
});

test("保存先が決まらない: 要対処。PROJECT_BOARD_HOME か --data の指定を案内する。Excel と予定表は確認できない（任意）", async () => {
  const items = await runChecks({ ...base(), dir: null });
  const h = find(items, "保存先");
  assert.equal(h.level, "ng");
  assert.match(h.fix.join("\n"), /PROJECT_BOARD_HOME/);
  assert.equal(find(items, "Excel").level, "opt");
  assert.equal(find(items, "予定表").level, "opt");
});

test("保存先に書き込めない: 要対処", async () => {
  const items = await runChecks({ ...base(), canWrite: () => false });
  assert.equal(find(items, "保存先").level, "ng");
});

test("祝日一覧に届かない: 任意。エラーの文言と、プロキシの確認・NODE_USE_ENV_PROXY を出す。終了コードは 0", async () => {
  const items = await runChecks({ ...base(), holidays: async () => { throw new Error("祝日の一覧に接続できませんでした（ENOTFOUND）"); } });
  const h = find(items, "祝日");
  assert.equal(h.level, "opt");
  assert.match(h.detail, /ENOTFOUND/);
  assert.match(h.fix.join("\n"), /プロキシ/);
  assert.match(h.fix.join("\n"), /NODE_USE_ENV_PROXY=1/);
  assert.equal(render(items).exitCode, 0);
});

test("保存先がフォルダでない(ファイル)・展開されていない ${…} を含む: 要対処。存在しない保存先は、親が書き込めれば OK で、作らない", async () => {
  const dir = mkdtempSync(join(tmpdir(), "project-board-doctor-"));
  const file = join(dir, "afile");
  writeFileSync(file, "x");
  for (const bad of [file, join(file, "sub"), "C:\\x\\${CLAUDE_PLUGIN_DATA}"]) {
    const items = await runChecks({ ...base(), dir: bad, canWrite: undefined });
    assert.equal(find(items, "保存先").level, "ng", bad);
  }
  const ok = await runChecks({ ...base(), dir: join(dir, "new"), canWrite: undefined });
  assert.equal(find(ok, "保存先").level, "ok");
  assert.equal(existsSync(join(dir, "new")), false);
});

test("予期しない例外: その項目だけ「確認できませんでした」になり、ほかの項目は出る", async () => {
  const items = await runChecks({ ...base(), run: () => { throw new Error("spawn 失敗"); } });
  assert.equal(items.length, 6);
  assert.match(find(items, "Excel").detail, /確認できませんでした（spawn 失敗）/);
  assert.equal(find(items, "Node.js").level, "ok");
});

test("Python が無い: 任意の項目。winget での入れ方、確認、CSV の代替を出す。終了コードは 0", async () => {
  const items = await runChecks({ ...base(), run: pyStub({ version: "" }) });
  const e = find(items, "Excel");
  assert.equal(e.level, "opt");
  const fix = e.fix.join("\n");
  assert.match(fix, /winget install Python\.Python\.3\.12/);
  assert.match(fix, /py -3 --version/);
  assert.match(fix, /CSV/);
  assert.equal(render(items).exitCode, 0);
});

test("Python が 3.8 未満: Python が無いときと同じ入れ方を出す", async () => {
  const items = await runChecks({ ...base(), run: pyStub({ probeOk: false }) });
  const e = find(items, "Excel");
  assert.equal(e.level, "opt");
  assert.match(e.detail, /3\.8/);
  assert.match(e.fix.join("\n"), /winget install Python\.Python\.3\.12/);
});

test("openpyxl が無く venv を作れない: Python の入れ直し(winget)を案内する。pip があれば、システムに入れる手順(--system)も出す。pip も無ければ出さない", async () => {
  const withPip = find(await runChecks({ ...base(), run: pyStub({ importOk: false, venvOk: false }) }), "Excel");
  assert.equal(withPip.level, "opt");
  assert.match(withPip.detail, /venv を作れません/);
  const fix = withPip.fix.join("\n");
  assert.match(fix, /winget install Python\.Python\.3\.12/);
  assert.match(fix, /setup --system --yes --data "C:\\data\\project-board"/);
  assert.match(fix, /CSV/);
  const noPip = find(await runChecks({ ...base(), run: pyStub({ importOk: false, venvOk: false, pipOk: false }) }), "Excel").fix.join("\n");
  assert.match(noPip, /winget install Python\.Python\.3\.12/);
  assert.doesNotMatch(noPip, /--system/);
});

test("openpyxl が無く venv を作れる: 専用の venv(推奨)を既定で、システム(--system)を選べるよう、2 つのコマンドを並べる。システムには注意を添える", async () => {
  const items = await runChecks({ ...base(), run: pyStub({ importOk: false }) });
  const fix = find(items, "Excel").fix.join("\n");
  assert.match(fix, /setup --yes --data "C:\\data\\project-board"/);
  assert.match(fix, /setup --system --yes --data "C:\\data\\project-board"/);
  assert.match(fix, /推奨.*システムの Python を変えない/);
  assert.match(fix, /版の openpyxl は置き換わり.*版が衝突しうる.*アンインストールでは消えない/);
  assert.match(fix, /選んで承認を得てから実行する/);
  const noPip = find(await runChecks({ ...base(), run: pyStub({ importOk: false, pipOk: false }) }), "Excel").fix.join("\n");
  assert.doesNotMatch(noPip, /--system/, "pip が無ければ、システムに入れる手順は出さない");
  assert.match(noPip, /setup --yes --data/);
});

test("openpyxl が無く venv を作れる: setup を、入れ先と内容を確認する → --yes の順で案内する。保存先の実パスを入れる", async () => {
  const items = await runChecks({ ...base(), run: pyStub({ importOk: false }) });
  const e = find(items, "Excel");
  assert.equal(e.level, "opt");
  const fix = e.fix.join("\n");
  const first = fix.indexOf('setup --data "C:\\data\\project-board"');
  assert.ok(first >= 0, "保存先の実パスを入れた setup");
  assert.ok(first < fix.indexOf("--yes"), "最初に案内するのは --yes なしの setup");
  assert.match(fix, /xlsx\.js" setup/);
  assert.match(fix, /約 20 ?MB/);
  assert.ok(fix.includes("入れ先は C:\\data\\project-board\\venv"), fix);
  assert.ok(fix.includes(`openpyxl ${readPin()}`), "版は requirements.txt の固定値");
  assert.match(fix, /CSV/);
});

test("案内するコマンドの引数: 保存先がドライブ直下(D:\\)でも、末尾の \\ が閉じの \" を打ち消さない", async () => {
  const items = await runChecks({ ...base(), dir: "D:\\", run: pyStub({ importOk: false }) });
  const fix = find(items, "Excel").fix.join("\n");
  assert.ok(fix.includes('setup --data "D:\\\\"'), fix);
});

test("Python と openpyxl が使える: pip が無くても OK(入れる必要が無い)", async () => {
  const items = await runChecks({ ...base(), run: pyStub({ pipOk: false }) });
  assert.equal(find(items, "Excel").level, "ok");
});

test("予定表の MCP の指定に誤り(server・listTool が無い): 「指定があります」と言わず、任意として直しを案内する", async () => {
  const items = await runChecks({ ...base(), readMcp: () => ({ calendar: {} }) });
  assert.equal(find(items, "予定表").level, "opt");
  assert.match(find(items, "予定表").detail, /calendar\.server/);
  assert.match(find(items, "予定表").fix.join("\n"), /\/project-board:mcp/);
});

test("予定表の MCP が未設定: 任意。/project-board:mcp を案内する。読み込みに失敗しても落ちない", async () => {
  let items = await runChecks({ ...base(), readMcp: () => ({}) });
  assert.equal(find(items, "予定表").level, "opt");
  assert.match(find(items, "予定表").fix.join("\n"), /\/project-board:mcp/);
  items = await runChecks({ ...base(), readMcp: () => { throw new Error("壊れています"); } });
  assert.equal(find(items, "予定表").level, "opt");
  assert.match(find(items, "予定表").detail, /壊れています/);
});

test("版: GitHub がマーケットプレイスに登録され、最新と同じ: OK", async () => {
  const v = find(await runChecks(base()), "版");
  assert.equal(v.level, "ok");
  assert.match(v.detail, /v2\.0\.0（最新です）/);
});

test("版: GitHub に新しい版がある: 任意。marketplace update と plugin update の手順を出す。終了コードは 0", async () => {
  const items = await runChecks({ ...base(), latest: async () => "2.1.0" });
  const v = find(items, "版");
  assert.equal(v.level, "opt");
  assert.match(v.detail, /v2\.0\.0.*v2\.1\.0/);
  assert.match(v.fix.join("\n"), /\/plugin marketplace update project-board/);
  assert.match(v.fix.join("\n"), /\/plugin update project-board@project-board/);
  assert.equal(render(items).exitCode, 0);
  assert.equal(find(await runChecks({ ...base(), latest: async () => "1.9.9" }), "版").level, "ok", "手元のほうが新しいときは OK");
  assert.equal(find(await runChecks({ ...base(), latest: async () => "2.0.10" }), "版").level, "opt", "10 は 9 より新しい（数として比べる）");
});

test("版: GitHub がマーケットプレイスに登録されていない: 今の版だけ示し、取得しない", async () => {
  let called = false;
  const v = find(await runChecks({ ...base(), readMarketplace: () => ({ x: { source: { source: "directory", path: "D:\\x" } } }), latest: async () => { called = true; } }), "版");
  assert.equal(v.level, "ok");
  assert.match(v.detail, /v2\.0\.0.*登録されていない/);
  assert.equal(called, false);
});

test("版: GitHub に届かない: 任意。理由を出す", async () => {
  const v = find(await runChecks({ ...base(), latest: async () => { throw new Error("接続できませんでした（ENOTFOUND）"); } }), "版");
  assert.equal(v.level, "opt");
  assert.match(v.detail, /v2\.0\.0.*ENOTFOUND/);
});

test("任意の項目だけが足りないときは、終了コード 0。必須が 1 つでも足りなければ 3", async () => {
  const optionalOnly = await runChecks({ ...base(), run: pyStub({ version: "" }), readMcp: () => ({}) });
  assert.equal(render(optionalOnly).exitCode, 0);
  const required = await runChecks({ ...base(), nodeVersion: "20.0.0" });
  assert.equal(render(required).exitCode, 3);
  assert.match(render(required).lines.join("\n"), /要対処の必須項目が 1 件/);
});

test("render: 状態の見出し([OK]・[要対処]・[任意])と、対処の行(→)を出す", async () => {
  const items = await runChecks({ ...base(), nodeVersion: "20.0.0", readMcp: () => ({}) });
  const text = render(items).lines.join("\n");
  assert.match(text, /\[要対処\]\s+Node\.js/);
  assert.match(text, /\[任意\]\s+予定表/);
  assert.match(text, /^\s+→ /m);
});

const cliEnv = { ...process.env, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "project-board-cfg-")), PROJECT_BOARD_HOME: "", PROJECT_BOARD_HOLIDAYS_URL: "http://127.0.0.1:1/x.csv" };

test("CLI: 必須が足りなければ診断だけして終了コード 3。祝日の取得先に届かないことは、任意の項目", () => {
  const r = spawnSync(process.execPath, [DOCTOR, "--data", "Z:\\no\\such\\dir"], { encoding: "utf8", env: cliEnv });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /動作環境の診断/);
  assert.match(r.stdout, /\[任意\]\s+祝日/);
  assert.match(r.stdout, /\[要対処\]\s+保存先/);
});

test("CLI: 何も変更しない。存在しない保存先を渡しても、フォルダを作らない", () => {
  const root = mkdtempSync(join(tmpdir(), "project-board-doctor-"));
  spawnSync(process.execPath, [DOCTOR, "--data", join(root, "not-yet", "data")], { encoding: "utf8", env: cliEnv });
  assert.equal(existsSync(join(root, "not-yet")), false);
});
