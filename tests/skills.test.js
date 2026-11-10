import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../plugins/project-board/skills/${name}/SKILL.md`, import.meta.url), "utf8");
const front = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
const NAMES = ["doctor", "init", "intake", "mcp", "watch"];

for (const name of NAMES) {
  test(`コマンド ${name}: frontmatter と、リポジトリ直下を前提にしたパスがないこと`, () => {
    const text = read(name);
    const fm = front(text);
    assert.match(fm, new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm, /^description: .{10,}/m);
    assert.doesNotMatch(text, /node "?tools\//);
    assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
  });
}

for (const name of ["watch"]) {
  test(`${name}: 自動起動しない。inbox.js と inbox エージェントを使い、承認を端末で待たない`, () => {
    const text = read(name);
    assert.match(front(text), /^disable-model-invocation: true$/m);
    assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js"'));
    assert.ok(text.includes("project-board:inbox"));
    assert.ok(text.includes(".project-board/data.json"));
  });
}

test("watch: Monitor で wait を動かし、request のイベントと、30 分ごとの再起動を説明する", () => {
  const text = read("watch");
  for (const w of ["Monitor", "wait", "request", "1800000", "止まらない", "R3"]) assert.ok(text.includes(w), w);
  assert.ok(!text.includes("decision") && !text.includes('"warn"'), "warn・decision は出さない");
  for (const w of ["TaskList", "TaskStop", "見張りをやめて", "このセッションでは見張りが動いていません"]) assert.ok(text.includes(w), w);
  assert.ok(!text.includes("手順 4 の代わり"));
  assert.ok(!text.includes("/project-board:inbox"), "手動の入口（inbox コマンド）はない");
});

test("init: 副作用があるので自動起動しない。init.js を呼び、引数を渡す", () => {
  const text = read("init");
  assert.match(front(text), /^disable-model-invocation: true$/m);
  assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/tools/init.js"'));
  assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" --sample'));
  assert.ok(text.includes(".project-board/data.json") && text.includes("project-board.html"));
});

test("B3: init は $ARGUMENTS を Bash に埋め込まず、allowed-tools は引数なし・--sample の完全一致だけ", () => {
  const text = read("init");
  assert.ok(!text.includes("$ARGUMENTS"));
  const line = /^allowed-tools: (.+)$/m.exec(front(text))?.[1] ?? "";
  assert.ok(!line.includes("*"), line);
});

test("doctor: 自動起動しない。doctor.js だけを、引数つきの完全一致で事前承認し、使わない場面を description に書く", () => {
  const text = read("doctor");
  assert.match(front(text), /^disable-model-invocation: true$/m);
  const line = /^allowed-tools: (.+)$/m.exec(front(text))?.[1] ?? "";
  assert.ok(line.includes('tools/doctor.js" --data "${CLAUDE_PLUGIN_DATA}")'), line);
  assert.ok(!line.includes("*"), line);
  assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/tools/doctor.js" --data "${CLAUDE_PLUGIN_DATA}"'));
  assert.match(/^description: (.+)$/m.exec(front(text))?.[1] ?? "", /使わない/);
});

test("B3: mcp・watch の allowed-tools は、サブコマンドまで絞り、スクリプト全体を許可しない", () => {
  for (const [name, script] of [["mcp", "mcpconf.js"], ["watch", "inbox.js"]]) {
    const line = /^allowed-tools: (.+)$/m.exec(front(read(name)))?.[1] ?? "";
    assert.doesNotMatch(line, new RegExp(`${script.replace(".", "\\.")}" \\*\\)`), `${name}: ${script} 全体を許可している`);
  }
});

test("B1: init・mcp・両エージェントの description に、使わない場面と代わりを書いている", () => {
  const desc = (t) => /^description: (.+)$/m.exec(front(t))?.[1] ?? "";
  for (const t of [read("init"), read("mcp")]) assert.match(desc(t), /使わない/);
  for (const n of ["inbox", "intake"]) {
    const t = readFileSync(new URL(`../plugins/project-board/agents/${n}.md`, import.meta.url), "utf8");
    assert.match(desc(t), /使わない/, n);
    assert.ok(desc(t).length < 1536);
  }
});

for (const name of ["intake"]) {
  test(`${name}: 同名のエージェントに依頼を渡す`, () => {
    const text = read(name);
    assert.ok(text.includes(`project-board:${name}`));
    assert.ok(text.includes("$ARGUMENTS"));
  });
}

for (const [name, script] of [["init", "init.js"], ["watch", "inbox.js"], ["watch", "holidays.js"]]) {
  test(`${name}: ${script} だけを、確認なしで実行できるよう事前承認する`, () => {
    const fm = front(read(name));
    const line = /^allowed-tools: (.+)$/m.exec(fm)?.[1] ?? "";
    assert.ok(line.includes(`Bash(node "\${CLAUDE_PLUGIN_ROOT}/tools/${script}"`), line);
    assert.doesNotMatch(line, /Bash\(node \*\)/, "node を何でも許可しない");
  });
}

test("エージェントとコマンドの本文に、リポジトリ直下の src/ を指す記述がない", async () => {
  const { readdirSync } = await import("node:fs");
  const files = [...NAMES.map((n) => `skills/${n}/SKILL.md`), ...readdirSync(new URL("../plugins/project-board/agents/", import.meta.url)).map((f) => `agents/${f}`)];
  for (const f of files) {
    const text = readFileSync(new URL(`../plugins/project-board/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /(^|[`\s(])src\//m, `${f} に src/ の直接参照があります（\${CLAUDE_PLUGIN_ROOT} から組み立てる）`);
  }
});

test("intake: 取り込みの種類を引数のヒントに出す", () => {
  const hint = /^argument-hint: (.+)$/m.exec(front(read("intake")))?.[1] ?? "";
  for (const w of ["wbs", "calendar", "rules"]) assert.ok(hint.includes(w), w);
});

test("mcp: 副作用があるので自動起動しない。mcpconf.js だけを事前承認し、保存先は ${CLAUDE_PLUGIN_DATA} を引数で渡す", () => {
  const text = read("mcp");
  const fm = front(text);
  assert.match(fm, /^disable-model-invocation: true$/m);
  const line = /^allowed-tools: (.+)$/m.exec(fm)?.[1] ?? "";
  assert.ok(line.includes('Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js"'), line);
  assert.doesNotMatch(line, /Bash\(node \*\)/);
  assert.ok(text.includes('"${CLAUDE_PLUGIN_DATA}"'));
  for (const w of ["show", "set", "試し", "サーバー名", "ツール名"]) assert.ok(text.includes(w), w);
});

test("mcp: 引数なしで終わる手順と矛盾する『指定のない役割』の文が無い", () => {
  assert.ok(!read("mcp").includes("指定のない役割"));
});


test("watch: 始めるとき holidays.js ensure を実行し、失敗しても見張りを続ける。端末での承認・却下の手順（get・approve・reject）がある", () => {
  const text = read("watch");
  assert.ok(text.includes('tools/holidays.js" ensure'));
  assert.match(text, /失敗.*続け|続け.*失敗/);
  for (const w of ["get", "approve", "reject", "R3 を承認", "R3 を却下"]) assert.ok(text.includes(w), w);
});

test("コマンドは doctor・init・intake・mcp・watch の 5 つだけ（inbox・replan・holidays は無い）", async () => {
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(new URL("../plugins/project-board/skills/", import.meta.url)).sort(), ["doctor", "init", "intake", "mcp", "watch"]);
  assert.deepEqual(readdirSync(new URL("../plugins/project-board/agents/", import.meta.url)).sort(), ["inbox.md", "intake-calendar.md", "intake.md"]);
});
