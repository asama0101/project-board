// 使い方: node tools/init.js [--sample]
// 作業フォルダ(利用者のプロジェクト)に、ダッシュボード(project-board.html)とデータ(.project-board/data.json)を用意する。何度実行しても同じ結果になる。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WORKDAY } from "../src/core/schema.js";

/** この目印があるファイルだけを、project-board が作ったものとみなして更新する */
export const MARKER = '<meta name="generator" content="project-board">';

const HTML = "project-board.html";
const DATA = ".project-board/data.json";
const IGNORE = ".project-board/";

const SKELETON = {
  version: 1,
  settings: { workday: DEFAULT_WORKDAY, waitingLongDays: 7, projectRules: [], labels: { group: "大項目", subgroup: "中項目" } },
  projects: [], tasks: [], events: [], changeLog: [],
};

/** cwd か、その親のどこかに .git があるか(サブフォルダで実行しても、親のリポジトリに入りうる) */
function inGitRepo(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}

const lineOf = (s) => s.split(/\r?\n/).some((l) => l.trim() === IGNORE || l.trim() === ".project-board");

/**
 * 結果は { ok, results: [{ path, status, note? }], error? }。ok が false のときは何も書き込んでいない。
 * status は created / updated / unchanged / appended / skipped
 */
export function init({ cwd, pluginRoot, sample = false }) {
  const bundled = readFileSync(join(pluginRoot, "assets", HTML), "utf8");
  const htmlPath = join(cwd, HTML);
  const current = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : null;
  // 利用者の既存ファイルを守る: 検査に通らなければ、何も作らずに止める
  if (current !== null && !current.includes(MARKER)) {
    return { ok: false, results: [], error: `${HTML} が既にあり、project-board が作ったものではないため、何も変更せずに止めました。名前を変えるか移動してから、もう一度実行してください` };
  }

  const results = [];

  const dataPath = join(cwd, DATA);
  if (existsSync(dataPath)) {
    results.push({ path: DATA, status: "unchanged" });
  } else {
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, sample ? readFileSync(join(pluginRoot, "data", "sample.json"), "utf8") : JSON.stringify(SKELETON, null, 2) + "\n");
    results.push({ path: DATA, status: "created", ...(sample && { note: "サンプルデータ" }) });
  }

  if (current === null) {
    writeFileSync(htmlPath, bundled);
    results.push({ path: HTML, status: "created" });
  } else if (current === bundled) {
    results.push({ path: HTML, status: "unchanged" });
  } else {
    writeFileSync(htmlPath, bundled);
    results.push({ path: HTML, status: "updated" });
  }

  if (!inGitRepo(cwd)) {
    results.push({ path: ".gitignore", status: "skipped", note: "この場所も親のフォルダにも .git がないため、.gitignore は変更しません" });
  } else {
    const giPath = join(cwd, ".gitignore");
    const raw = existsSync(giPath) ? readFileSync(giPath) : null;
    // UTF-16 など UTF-8 以外の .gitignore は、壊さないように触らない
    const notUtf8 = raw !== null && (raw.includes(0) || (raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff));
    const gi = raw === null || notUtf8 ? null : raw.toString("utf8");
    if (notUtf8) {
      results.push({ path: ".gitignore", status: "skipped", note: ".gitignore が UTF-8 ではないため変更しません。.project-board/ を自分で追記してください" });
    } else if (gi !== null && lineOf(gi)) {
      results.push({ path: ".gitignore", status: "unchanged" });
    } else {
      const eol = gi && gi.includes("\r\n") ? "\r\n" : "\n";
      const lead = gi && !gi.endsWith("\n") ? eol : "";
      writeFileSync(giPath, (gi ?? "") + lead + IGNORE + eol);
      results.push({ path: ".gitignore", status: gi === null ? "created" : "appended" });
    }
  }
  return { ok: true, results };
}

const LABEL = { created: "作りました", updated: "更新しました", unchanged: "そのままです", appended: "追記しました", skipped: "変更しませんでした" };

function main() {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let r;
  try { r = init({ cwd: process.cwd(), pluginRoot, sample: process.argv.includes("--sample") }); }
  catch (e) { console.error(`失敗しました: ${e.message}`); process.exit(1); }
  if (!r.ok) { console.error(r.error); process.exit(1); }
  for (const x of r.results) console.log(`${x.path}: ${LABEL[x.status]}${x.note ? `（${x.note}）` : ""}`);
  console.log(`\n次の手順: ブラウザで ${HTML} を開き、「ファイルを開く」で ${DATA} を選びます。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
