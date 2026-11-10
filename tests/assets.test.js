import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build, MODULES } from "../plugins/project-board/tools/build.js";
import { MARKER } from "../plugins/project-board/tools/init.js";

const ASSET = new URL("../plugins/project-board/assets/project-board.html", import.meta.url);

test("同梱の完成版ダッシュボードがあり、project-board の目印を含む", () => {
  assert.ok(existsSync(ASSET), "assets/project-board.html がありません（npm run build）");
  assert.ok(readFileSync(ASSET, "utf8").includes(MARKER));
});

test("同梱の完成版は、いまのソースのビルド結果と完全に一致する", () => {
  const dir = mkdtempSync(join(tmpdir(), "projectboard-asset-"));
  try {
    const out = build(join(dir, "project-board.html"));
    assert.equal(readFileSync(ASSET, "utf8"), readFileSync(out, "utf8"), "assets/project-board.html が古いです。npm run build を実行してコミットしてください");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ソースが CRLF（autocrlf の clone）でも、同じビルド結果になる", () => {
  const dir = mkdtempSync(join(tmpdir(), "projectboard-crlf-"));
  try {
    const root = join(dir, "repo");
    const repo = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
    for (const f of ["src/ui/index.html", "src/ui/theme.css", ...MODULES]) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), readFileSync(join(repo, f), "utf8").replace(/\r?\n/g, "\r\n"));
    }
    const out = build(join(dir, "out.html"), root);
    assert.equal(readFileSync(out, "utf8"), readFileSync(ASSET, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(".gitattributes: 完成版ダッシュボードは改行コードを変換しない設定が、このリポジトリのパスで効く（効かないと、autocrlf の環境で checkout のたびにビルド結果と食い違う）", (t) => {
  const r = spawnSync("git", ["check-attr", "text", "--", "plugins/project-board/assets/project-board.html"], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" });
  if (r.status !== 0) return t.skip("git で調べられません");
  assert.match(r.stdout, /text: unset/);
});
