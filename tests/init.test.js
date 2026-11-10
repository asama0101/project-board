import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { init, MARKER } from "../plugins/project-board/tools/init.js";
import { validate } from "../plugins/project-board/src/core/schema.js";

const REPO = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "projectboard-init-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
const proj = (name = "proj") => { const d = join(base, `${++n}-${name}`); mkdirSync(d, { recursive: true }); return d; };
/** 偽の pluginRoot: 同梱の完成版（目印つきのダミー）と、本物のサンプル */
const plugin = (html = `<html>${MARKER}v1</html>`) => {
  const d = proj("plugin");
  mkdirSync(join(d, "assets")); mkdirSync(join(d, "data"));
  writeFileSync(join(d, "assets/project-board.html"), html);
  copyFileSync(join(REPO, "data/sample.json"), join(d, "data/sample.json"));
  return d;
};
const names = (d) => readdirSync(d).sort();
const status = (r, p) => r.results.find((x) => x.path === p)?.status;

test("空のフォルダ: project-board.html と .project-board/data.json だけができる（.gitignore は作らない）", () => {
  const cwd = proj(), pluginRoot = plugin();
  const r = init({ cwd, pluginRoot });
  assert.equal(r.ok, true);
  assert.deepEqual(names(cwd), [".project-board", "project-board.html"]);
  assert.deepEqual(names(join(cwd, ".project-board")), ["data.json"]);
  const data = JSON.parse(readFileSync(join(cwd, ".project-board/data.json"), "utf8"));
  assert.deepEqual(validate(data).errors, []);
  assert.equal(status(r, "project-board.html"), "created");
});

test(".git のあるフォルダ: .gitignore に .project-board/ が1行だけ入り、再実行しても増えない", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  init({ cwd, pluginRoot });
  init({ cwd, pluginRoot });
  const lines = readFileSync(join(cwd, ".gitignore"), "utf8").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(lines, [".project-board/"]);
});

test("既存の data.json は再実行でも --sample でも1バイトも変わらない", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".project-board"));
  const mine = '{"keep":"me",\n "日本語": true}';
  writeFileSync(join(cwd, ".project-board/data.json"), mine);
  init({ cwd, pluginRoot });
  init({ cwd, pluginRoot, sample: true });
  assert.equal(readFileSync(join(cwd, ".project-board/data.json"), "utf8"), mine);
});

test("目印のない既存 project-board.html: 何も作らずに中断する（data.json も .gitignore も）", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, "project-board.html"), "<html>自分のファイル</html>");
  const r = init({ cwd, pluginRoot });
  assert.equal(r.ok, false);
  assert.match(r.error, /project-board\.html/);
  assert.deepEqual(r.results, []);
  assert.equal(existsSync(join(cwd, ".project-board")), false);
  assert.equal(existsSync(join(cwd, ".gitignore")), false);
  assert.equal(readFileSync(join(cwd, "project-board.html"), "utf8"), "<html>自分のファイル</html>");
});

test("目印つきの古い project-board.html は updated、同じなら unchanged", () => {
  const cwd = proj();
  writeFileSync(join(cwd, "project-board.html"), `<html>${MARKER}古い版</html>`);
  const pluginRoot = plugin(`<html>${MARKER}新しい版</html>`);
  assert.equal(status(init({ cwd, pluginRoot }), "project-board.html"), "updated");
  assert.equal(readFileSync(join(cwd, "project-board.html"), "utf8"), `<html>${MARKER}新しい版</html>`);
  assert.equal(status(init({ cwd, pluginRoot }), "project-board.html"), "unchanged");
});

test("--sample: data.json にサンプルの内容が入る", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot, sample: true });
  assert.equal(readFileSync(join(cwd, ".project-board/data.json"), "utf8"), readFileSync(join(pluginRoot, "data/sample.json"), "utf8"));
});

test("末尾に改行のない .gitignore へ、最後の行と連結せずに追記する", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/");
  init({ cwd, pluginRoot });
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "node_modules/\n.project-board/\n");
});

test("CRLF の .gitignore には CRLF で追記する", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(cwd, ".gitignore"), "dist/\r\n");
  init({ cwd, pluginRoot });
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), "dist/\r\n.project-board/\r\n");
});

test("空白と日本語を含むフォルダ名でも動く", () => {
  const cwd = proj("プロジェクト A"), pluginRoot = plugin();
  assert.equal(init({ cwd, pluginRoot }).ok, true);
  assert.ok(existsSync(join(cwd, "project-board.html")) && existsSync(join(cwd, ".project-board/data.json")));
});

test(".git のないサブフォルダ: .gitignore を作らず、skipped と理由を返す", () => {
  const cwd = proj(), pluginRoot = plugin();
  const r = init({ cwd, pluginRoot });
  assert.equal(existsSync(join(cwd, ".gitignore")), false);
  const g = r.results.find((x) => x.path === ".gitignore");
  assert.equal(g.status, "skipped");
  assert.match(g.note, /\.git/);
});

test("空のひな形に対して validate が落ちない", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot });
  const data = join(cwd, ".project-board/data.json");
  for (const args of [["validate.js", data]]) {
    const r = spawnSync(process.execPath, [join(REPO, "tools", args[0]), ...args.slice(1)], { encoding: "utf8" });
    assert.equal(r.status, 0, `${args[0]}: ${r.stderr}${r.stdout}`);
  }
});

test("親フォルダが git 管理のとき、サブフォルダにも .gitignore を作って .project-board/ を除外する", () => {
  const parent = proj("repo"), pluginRoot = plugin();
  mkdirSync(join(parent, ".git"));
  const cwd = join(parent, "network");
  mkdirSync(cwd);
  const r = init({ cwd, pluginRoot });
  assert.equal(status(r, ".gitignore"), "created");
  assert.equal(readFileSync(join(cwd, ".gitignore"), "utf8"), ".project-board/\n");
});

test("UTF-16 の .gitignore は壊さずに、変更しないで知らせる", () => {
  const cwd = proj(), pluginRoot = plugin();
  mkdirSync(join(cwd, ".git"));
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("dist/\r\n", "utf16le")]);
  writeFileSync(join(cwd, ".gitignore"), utf16);
  const r = init({ cwd, pluginRoot });
  assert.ok(readFileSync(join(cwd, ".gitignore")).equals(utf16));
  const g = r.results.find((x) => x.path === ".gitignore");
  assert.equal(g.status, "skipped");
  assert.match(g.note, /UTF-8/);
});

test("空のひな形: projectRules が空で、見出しの既定が入る", () => {
  const cwd = proj(), pluginRoot = plugin();
  init({ cwd, pluginRoot });
  const d = JSON.parse(readFileSync(join(cwd, ".project-board/data.json"), "utf8"));
  assert.deepEqual(d.settings.projectRules, []);
  assert.deepEqual(d.settings.labels, { group: "大項目", subgroup: "中項目" });
});
