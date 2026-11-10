import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const root = new URL("../plugins/project-board/", import.meta.url);
const json = (p, base = root) => JSON.parse(readFileSync(new URL(p, base), "utf8"));
const marketplace = () => json(".claude-plugin/marketplace.json", repoRoot);

test("plugin.json: 名前とバージョンが package.json と一致する", () => {
  const plugin = json(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "project-board");
  assert.equal(plugin.version, "1.0.0");
  assert.equal(plugin.version, json("package.json").version);
  assert.ok(plugin.description);
});

test("marketplace.json: plugins/project-board を project-board プラグインとして指す", () => {
  const mkt = marketplace();
  assert.equal(mkt.name, "project-board");
  assert.ok(mkt.owner?.name);
  assert.equal(mkt.plugins.length, 1);
  assert.equal(mkt.plugins[0].name, json(".claude-plugin/plugin.json").name);
  assert.equal(mkt.plugins[0].source, "./plugins/project-board");
});

test(".claude-plugin/ の中にコンポーネントを置かない（置くと読み込まれない）", () => {
  for (const dir of ["agents", "skills", "commands", "hooks"]) {
    assert.equal(existsSync(new URL(`.claude-plugin/${dir}`, root)), false, dir);
  }
});

test("配布に必要なファイルが git に入っている（.gitignore で除外されていない）", (t) => {
  const r = spawnSync("git", ["ls-files"], { cwd: fileURLToPath(repoRoot), encoding: "utf8" });
  if (r.status !== 0) return t.skip("git で調べられません");
  const tracked = new Set(r.stdout.split(/\r?\n/).map((f) => f.replace(/^plugins\/project-board\//, "")));
  const need = [
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "NOTICE", "assets/project-board.html", "data/sample.json", "tools/init.js",
    "tools/intake.js", "tools/inbox.js", "tools/validate.js", "tools/holidays.js", "tools/mcpconf.js", "tools/xlsx.js", "tools/xlsx_dump.py", "tools/home.js", "tools/cli.js", "tools/doctor.js",
    ...["doctor", "init", "intake", "mcp", "watch"].map((n) => `skills/${n}/SKILL.md`),
    ...["intake", "inbox"].map((n) => `agents/${n}.md`),
  ];
  assert.deepEqual(need.filter((p) => !tracked.has(p)), []);
});

test("廃止したコマンド・エージェント・CLI が残っていない", () => {
  for (const p of ["skills/daily-planner", "agents/daily-planner.md", "tools/free.js", "tools/rank.js"]) {
    assert.equal(existsSync(new URL(p, root)), false, p);
  }
});

test("説明文に、廃止したコマンド（今日の計画・daily-planner）が残っていない", () => {
  const texts = [json(".claude-plugin/plugin.json").description, marketplace().metadata?.description, ...marketplace().plugins.map((p) => p.description)];
  for (const t of texts) assert.doesNotMatch(String(t), /今日の計画|daily-planner/);
});

test("レポートを廃止した: 画面にレポートのボタンがない", () => {
  const html = readFileSync(new URL("assets/project-board.html", root), "utf8");
  assert.ok(!html.includes("data-report"));
});

// --- F1 の 3・4・8: パスの実在、禁止するパスの書き方、claude plugin validate ---
import { readdirSync } from "node:fs";

const rootPath = fileURLToPath(root);
const docs = () => [
  ...readdirSync(new URL("skills/", root)).map((n) => `skills/${n}/SKILL.md`),
  ...readdirSync(new URL("agents/", root)).filter((f) => f.endsWith(".md")).map((f) => `agents/${f}`),
].map((p) => ({ p, text: readFileSync(new URL(p, root), "utf8") }));

test("SKILL.md・agents が書く ${CLAUDE_PLUGIN_ROOT}/… のパスが、plugins/project-board 内に実在する", () => {
  const found = [];
  for (const { p, text } of docs()) {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"'`)<>*]+)/g)) {
      const rel = m[1].replace(/[.,;:、。]+$/, "");
      found.push(rel);
      assert.ok(existsSync(new URL(rel, root)), `${p}: \${CLAUDE_PLUGIN_ROOT}/${rel} がありません`);
    }
  }
  assert.ok(found.length > 5, "パスを 1 つも拾えていない（検査が空振りしている）");
});

test("SKILL.md・agents に、相対リンク・ハードコードした絶対パス・${CLAUDE_SKILL_DIR} を書いていない", () => {
  for (const { p, text } of docs()) {
    assert.doesNotMatch(text, /\]\(\.\.?\//, `${p}: 相対リンク`);
    assert.doesNotMatch(text, /[A-Za-z]:[\/]+Users[\/]/i, `${p}: 絶対パス`);
    assert.doesNotMatch(text, /\$\{CLAUDE_SKILL_DIR\}/, `${p}: CLAUDE_SKILL_DIR`);
  }
});

test("E1-4: SKILL.md・agents の地の文に、${CLAUDE_PLUGIN_ROOT} なしの相対パス（tools/・assets/・data/）がない", () => {
  for (const { p, text } of docs()) {
    // ${CLAUDE_PLUGIN_ROOT}/ の直後のパスと、.project-board/data.json（利用者のデータ）は除く
    const bare = text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/[\w.\/*<>-]*/g, "").replace(/\.project-board\/data\.json/g, "");
    assert.doesNotMatch(bare, /(^|[^\w.\/-])(tools|assets|data)\/[\w*.-]+/m, `${p}: 地の文の相対パス`);
  }
});

test("C1: NOTICE があり、git 管理下で、取得する外部依存の出典を書いている", (t) => {
  const notice = readFileSync(new URL("NOTICE", root), "utf8");
  for (const w of ["openpyxl", "et_xmlfile", "defusedxml", "syukujitsu.csv", "MIT", "同梱している外部のコード・文書"]) assert.ok(notice.includes(w), w);
  const r = spawnSync("git", ["ls-files", "plugins/project-board/NOTICE"], { cwd: fileURLToPath(repoRoot), encoding: "utf8" });
  if (r.status !== 0) return t.skip("git で調べられません");
  assert.match(r.stdout, /NOTICE/);
});

test("A3・A4: README に、ネットワーク接続の依存と、環境の確認（doctor）の呼び出し方を書いている", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  assert.match(readme, /ネットワーク/);
  assert.match(readme, /\/project-board:doctor/);
  assert.match(readme, /tools\/doctor\.js" --data/);
});

test("Excel 用の Python: README は、システムの openpyxl を使うことと、無いときの入れ先(専用の venv・システムのユーザー領域)と、venv を作れない Python を書く", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  assert.match(readme, /Python 3\.8 以上/);
  assert.match(readme, /標準ライブラリの venv と ensurepip が要ります/);
  assert.match(readme, /システムの Python に openpyxl/);
  assert.match(readme, /専用の venv/);
  assert.match(readme, /pip install --user/);
  assert.match(readme, /venv と ensurepip が無いとき/);
});

// claude コマンドが無ければ skip。Windows の claude.cmd を起動できるよう shell を経由する（引数は固定の文字列だけ）
const claude = (args, cwd) => spawnSync(`claude ${args}`, { cwd, encoding: "utf8", shell: true, timeout: 120000 });
for (const [label, args, cwd] of [["プラグイン(--strict)", "plugin validate plugins/project-board --strict", repoRoot], ["marketplace", "plugin validate .", repoRoot]]) {
  test(`claude ${args} が通る（claude コマンドが無ければ skip）`, (t) => {
    if (claude("--version", rootPath).status !== 0) return t.skip("claude コマンドが見つかりません");
    const r = claude(args, fileURLToPath(cwd));
    assert.equal(r.status, 0, `${label}\n${r.stdout}\n${r.stderr}`);
  });
}

test("H1: plugin.json と marketplace.json の description に「Windows 専用」を書いている", () => {
  assert.match(json(".claude-plugin/plugin.json").description, /Windows 専用/);
  assert.match(marketplace().plugins[0].description, /Windows 専用/);
});

test("C3: intake-calendar だけが tools を省略し（予定表の MCP を呼ぶため）、その理由を本文に書く。intake（Excel）は tools を絞る", () => {
  const front = (n) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(new URL(`agents/${n}.md`, root), "utf8"))[1];
  const cal = readFileSync(new URL("agents/intake-calendar.md", root), "utf8");
  assert.doesNotMatch(front("intake-calendar"), /^tools:/m);
  assert.match(cal, /`tools` を省略/);
  assert.match(front("intake"), /^tools: Read, Write, Bash$/m);
});

test("README: アンインストールで消えるもの・残るもの(H4)を書き、intake は自動起動を外していない(C5)", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  assert.match(readme, /### アンインストール/);
  assert.match(readme, /project-board-mcp\.json/);
  for (const n of ["intake"]) assert.doesNotMatch(readFileSync(new URL(`skills/${n}/SKILL.md`, root), "utf8"), /disable-model-invocation/);
});

test("README: コマンド一覧に inbox・replan・holidays が無く、init・mcp・watch・intake がある。日程変更の例は /project-board:replan を使わない", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  const table = readme.slice(readme.indexOf("### コマンド一覧"), readme.indexOf("### 画面の見方"));
  for (const n of ["doctor", "init", "mcp", "watch", "intake"]) assert.ok(table.includes(`/project-board:${n}`), n);
  for (const n of ["inbox", "replan", "holidays"]) assert.ok(!readme.includes(`/project-board:${n}`), n);
});

test("Node の版: package.json の engines が README の動作確認の版（24）と一致し、GitHub Actions が同じ版で npm test を実行する", () => {
  assert.equal(json("package.json").engines?.node, ">=24");
  assert.match(readFileSync(new URL("README.md", repoRoot), "utf8"), /Node\.js \| 24 以上/);
  const wf = readFileSync(new URL(".github/workflows/test.yml", repoRoot), "utf8");
  assert.match(wf, /node-version: 24\b/);
  assert.match(wf, /run: npm test\b/);
});
