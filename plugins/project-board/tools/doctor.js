// 使い方: node tools/doctor.js [--data <置き場>]
// 動作環境の診断のみ（何も変更しない）。別の PC で使い始めるときに、足りないものと対処を表示する。
// 置き場は、環境変数 PROJECT_BOARD_HOME が最優先、次に --data（${CLAUDE_PLUGIN_DATA}）。どちらもなければ「保存先」が要対処になる。
// 確認する項目: Node.js 24 以上・保存先（以上は必須）、project-board の版・祝日一覧への接続・Excel の読み取り（Python・pip・openpyxl）・予定表の MCP（以上は任意）。
// 版は、今の plugin.json の版を示し、GitHub が known_marketplaces.json に登録されていれば、GitHub の最新の版と比べる（環境変数 PROJECT_BOARD_LATEST_URL で取得先を変えられる。テスト用）。
// 祝日一覧と最新の版へは接続を試すだけで、data.json は変えない。Excel の判定は xlsx.js の診断を使う。
// 終了コード 0: 必須の項目がすべて満たされている / 3: 必須の項目に要対処がある（任意の項目だけが足りないときは 0）。
import { existsSync, accessSync, statSync, readFileSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { takeData, pickHome } from "./home.js";
import { fetchHolidays } from "./holidays.js";
import { choosePython, pickPython, probePython, diagnose, realRun, venvDir, readPin, MIN_PYTHON } from "./xlsx.js";
import { readMcpConfig, validateMcpConfig } from "../src/import/mcpconf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN_NODE = 24;
const CSV_ADVICE = "どうしても入れられないときは、Excel を CSV に保存すれば、Python なしで取り込めます";

/** 置き場（まだ無ければ、最も近い既存の親）がフォルダで、書き込み可能か。権限の細かい設定（ACL）までは見ない */
const defaultCanWrite = (dir) => {
  for (let p = resolve(dir); ; p = dirname(p)) {
    if (existsSync(p)) { try { if (!statSync(p).isDirectory()) return false; accessSync(p, constants.W_OK); return true; } catch { return false; } }
    if (dirname(p) === p) return false;
  }
};

const item = (name, level, detail, fix = []) => ({ name, level, detail, fix });

/** 案内するコマンドの引数用に、"…" で囲む。末尾の \ は、閉じの " を打ち消さないよう 2 つにする（D:\ など） */
const quote = (s) => `"${s.replace(/\\+$/, (m) => m + m)}"`;

/** 1 項目の確認が予期しない例外で落ちても、他の項目の結果を出す */
const guard = async (name, level, fn) => {
  try { return await fn(); } catch (e) { return item(name, level, `確認できませんでした（${e.message}）`); }
};

/** Windows 専用。それ以外は動かないので NG */
function checkOs(platform) {
  if (platform === "win32") return item("OS", "ok", "Windows");
  return item("OS", "ng", `${platform}（Windows 専用です）`, ["Windows で使う"]);
}

function checkNode(version) {
  const major = Number(version.split(".")[0]);
  const name = "実行環境";
  if (major >= MIN_NODE) return item(name, "ok", `Node.js v${version}（${MIN_NODE} 以上が必要）`);
  return item(name, "ng", `Node.js v${version}（${MIN_NODE} 以上が必要）`, [
    "winget install OpenJS.NodeJS.LTS を実行する（または https://nodejs.org/ から 24 以上を入れる）",
    "ターミナルを開き直し、node --version で 24 以上と表示されることを確認する",
    "もう一度 doctor を実行する",
  ]);
}

function checkHome(dir, canWrite) {
  const name = "保存先";
  if (!dir) return item(name, "ng", "決まっていません", [
    "環境変数 PROJECT_BOARD_HOME に保存先のフォルダを設定する、または --data \"<保存先>\" を付けて実行する",
    "Claude Code の中では、/project-board:doctor が保存先を自動で渡す",
  ]);
  if (dir.includes("${")) return item(name, "ng", `${dir}（変数が展開されていません）`, ["保存先の指定に、展開されていない ${…} が残っている。実際のフォルダのパスで指定し直す"]);
  if (!canWrite(dir)) return item(name, "ng", `${dir}（書き込めません。フォルダでないか、読み取り専用です）`, ["フォルダの書き込み権限を確認する（読み取り専用でないか、別のユーザーのフォルダでないか）"]);
  return item(name, "ok", `${dir}（書き込めます）`);
}

async function checkHolidays(holidays) {
  const name = "祝日一覧への接続（内閣府）";
  try {
    const { dates } = await holidays();
    return item(name, "ok", `届きました（${dates.length} 件）`);
  } catch (e) {
    return item(name, "opt", e.message, [
      "祝日は、営業日で期限を置くときと /project-board:watch を始めるときに使う。届かなくても、ほかの機能は動く（祝日を使わない設定にもできる）",
      "ネットワークにつながっているか、社内のプロキシ・ファイアウォールが www8.cao.go.jp への通信を止めていないかを確認する",
      "ブラウザでは開けるのに失敗するときは、Node がプロキシを使っていない。環境変数 NODE_USE_ENV_PROXY=1 と HTTPS_PROXY=<プロキシの URL> を設定して、もう一度実行する",
    ]);
  }
}

/** Excel の読み取り（任意）。状態ごとに、入れ方を手順で返す */
function checkExcel(dir, run, exists) {
  const name = "Excel の読み取り（Python・pip・openpyxl）";
  if (!dir) return item(name, "opt", "保存先が決まらないため確認できません", ["先に「保存先」を直す"]);
  const self = `node "${HERE}\\doctor.js" --data ${quote(dir)}`;
  const python = choosePython({ run }) ?? pickPython(run);
  const probe = python ? probePython(python, run) : null;
  if (!probe?.ready) {
    return item(name, "opt", python ? `${probe.path}（Python ${MIN_PYTHON.join(".")} 以上が必要）` : "Python 3 が見つかりません", [
      "winget install Python.Python.3.12 を実行する（または https://www.python.org/downloads/ から入れる。python.org のインストーラーでは、「Add python.exe to PATH」にチェックを入れる）",
      "ターミナルを開き直し、py -3 --version（または python --version）で 3.8 以上と表示されることを確認する",
      `もう一度 doctor を実行する: ${self}`,
      CSV_ADVICE,
    ]);
  }
  const d = diagnose(dir, { run, python, exists });
  if (d.usable) return item(name, "ok", d.lines.find((l) => l.startsWith("openpyxl")));
  const venvOk = run(python[0], [...python.slice(1), "-c", "import venv, ensurepip"]).status === 0;
  const pipOk = run(python[0], [...python.slice(1), "-m", "pip", "--version"]).status === 0;
  const setup = `node "${HERE}\\xlsx.js" setup --data ${quote(dir)}`;
  const install = (system) => `node "${HERE}\\xlsx.js" setup ${system ? "--system " : ""}--yes --data ${quote(dir)}`;
  const systemLine = `  システムの Python のユーザー領域（pip install --user。既にある別の版の openpyxl は置き換わり、他のツールと版が衝突しうる。アンインストールでは消えない）: ${install(true)}`;
  if (!venvOk) {
    return item(name, "opt", `${probe.path}（venv を作れません）`, [
      "この Python では、専用の venv を作れない（標準ライブラリの venv か ensurepip が使えない）。Python を入れ直す: winget install Python.Python.3.12（python.org のインストーラーなら、venv と ensurepip が入る）",
      ...(pipOk ? [`入れ直さずに入れるなら、システムの Python に入れる（${setup} で内容を確認してから）`, systemLine, "  選んで承認を得てから実行する"] : []),
      `もう一度 doctor を実行する: ${self}`,
      CSV_ADVICE,
    ]);
  }
  return item(name, "opt", `${probe.path}（使える openpyxl がありません）`, [
    `${setup} を実行する（入れ先と内容を表示して止まる。何も入れない）`,
    `内容は openpyxl ${readPin()} と依存の et_xmlfile・defusedxml（約 20 MB、ネットワークが必要）。入れ先を 1 つ選ぶ`,
    `  専用の venv（推奨。システムの Python を変えない。入れ先は ${venvDir(dir)}）: ${install(false)}`,
    ...(pipOk ? [systemLine] : []),
    "  選んで承認を得てから実行する",
    `もう一度 doctor を実行する: ${self}`,
    CSV_ADVICE,
  ]);
}

const PLUGIN_JSON = resolve(HERE, "..", ".claude-plugin", "plugin.json");

/** Claude Code に登録されたマーケットプレイスの一覧（known_marketplaces.json）。無ければ空 */
function readMarketplaces() {
  const file = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "plugins", "known_marketplaces.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** GitHub の既定ブランチにある plugin.json の version。失敗は例外 */
async function fetchLatestVersion(repo) {
  const url = process.env.PROJECT_BOARD_LATEST_URL || `https://raw.githubusercontent.com/${repo}/HEAD/plugins/project-board/.claude-plugin/plugin.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch((e) => {
    throw new Error(e.name === "TimeoutError" ? "タイムアウトしました（15 秒）" : `接続できませんでした（${e.cause?.code ?? e.message}）`);
  });
  if (!res.ok) throw new Error(`取得できませんでした（HTTP ${res.status}）`);
  return (await res.json()).version;
}

/** "1.2.3" 同士の比較。a が新しければ正、同じなら 0 */
const compareVersion = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** 今の版を示し、GitHub がマーケットプレイスとして登録されていれば、最新の版かも確かめる（任意） */
async function checkVersion(readPlugin, readMarketplace, latest) {
  const name = "版";
  const { version, repository } = readPlugin();
  const repo = repository?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
  const market = Object.entries(readMarketplace()).find(([, m]) => m.source?.source === "github" && m.source.repo === repo)?.[0];
  if (!market) return item(name, "info", `v${version}（GitHub のマーケットプレイスに登録されていないため、最新かは確認しません）`);
  let newest;
  try { newest = await latest(repo); } catch (e) {
    return item(name, "info", `v${version}（最新の版を確認できませんでした: ${e.message}）`, ["ネットワークにつながっているか、github.com への通信を止めていないかを確認する"]);
  }
  if (compareVersion(newest, version) <= 0) return item(name, "info", `v${version}（最新です）`);
  return item(name, "info", `v${version}（GitHub に v${newest} があります）`, [
    `/plugin marketplace update ${market} を実行する`,
    `/plugin update project-board@${market} を実行する`,
    "Claude Code を開き直す",
  ]);
}

function checkMcp(dir, readMcp) {
  const name = "予定表の MCP の指定";
  if (!dir) return item(name, "opt", "保存先が決まらないため確認できません", ["先に「保存先」を直す"]);
  try {
    const cfg = readMcp(dir);
    const errors = validateMcpConfig(cfg);
    if (errors.length) return item(name, "opt", `指定に誤りがあります（${errors.join("・")}）`, ["/project-board:mcp を実行して、指定し直す"]);
    if (cfg.calendar) return item(name, "ok", "指定があります");
  } catch (e) {
    return item(name, "opt", `読めませんでした（${e.message}）`, ["/project-board:mcp を実行して、指定し直す"]);
  }
  return item(name, "opt", "未指定（予定表を取り込むときだけ必要です）", ["予定表を取り込むなら、/project-board:mcp を実行する"]);
}

/** 全項目を確認する。依存（Node の版・書き込み・祝日・Python・MCP）は、テストで差し替えられる */
export async function runChecks({
  dir, platform = process.platform, nodeVersion = process.versions.node, canWrite = defaultCanWrite, exists = existsSync,
  holidays = fetchHolidays, run = realRun, readMcp = readMcpConfig,
  readPlugin = () => JSON.parse(readFileSync(PLUGIN_JSON, "utf8")), readMarketplace = readMarketplaces, latest = fetchLatestVersion,
}) {
  return [
    await guard("OS", "ng", () => checkOs(platform)),
    await guard("実行環境", "ng", () => checkNode(nodeVersion)),
    await guard("保存先", "ng", () => checkHome(dir, canWrite)),
    await guard("祝日一覧への接続（内閣府）", "opt", () => checkHolidays(holidays)),
    await guard("Excel の読み取り（Python・pip・openpyxl）", "opt", () => checkExcel(dir, run, exists)),
    await guard("予定表の MCP の指定", "opt", () => checkMcp(dir, readMcp)),
    await guard("版", "info", () => checkVersion(readPlugin, readMarketplace, latest)),
  ];
}

const LABEL = { ok: "[OK]", ng: "[NG]", opt: "[任意]", info: "[情報]" };

/** 表示する行と終了コード。必須（ok・ng）が 1 つでも ng なら 3 */
export function render(items) {
  const lines = ["project-board 動作環境の診断（何も変更しません）", ""];
  for (const i of items) {
    lines.push(`${LABEL[i.level]} ${i.name}: ${i.detail}`);
    for (const f of i.fix) lines.push(`  → ${f}`);
  }
  const ng = items.filter((i) => i.level === "ng").length;
  const opt = items.filter((i) => i.level === "opt").length;
  lines.push("", ng ? `結果: [NG] の必須項目が ${ng} 件あります。上の「→」の順に進めてください。` : "結果: 必須の項目はすべて満たしています。" + (opt ? `任意の項目が ${opt} 件、未対応です（使うときだけ対処してください）。` : ""));
  return { lines, exitCode: ng ? 3 : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { data } = takeData(process.argv.slice(2));
  const home = pickHome(data);
  const { lines, exitCode } = render(await runChecks({ dir: home ? resolve(home) : null }));
  console.log(lines.join("\n"));
  process.exitCode = exitCode;
}
