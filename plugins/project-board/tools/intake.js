// 使い方: node tools/intake.js <コマンド> <data.json> ...   （コマンドの一覧は引数なしで実行すると出る）
// 取り込み（WBS・予定表）と、会議のプロジェクト規則、WBS の列の対応を扱う。結果は JSON で標準出力へ。
// *-plan・*-list・*-get は data.json を書かない。*-apply・*-set・*-remove は検証に通ったときだけ書く。
import { today, isDate, nowLocal } from "../src/core/dates.js";
import { readJson, out, save } from "./cli.js";
import { assignMeetingProjects, setProjectRule, removeProjectRule } from "../src/core/rules.js";
import { planWbsImport, applyWbsImport, getWbsMapping, setWbsMapping } from "../src/import/wbs.js";
import { planCalendarSync, planAutoSync } from "../src/import/calendar.js";
import { readMcpConfig, validateMcpConfig } from "../src/import/mcpconf.js";
import { takeData, pickHome } from "./home.js";

const USAGE = `使い方: node tools/intake.js <コマンド> <data.json> ...
  wbs-plan | wbs-apply   <data.json> <projectId> <rows.json> [--source <取り込んだファイル名>]   (--source は wbs-apply の取り込み記録用)
  calendar-auto                  <data.json> <fetched.json> <開始日> <終了日> [--data <置き場>]   (自動更新。見張りと /project-board:intake calendar が使う。承認の確認なしで書く。終わった会議・確認済みの会議は変えず、取得が 0 件なら消さない)
  calendar-plan | calendar-apply <data.json> <fetched.json> <開始日> <終了日> [--data <置き場>]   (--data は、自分のメールアドレスなどの設定（project-board-mcp.json）の置き場。環境変数 PROJECT_BOARD_HOME が優先)
  rules-list | rules-apply <data.json>
  rules-set              <data.json> <keyword> <projectId>
  rules-remove           <data.json> <keyword>
  mapping-get            <data.json> <projectId>
  mapping-set            <data.json> <projectId> <mapping.json>`;

const usage = () => { console.error(USAGE); process.exit(2); };

// コマンド名 → [必要な引数の数(コマンド名を除く), 実行]
const COMMANDS = {
  "wbs-plan": [3, (d, [, pid, rows]) => out(planWbsImport(d, pid, readJson(rows)))],
  "wbs-apply": [3, (d, [path, pid, rows], o) => {
    const plan = planWbsImport(d, pid, readJson(rows));
    save(path, applyWbsImport(d, pid, plan, { today: today(), source: o.source }));
    out({ ok: true, summary: { added: plan.add.length, updated: plan.update.length }, rejected: plan.rejected, warnings: plan.warnings });
  }],
  "calendar-plan": [4, (d, [, f, s, e], o) => {
    const { added, updated, removed, excluded, warnings } = planCalendarSync(d, readJson(f), { start: s, end: e }, o.calendar);
    const gone = new Set(excluded.map((e) => e.externalId));
    const removedByExclusion = removed.filter((e) => gone.has(e.externalId)).map((e) => ({ id: e.id, title: e.title, date: e.date, confirmed: !!e.confirmed })); // 対象外になって消える取り込み済みの会議。確認済みの実績も消えるので、承認の前に見せる
    out({ added, updated, removed, excluded: excluded.map(({ externalId, title, date, start, end }) => ({ externalId, title, date, start, end })), removedByExclusion, warnings }); // 参加者（メールアドレス）は出さない
  }],
  "calendar-apply": [4, (d, [path, f, s, e], o) => {
    const plan = planCalendarSync(d, readJson(f), { start: s, end: e }, o.calendar);
    save(path, plan.data); // 検証は save が行う
    out({ ok: true, summary: { added: plan.added.length, updated: plan.updated.length, removed: plan.removed.length, excluded: plan.excluded.length }, warnings: plan.warnings });
  }],
  "calendar-auto": [4, (d, [path, f, s, e], o) => {
    const plan = planAutoSync(d, readJson(f), { start: s, end: e }, o.calendar, nowLocal());
    save(path, plan.data); // 検証は save が行う
    out({ ok: true, summary: { added: plan.added.length, updated: plan.updated.length, removed: plan.removed.length, excluded: plan.excluded.length, held: plan.held.length }, held: plan.held, blocked: plan.blocked, warnings: plan.warnings });
  }],
  "rules-list": [1, (d) => out(d.settings?.projectRules ?? [])],
  "rules-apply": [1, (d, [path]) => { save(path, assignMeetingProjects(d)); out({ ok: true }); }],
  "rules-set": [3, (d, [path, k, pid]) => { save(path, setProjectRule(d, k, pid)); out({ ok: true }); }],
  "rules-remove": [2, (d, [path, k]) => { save(path, removeProjectRule(d, k)); out({ ok: true }); }],
  "mapping-get": [2, (d, [, pid]) => out(getWbsMapping(d, pid))],
  "mapping-set": [3, (d, [path, pid, m]) => { save(path, setWbsMapping(d, pid, readJson(m))); out({ ok: true }); }],
};

const { data: dataArg, rest: argv } = takeData(process.argv.slice(2));
const si = argv.indexOf("--source"); // wbs-apply の取り込み記録に残す、取り込んだファイル名
const opts = { source: si >= 0 ? argv[si + 1] ?? null : null };
const [cmd, ...args] = argv.filter((a, i) => a !== "--source" && !(si >= 0 && i === si + 1));
const spec = COMMANDS[cmd];
if (!spec || args.length < spec[0]) usage();
if (cmd.startsWith("calendar-") && !(isDate(args[2]) && isDate(args[3]))) usage();
try {
  if (cmd.startsWith("calendar-")) { // 自分だけの予定を除く設定
    const home = pickHome(dataArg);
    opts.calendar = home ? readMcpConfig(home).calendar : undefined;
    const errors = opts.calendar ? validateMcpConfig({ calendar: opts.calendar }) : [];
    if (errors.length) throw new Error(`project-board-mcp.json の指定が正しくありません: ${errors.join(" / ")}`);
  }
  spec[1](readJson(args[0]), args, opts);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
