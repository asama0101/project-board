import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const plugin = join(repo, "plugins/project-board");
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test("「先行」「後続」が、画面・エージェントの指示・スキル・README に残っていない（「前のタスク」「次のタスク」「作業の順番」を使う）", () => {
  const files = [...walk(join(plugin, "src")), ...walk(join(plugin, "agents")), ...walk(join(plugin, "skills")), join(repo, "README.md")]
    .filter((p) => /\.(js|css|md)$/.test(p));
  const left = [];
  for (const p of files) {
    readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => { if (/先行|後続/.test(line)) left.push(`${relative(repo, p)}:${i + 1}`); });
  }
  assert.deepEqual(left, []);
});

test("削除したコマンド（/project-board:inbox・/project-board:replan・/project-board:holidays）や「replan に頼む」という案内が、画面・エージェントの指示・スキル・README・テストの文言に残っていない", () => {
  const files = [...walk(join(plugin, "src")), ...walk(join(plugin, "agents")), ...walk(join(plugin, "skills")), join(repo, "README.md")]
    .filter((p) => /\.(js|css|md)$/.test(p));
  const left = [];
  for (const p of files) {
    readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => { if (/\/project-board:(inbox|replan|holidays)|replan に頼|Claude Code の replan/.test(line)) left.push(`${relative(repo, p)}:${i + 1}`); });
  }
  assert.deepEqual(left, []);
});
