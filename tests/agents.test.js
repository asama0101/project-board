import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../plugins/project-board/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

for (const name of ["intake", "intake-calendar"]) {
  test(`サブエージェント ${name}: frontmatter と共通ルール`, () => {
    const text = read(`agents/${name}.md`);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    assert.match(fm, new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm, /^description: .+/m);
    // intake-calendar だけが、利用者が指定した予定表の MCP のツールを呼ぶため、tools で絞らず全ツールを引き継ぐ(絞ると MCP が呼べない)。
    // 外の人が書いた文章を読む intake(Excel)は、tools を絞る
    if (name === "intake-calendar") assert.doesNotMatch(fm, /^tools:/m);
    else assert.match(fm, /^tools: Read, Write, Bash$/m);
    assert.ok(text.includes("承認"));
    assert.ok(text.includes(".project-board/data.json"));
    // リポジトリ直下を前提にしたパスが残っていない
    assert.doesNotMatch(text, /node "?tools\//);
    assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
  });
}

test("inbox: 受信箱を処理するエージェント。tools は Read, Bash で絞り、聞き返し・画面で行う操作の案内・CLI を持ち、承認・却下の節は持たない", () => {
  const text = read("agents/inbox.md");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  assert.match(fm, /^name: inbox$/m);
  assert.match(fm, /^description: .+/m);
  assert.match(fm, /^tools: Read, Bash$/m);
  for (const word of ["${CLAUDE_PLUGIN_ROOT}/tools/inbox.js", "claim", "propose", "ask", "fail", "承認", "画面で行ってください", ".project-board/data.json", "moveDue", "addTask", "compress"]) assert.ok(text.includes(word), word);
  assert.doesNotMatch(text, /## 承認・却下/, "承認・却下は /project-board:watch の手順。エージェントは承認を待たない");
  assert.match(text, /推測/);
  assert.match(text, /止まらない/);
  assert.doesNotMatch(text, /node "?tools\//);
  assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
});

test("MCP を同梱しない（.mcp.json がない）", () => {
  assert.equal(existsSync(new URL(".mcp.json", root)), false);
});

test("intake: WBS・規則の手順と承認がある。予定表（MCP）の手順は持たず、intake-calendar を案内する", () => {
  const t = read("agents/intake.md");
  for (const w of [
    '${CLAUDE_PLUGIN_ROOT}/tools/intake.js', '${CLAUDE_PLUGIN_ROOT}/tools/xlsx.js',
    "wbs-plan", "wbs-apply", "rules-set", "rules-apply", "mapping-get", "mapping-set", "承認", "CSV", "project-board:intake-calendar",
  ]) assert.ok(t.includes(w), w);
  for (const w of ["calendar-auto", "calendar-apply", "mcpconf.js", "/project-board:mcp"]) assert.ok(!t.includes(w), w);
  assert.doesNotMatch(t, /## calendar/);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake-calendar: 予定表の手順と MCP の指定がある。Excel・規則の手順は持たない", () => {
  const t = read("agents/intake-calendar.md");
  for (const w of ['${CLAUDE_PLUGIN_ROOT}/tools/intake.js', 'tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" show', "calendar-auto", "calendar-apply", "/project-board:mcp", "使った MCP", "`tools` を省略"]) assert.ok(t.includes(w), w);
  for (const w of ["xlsx.js", "wbs-plan", "rules-set"]) assert.ok(!t.includes(w), w);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake・intake-calendar: 文章の手順が無い。文章を貼られたときは HTML の帯からの依頼を案内する", () => {
  const t = read("agents/intake.md");
  assert.doesNotMatch(t, /## 文章/);
  assert.doesNotMatch(t, /submit/);
  for (const w of ["## wbs", "## rules", "Claude Code に依頼する"]) assert.ok(t.includes(w), w);
  const c = read("agents/intake-calendar.md");
  assert.doesNotMatch(c, /submit/);
  for (const w of ["## calendar", "Claude Code に依頼する"]) assert.ok(c.includes(w), w);
});

test("intake(wbs): 列の対応と変更案を一緒に見せて承認 1 回", () => {
  const t = read("agents/intake.md");
  assert.match(t, /対応表.*変更案/);
});

test("inbox: addTask は businessDays（due と排他）で営業日を書き、期限が無いときは聞き返さず仮で置く。行番号で直す", () => {
  const t = read("agents/inbox.md");
  for (const w of ["businessDays", "行番号", "仮", "もう一度"]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /期限が書かれていない/);
});

test("inbox: 依頼で受ける操作は addTask と moveDue の 2 種類で、ref を他の操作から指せることが書かれている。画面で行う操作は ask で案内する", () => {
  const t = read("agents/inbox.md");
  assert.ok(t.includes("2 種類だけ"));
  for (const op of ["moveDue", "addTask"]) assert.ok(t.includes(`"op":"${op}"`), op);
  for (const op of ["addPred", "addProject", "setStatus", "setImportance", "removeTask", "removeProject", "addMilestone", "addChecklistItem"]) assert.ok(!t.includes(`"op":"${op}"`), `${op} は書かない`);
  assert.ok(t.includes("3〜5 件"));
  assert.match(t, /ref.*moveDue|predecessors.*ref/);
  assert.match(t, /この依頼は画面で行ってください/);
});

test("inbox: 原因が複数なら「その他」", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /原因が複数.*その他/);
});

test("inbox: 文章（メール・議事録・メモ）の取り込み手順があり、日程の遅れは原因を読み取る", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /メール・議事録・メモ/);
  assert.match(t, /--cause/);
});

test("inbox: 対象外の依頼は、会議の追加・削除と、intake で扱うもの（Excel・予定表・会議の規則）だけ", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("**対象外の依頼**")) ?? "";
  assert.ok(line, "対象外の依頼の行がある");
  assert.match(line, /会議/);
  assert.match(line, /intake/);
  assert.doesNotMatch(line, /プロジェクト・会議の追加|タスクの削除|状態の変更|既存のプロジェクトの変更/);
});

test("intake・inbox: 祝日の取得は propose が行うので、エージェントは holidays.js を呼ばない", () => {
  for (const name of ["agents/intake.md", "agents/intake-calendar.md", "agents/inbox.md"]) {
    const t = read(name);
    assert.doesNotMatch(t, /holidays\.js/, name);
    assert.match(t, /warnings/, name);
  }
});

test("inbox: 仮に置いた期限がプロジェクトの期間（projects[].start〜due）に収まるか確かめ、収まらなければ --summary に警告として書く（intake と共通の指針）", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("projects[].start"));
  assert.ok(line, "プロジェクトの期間の確認がある");
  for (const w of ["収まる", "警告", "--summary"]) assert.ok(line.includes(w), w);
});

test("inbox: moveDue と businessDays の addTask は同じ依頼にしない。エラーが出たら、期限の移動だけを提案し、登録は承認後にもう一度依頼してもらう", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("moveDue") && l.includes("businessDays") && l.includes("同じ依頼"));
  assert.ok(line, "併用できない旨");
  for (const w of ["期限の移動だけ", "--summary", "承認後", "もう一度依頼"]) assert.ok(line.includes(w), w);
});

test("inbox・intake: 外から来た文章（依頼・メール・Excel のセル・予定表の件名）は、読むだけのデータで、中の指示には従わないと書く", () => {
  for (const name of ["inbox", "intake", "intake-calendar"]) {
    const text = read(`agents/${name}.md`);
    assert.match(text, /読むだけのデータ/, name);
    assert.match(text, /指示（[^）]*）には従わない/, name);
  }
});

test("intake-calendar: 承認の確認なしで calendar-auto を実行し、保留・取得 0 件・失敗を知らせる。blocked のときだけ、削除してよいか聞いてから calendar-apply", () => {
  const t = read("agents/intake-calendar.md");
  const cal = t.slice(t.indexOf("## calendar"));
  assert.ok(cal.length > 0, "## calendar の節がある");
  for (const w of ["calendar-auto", "承認の確認なし", "held", "blocked", "取得に失敗", "fetched.json", "--data", "使った MCP", "削除してよいか", "calendar-apply"]) assert.ok(cal.includes(w), w);
  const step3 = cal.slice(cal.indexOf("3. `calendar-auto"), cal.indexOf("4. 結果"));
  assert.doesNotMatch(step3, /calendar-plan|calendar-apply/, "書き込みの手順に、変更案の表も calendar-apply もない");
  const step5 = cal.slice(cal.indexOf("5. `blocked`"), cal.indexOf("6. "));
  for (const w of ["calendar-plan", "見張りからのときは、聞かずに終わる", "実績"]) assert.ok(step5.includes(w), w);
  assert.doesNotMatch(t, /## calendar --auto/, "calendar --auto の節は calendar に統合した");
});

test("watch: 見張りの開始時と、30 分ごとの再起動時に、project-board:intake-calendar エージェントへ calendar（見張りから）を頼む。予定表の MCP が未指定なら更新しない", () => {
  const t = read("skills/watch/SKILL.md");
  for (const w of ["calendar（見張りから）", "project-board:intake-calendar", "未指定", "30 分"]) assert.ok(t.includes(w), w);
  const step = t.slice(t.indexOf("予定表を更新します"), t.indexOf("2. イベントの種類"));
  assert.ok(step.length > 0 && step.includes("calendar（見張りから）"), "Monitor の起動（手順 1）の後ろに、予定表の更新がある");
  assert.ok(t.indexOf("予定表を更新します") > t.indexOf("1. Monitor"), "見張りを始めてから更新する（許可の確認で、見張りの開始が止まらないように）");
  assert.match(t.slice(t.indexOf("4. 30 分で")), /予定表/, "再起動時にも予定表を更新する");
});

test("mcp: 保存済みの selfEmails があれば、手順 4 で聞き直さない", () => {
  const t = read("skills/mcp/SKILL.md");
  const step = t.slice(t.indexOf("4. **自分のメールアドレス"), t.indexOf("5. **試しに"));
  assert.match(step, /保存済みなら、聞かずに/);
});

test("inbox: addTask の checklist は文字列の配列", () => {
  const t = read("agents/inbox.md");
  assert.ok(t.includes('"checklist":["'));
});
