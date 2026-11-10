// 使い方:
//   node tools/xlsx.js doctor [--data <置き場>]            診断のみ（何も変更しない）。使う Python のパスと、読み取りに使うパッケージの場所を表示する
//   node tools/xlsx.js setup [--system] [--yes] [--data <置き場>]   openpyxl を入れる。既定は専用の venv（<置き場>/venv）、--system はシステムの Python のユーザー領域（pip install --user）。--yes なしは入れ先と内容を表示して終了コード 3
//   node tools/xlsx.js <ファイル.xlsx> [--system] [--yes] [--data <置き場>]  Excel を JSON（全シートの行）で標準出力へ出す
// 置き場は、環境変数 PJ_LENS_HOME が最優先、次に --data（${CLAUDE_PLUGIN_DATA}）。どちらもなければ終了コード 2。
// 読み取りは Python（openpyxl）で行う。使う openpyxl は、次の順で決める。
//   1. システムの Python に、固定した版と同じ 3.x.y 系の openpyxl と、et_xmlfile・defusedxml が入っていれば、それを使う（何も入れない）。
//   2. <置き場>/venv に、固定した版が入っていれば、その venv の Python を使う。
//   3. どちらもなければ、承認（--yes）が付くまで入れない。承認後、既定なら <置き場>/venv を作って（python -m venv）、その中へ pip install --require-hashes --only-binary=:all: で入れる（システムの Python は変えない。<置き場>/venv が既にあって使えないとき（壊れた・版のずれた・利用者自身の venv）は、消さずに止まる）。--system なら pip install --user で入れ、入れたあとに import できることを確かめる。
// 専用の venv の Python は、-I で動かす（PYTHONPATH などの環境変数、ユーザー領域、作業フォルダを無視する)。
// 版とハッシュは requirements.txt で固定する。
// 終了コード 0: 成功 / 1: 実行時のエラー / 2: 引数・設定のエラー / 3: 読み取りの環境が使えない（未作成・版のずれ・壊れている・承認待ち・Python が無い）。
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { takeData, pickHome, NO_HOME_MESSAGE } from "./home.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [["py", "-3"], ["python"], ["python3"]];

/**
 * シェルを経由せず、引数は配列のまま渡す。
 * cwd は一時フォルダにする: python -c / -m は、現在のフォルダを先頭の検索場所にするため、作業フォルダに置かれた openpyxl.py などを実行しないように。
 * (専用の venv の Python は、さらに -I で、PYTHONPATH などの環境変数と作業フォルダを無視して動かす)
 */
// maxBuffer: 横に長い WBS の JSON は 1MB を超えうる(既定のままだと途中で切れる)
export const realRun = (cmd, args) => spawnSync(cmd, args, {
  encoding: "utf8", maxBuffer: 512 * 1024 * 1024, cwd: tmpdir(),
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});

/** 使える Python 3 の起動コマンド（配列）。無ければ null。run(cmd, args) は {status, stdout, stderr} を返す */
export function pickPython(run = realRun) {
  return CANDIDATES.find((c) => isPython3(c, run)) ?? null;
}

/** 起動コマンド c が Python 3 か */
function isPython3(c, run) {
  const r = run(c[0], [...c.slice(1), "--version"]);
  return r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`);
}

/** 専用の venv の場所（他のプラグインと同じ <置き場>/venv。置き場は、プラグイン専用のフォルダ） */
export const venvDir = (dir) => join(dir, "venv");

/** 専用の venv の Python（Windows の配置） */
export const venvPython = (dir) => join(venvDir(dir), "Scripts", "python.exe");

/** 専用の venv を動かす起動コマンド。-I で、PYTHONPATH・PYTHONHOME などの環境変数、ユーザー領域、作業フォルダを無視する */
const venvLauncher = (dir) => [venvPython(dir), "-I"];

/** requirements.txt（ハッシュ付きで固定）の場所 */
export const REQUIREMENTS = join(HERE, "..", "requirements.txt");

/** requirements.txt が固定している openpyxl の版 */
export const readPin = () => /^openpyxl==(\S+)/m.exec(readFileSync(REQUIREMENTS, "utf8"))[1];

/** Python の最低版（openpyxl 3.1.5 の要件） */
export const MIN_PYTHON = [3, 8];
const PROBE = "import sys; print(sys.executable); sys.exit(0 if sys.version_info >= (" + MIN_PYTHON.join(", ") + ") else 4)";

/** 使う Python の実パスと、最低版を満たすか。{path, ready, note} */
export function probePython(python, run = realRun) {
  const r = run(python[0], [...python.slice(1), "-c", PROBE]);
  const path = (r.stdout ?? "").trim().split(/\r?\n/)[0] || python.join(" ");
  if (r.status === 0) return { path, ready: true, note: "" };
  return { path, ready: false, note: "Python " + MIN_PYTHON.join(".") + " 以上が必要です（この Python では足りません）。" };
}

/** 固定した版と同じ 3.x. の接頭辞（システムの openpyxl に許す範囲） */
const seriesPrefix = (pin) => pin.split(".").slice(0, 2).join(".") + ".";

/** defusedxml（細工した xlsx の XML 爆弾を防ぐ）と et_xmlfile も import できることを、版の検査と合わせて確かめる */
const importCode = (cond) => "import sys, openpyxl, et_xmlfile, defusedxml; sys.exit(0 if " + cond + " else 1)";

/** システムの Python が、同じ系の openpyxl を使えるか */
const systemUsable = (python, pin, run) => run(python[0], [...python.slice(1), "-c", importCode("openpyxl.__version__.startswith(" + JSON.stringify(seriesPrefix(pin)) + ")")]).status === 0;

/** 専用の venv の Python が動き、固定した版が入っているか（基底の Python が消えた venv は、動かないので使えない） */
const venvUsable = (dir, pin, run, exists) => exists(venvPython(dir)) && run(venvPython(dir), ["-I", "-c", importCode("openpyxl.__version__ == " + JSON.stringify(pin))]).status === 0;

/** 使うパッケージの場所。{source: "system" | "venv" | null, python}。python は読み取りに使う起動コマンド（配列） */
function locate(dir, python, pin, run, exists) {
  if (python && systemUsable(python, pin, run)) return { source: "system", python };
  if (venvUsable(dir, pin, run, exists)) return { source: "venv", python: venvLauncher(dir) };
  return { source: null, python: null };
}

/**
 * 使う Python を選ぶ。最低版を満たす候補のうち、システムに使える openpyxl がある最初のものを返す。
 * どれにも無ければ、最低版を満たす最初の候補（入れる先）。最低版を満たす候補が無ければ null。
 */
export function choosePython({ run = realRun, pin = readPin() } = {}) {
  let first = null;
  for (const c of CANDIDATES) {
    if (!isPython3(c, run) || !probePython(c, run).ready) continue;
    first ??= c;
    if (systemUsable(c, pin, run)) return c;
  }
  return first;
}

/**
 * 診断のみ（何も変更しない）。戻り値: {usable, lines}。usable は、読み取りに使える openpyxl があること
 */
export function diagnose(dir, { run = realRun, python, exists = existsSync, pin = readPin() } = {}) {
  const probe = python ? probePython(python, run) : null;
  const found = locate(dir, probe?.ready ? python : null, pin, run, exists);
  const usable = found.source !== null;
  const where = found.source === "system" ? "システムの Python にあります（" + seriesPrefix(pin) + "x 系）" : found.source === "venv" ? "専用の venv にあります（" + venvDir(dir) + "）" : "使える openpyxl がありません（システムにも専用の venv にも、版が合うものが無い。defusedxml も必要）";
  const lines = [
    "置き場: " + dir,
    "Python: " + (probe ? probe.path + (probe.ready ? "" : "（" + probe.note + "）") : "見つかりません（Python 3 を入れてください）"),
    "openpyxl: " + where,
    "状態: " + (usable ? "使えます" : "読み取りの環境が使えません。node tools/xlsx.js setup --data <置き場> で入れ先と内容を確認し、承認後に --yes を付けて実行してください（システムの Python に入れるときは --system を足します）"),
  ];
  return { usable, lines };
}

/**
 * 読み取りに使う openpyxl を用意する。システムにあればそれを、なければ専用の venv を使い、無いときだけ入れる。
 * 足りないのに approve が無いときは、何もせず {ok:false, needsApproval:true, message}。
 * system が true のときの入れ先は、venv でなく、システムの Python のユーザー領域。
 * 戻り値: {ok, python（起動コマンドの配列）, source} か {ok:false, message}
 */
export function ensureEnv(dir, { run = realRun, python, exists = existsSync, approve = false, system = false, pin = readPin(), requirements = REQUIREMENTS, pythonLabel = python?.join(" "), remove = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 3 }) } = {}) {
  const found = locate(dir, python, pin, run, exists);
  if (found.source) return { ok: true, python: found.python, source: found.source };
  const vdir = venvDir(dir);
  if (!approve) {
    return { ok: false, needsApproval: true, message: "Excel を読むための openpyxl が、システムの Python にも専用の venv にもありません（版が違う、または defusedxml が無い場合を含みます）。次を入れてよいか、入れ先を 1 つ選んでもらってください。\n" +
      "  入れ先 venv（既定・推奨）: " + vdir + "（専用の仮想環境。システムの Python を変えません。同名のフォルダが既にあるときは、消さずに止まります）\n" +
      "  入れ先 system（--system）: " + (pythonLabel ?? "選んだ Python") + " のユーザー領域（pip install --user）。ユーザー領域に別の版の openpyxl が既にあれば、固定した版に置き換わり、元の版には戻せない（他のツールの openpyxl と版が衝突しうる）。アンインストールでは消えない。仮想環境の Python では使えない\n" +
      "  内容: openpyxl==" + pin + "（依存の et_xmlfile と、細工した Excel の XML の爆弾を防ぐ defusedxml も、ハッシュを固定して入れます。約 20 MB、ネットワークが必要）\n" +
      "  使う Python: " + (pythonLabel ?? "見つかりません") + "（" + MIN_PYTHON.join(".") + " 以上。venv に入れるときは標準ライブラリの venv・ensurepip、system に入れるときは pip が必要）\n" +
      "承認されたら、setup に --yes を付けて実行します（node tools/xlsx.js setup --yes --data <置き場>）。システムに入れるときは --system を足します。承認されないときは、Excel を CSV に保存すれば Python なしで取り込めます。" };
  }
  if (!python) return { ok: false, message: "Python 3 が見つかりません。導入するか、Excel を CSV に保存して取り込んでください。" };
  if (system) return installIntoSystem(python, pin, run, requirements);
  return installIntoVenv(dir, python, run, requirements, exists, remove);
}

/** pip install の引数。ハッシュ固定(--require-hashes)に加え、ビルド済みの配布物だけ(--only-binary=:all:)を使い、setup.py を実行しない */
const PIP_INSTALL = ["install", "--quiet", "--require-hashes", "--only-binary=:all:"];

/**
 * 専用の venv を作り、その中へ固定した版を入れる。システムの Python は変えない。
 * <置き場>/venv が既にあれば、消さずに止まる（利用者自身の venv かもしれないため）。失敗したときに消すのは、この実行で作ったフォルダだけ
 */
function installIntoVenv(dir, python, run, requirements, exists, remove) {
  const vdir = venvDir(dir);
  if (exists(vdir)) {
    return { ok: false, message: "使えない " + vdir + " があります（壊れている、版が違う、または project-board が作ったものではない）。消さずに止めました。project-board が作ったものなら消して、ほかのものなら移動してから、もう一度実行してください。" };
  }
  const made = run(python[0], [...python.slice(1), "-m", "venv", vdir]);
  if (made.status !== 0) {
    remove(vdir);
    return { ok: false, message: "venv を作れませんでした（Python 標準ライブラリの venv・ensurepip、置き場の書き込み権限、パスの長さを確認してください）。pip が使えるなら --system でシステムの Python に入れるか、Excel を CSV に保存すれば、Python なしで取り込めます。" + (made.stderr ?? "").trim() };
  }
  const installed = run(venvPython(dir), ["-I", "-m", "pip", ...PIP_INSTALL, "--isolated", "--disable-pip-version-check", "-r", requirements]);
  if (installed.status !== 0) {
    remove(vdir);
    return { ok: false, message: "venv に openpyxl を入れられませんでした（ネットワーク・プロキシを確認してください）。pip が使えるなら --system でシステムの Python に入れるか、Excel を CSV に保存すれば、Python なしで取り込めます。" + (installed.stderr ?? "").trim() };
  }
  return { ok: true, python: venvLauncher(dir), source: "venv" };
}

/** システムの Python のユーザー領域へ入れる(--system)。入れたあと、その Python から import できることを確かめる */
function installIntoSystem(python, pin, run, requirements) {
  const r = run(python[0], [...python.slice(1), "-m", "pip", ...PIP_INSTALL, "--user", "-r", requirements]);
  if (r.status !== 0) {
    return { ok: false, message: "openpyxl をシステムの Python に入れられませんでした（pip が使えるか、ネットワーク・プロキシ・権限を確認してください。仮想環境の Python では --user が使えません）。--system を付けずに venv に入れるか、Excel を CSV に保存すれば、Python なしで取り込めます。" + (r.stderr ?? "").trim() };
  }
  if (!systemUsable(python, pin, run)) {
    return { ok: false, message: "入れましたが、この Python から読み込めませんでした（ユーザー領域を読まない設定の可能性があります）。--system を付けずに venv に入れるか、Excel を CSV に保存してください。" };
  }
  return { ok: true, python, source: "system" };
}

const SUBCOMMANDS = ["doctor", "setup"];
const USAGE = "使い方: node tools/xlsx.js doctor | setup [--system] [--yes] | <ファイル.xlsx> [--system] [--yes]（置き場は PJ_LENS_HOME か --data <置き場>）";

function main() {
  const { data, rest: all } = takeData(process.argv.slice(2));
  const approve = all.includes("--yes");
  const system = all.includes("--system");
  const rest = all.filter((a) => a !== "--yes" && a !== "--system");
  const sub = SUBCOMMANDS.includes(rest[0]) ? rest.shift() : null;
  const file = sub ? null : rest[0];
  if (rest.length !== (sub ? 0 : 1)) { console.error(USAGE); process.exit(2); }
  const home = pickHome(data);
  if (!home) { console.error(NO_HOME_MESSAGE); process.exit(2); }
  const dir = resolve(home);
  const python = choosePython() ?? pickPython();

  if (sub === "doctor") {
    const d = diagnose(dir, { python });
    console.log(d.lines.join("\n"));
    process.exitCode = d.usable ? 0 : 3;
    return;
  }
  // システムか専用の venv にあれば、承認は要らない。入れるときだけ、Python が最低版を満たす必要がある
  const probe = python ? probePython(python) : null;
  const env = ensureEnv(dir, { python: probe?.ready ? python : null, approve, system, pythonLabel: probe?.path });
  if (!env.ok) { console.error(env.message + (probe && !probe.ready ? "\n" + probe.note : "")); process.exit(3); }
  if (sub === "setup") {
    const skipped = system && env.source === "venv" ? "。専用の venv に既にあるため、システムには何も入れていません" : "";
    console.log("読み取りの環境を使えます（" + (env.source === "system" ? "システムの Python" : venvDir(dir)) + "）" + skipped);
    return;
  }
  const r = realRun(env.python[0], [...env.python.slice(1), join(HERE, "xlsx_dump.py"), resolve(file)]);
  if (r.error) { console.error("読み取りに失敗しました: " + r.error.message); process.exit(1); }
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
