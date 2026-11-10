import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateMcpConfig, readMcpConfig, setMcpRole, clearMcpRole, ROLES } from "../plugins/project-board/src/import/mcpconf.js";

const REPO = fileURLToPath(new URL("../plugins/project-board/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "pjl-mcp-"));
after(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
const dir = (name = "d") => join(base, `${++n}-${name}`, "data dir"); // 空白を含み、まだ存在しない
const cli = (d, ...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/mcpconf.js"), "--data", d, ...args], { encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* JSON でない出力 */ }
  return { status: r.status, out, err: r.stderr };
};
const CAL = ["calendar", "server=outlook-cal", "listTool=list_events"];

test("ROLES と validateMcpConfig: 役割は calendar だけで、必須項目がすべて非空文字列", () => {
  assert.deepEqual(Object.keys(ROLES), ["calendar"]);
  assert.deepEqual(validateMcpConfig({ calendar: { server: "s", listTool: "l" } }), []);
  assert.ok(validateMcpConfig({ calendar: { server: "s" } }).length > 0);
  assert.ok(validateMcpConfig({ mail: { server: "s", searchTool: "a", readTool: "b" } }).length > 0);
  assert.ok(validateMcpConfig({ fax: { server: "s" } }).length > 0);
  assert.ok(validateMcpConfig({ calendar: { server: " ", listTool: "l" } }).length > 0);
});

test("show: ファイルが無ければ configured が false で、ディレクトリは作らない", () => {
  const d = dir();
  const r = cli(d, "show");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.configured, { calendar: false });
  assert.equal(existsSync(d), false);
  assert.deepEqual(readMcpConfig(d), {});
});

test("set calendar: 必須項目が揃えば保存され、show に反映される。dataDir に空白があっても動く", () => {
  const d = dir();
  assert.equal(cli(d, "set", ...CAL).status, 0);
  const r = cli(d, "show");
  assert.deepEqual(r.out.configured, { calendar: true });
  assert.equal(r.out.config.calendar.listTool, "list_events");
  assert.match(readFileSync(join(d, "project-board-mcp.json"), "utf8"), /outlook-cal/);
});

test("set: 不明な役割、必須項目の欠け、空文字は終了コード1で何も書かない", () => {
  const d = dir();
  for (const args of [["set", "fax", "server=x"], ["set", "mail", "server=s", "searchTool=a", "readTool=b"], ["set", "calendar", "server=s"], ["set", "calendar", "server=", "listTool=l"], ["set", "calendar", "oops"]]) {
    assert.equal(cli(d, ...args).status, 1, args.join(" "));
  }
  assert.equal(existsSync(join(d, "project-board-mcp.json")), false);
});

test("clear: 指定した役割が消える", () => {
  const d = dir();
  setMcpRole(d, "calendar", { server: "s", listTool: "l" });
  assert.equal(cli(d, "clear", "calendar").status, 0);
  assert.deepEqual(cli(d, "show").out.configured, { calendar: false });
  assert.equal(clearMcpRole(d, "calendar").calendar, undefined);
});

test("setMcpRole: savedAt を足す。不正は例外", () => {
  const d = dir();
  const c = setMcpRole(d, "calendar", { server: "s", listTool: "l" });
  assert.match(c.savedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => setMcpRole(dir(), "calendar", { server: "s" })); // 保存済みの値がなければ、必須の項目が足りず例外（あれば、保存済みの値に合成する）
  assert.equal(readMcpConfig(d).calendar.server, "s");
});

// --- schema_version (H3) と置き場の優先順 (A7) ---
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { SCHEMA_VERSION } from "../plugins/project-board/src/import/mcpconf.js";

const cliEnv = (env, ...args) => spawnSync(process.execPath, [join(REPO, "tools/mcpconf.js"), ...args], { encoding: "utf8", env: { ...process.env, PJ_LENS_HOME: "", ...env } });

test("schema_version: 保存すると現在の版(1)が先頭に入り、validate・show の対象の役割には数えない", () => {
  const d = dir();
  assert.equal(SCHEMA_VERSION, 1);
  const saved = setMcpRole(d, "calendar", { server: "s", listTool: "l" });
  assert.equal(saved.schema_version, 1);
  const onDisk = JSON.parse(readFileSync(join(d, "project-board-mcp.json"), "utf8"));
  assert.equal(Object.keys(onDisk)[0], "schema_version");
  assert.deepEqual(validateMcpConfig(onDisk), []);
  assert.deepEqual(cli(d, "show").out.configured, { calendar: true });
});

test("schema_version が無い project-board-mcp.json はエラーになる。/project-board:mcp も読めないので、ファイルのパスを示して、削除してから指定し直すよう案内する", () => {
  const d = dir();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "project-board-mcp.json"), JSON.stringify({ calendar: { server: "s", listTool: "l" }, savedAt: "2026-01-01" }));
  assert.throws(() => readMcpConfig(d), /\/project-board:mcp で指定し直してください/);
  const r = cli(d, "show");
  assert.equal(r.status, 1);
  assert.ok(r.err.includes(`project-board-mcp.json（${join(d, "project-board-mcp.json")}）を削除してから`), r.err);
  assert.equal(cli(d, "set", ...CAL).status, 1, "set も同じ文言で止まる（削除が先）");
});

test("schema_version: 未対応の版は読まずに止まる", () => {
  const d = dir();
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "project-board-mcp.json"), JSON.stringify({ schema_version: 99 }));
  assert.throws(() => readMcpConfig(d), /schema_version 99/);
  assert.equal(cli(d, "show").status, 1);
});

test("置き場: PJ_LENS_HOME が最優先、次に --data。どちらも無ければ終了コード 2（位置引数では渡せない）", () => {
  const env = dir("env"), arg = dir("arg");
  assert.equal(cliEnv({ PJ_LENS_HOME: env }, "--data", arg, "set", ...CAL).status, 0);
  assert.equal(existsSync(join(env, "project-board-mcp.json")), true);
  assert.equal(existsSync(arg), false, "--data の置き場には書かない");
  assert.equal(cliEnv({}, "--data", arg, "set", ...CAL).status, 0);
  assert.equal(existsSync(join(arg, "project-board-mcp.json")), true);
  assert.equal(cliEnv({}, "show").status, 2);
  assert.equal(cliEnv({}, arg, "show").status, 2, "位置引数は受け付けない");
  assert.equal(cliEnv({ PJ_LENS_HOME: env }, "show").status, 0, "環境変数だけでも動く");
});

// ---- 任意の項目（selfEmails・roomKeywords） ----
test("validateMcpConfig: 任意の項目 selfEmails・roomKeywords は、あれば、空でない文字列の配列", () => {
  const base = { server: "s", listTool: "l" };
  assert.deepEqual(validateMcpConfig({ calendar: { ...base, selfEmails: ["a@x.com"], roomKeywords: ["会議室", "Room"] } }), []);
  assert.deepEqual(validateMcpConfig({ calendar: base }), []);
  assert.ok(validateMcpConfig({ calendar: { ...base, selfEmails: "a@x.com" } }).length > 0);
  assert.ok(validateMcpConfig({ calendar: { ...base, selfEmails: ["a@x.com", " "] } }).length > 0);
  assert.ok(validateMcpConfig({ calendar: { ...base, roomKeywords: [1] } }).length > 0);
});

test("selfNames: 任意の項目として、空でない文字列の配列を検証し、カンマ区切りで保存し、既存の項目を保つ", () => {
  const base = { server: "s", listTool: "l" };
  assert.deepEqual(validateMcpConfig({ calendar: { ...base, selfNames: ["山田 太郎"] } }), []);
  assert.ok(validateMcpConfig({ calendar: { ...base, selfNames: "山田 太郎" } }).length > 0);
  assert.ok(validateMcpConfig({ calendar: { ...base, selfNames: ["山田 太郎", " "] } }).length > 0);
  const d = dir();
  setMcpRole(d, "calendar", { server: "s", listTool: "l", selfEmails: "me@x.com" });
  const a = setMcpRole(d, "calendar", { selfNames: " 山田 太郎, Taro Yamada ,," });
  assert.deepEqual(a.calendar, { server: "s", listTool: "l", selfEmails: ["me@x.com"], selfNames: ["山田 太郎", "Taro Yamada"] });
  const b = setMcpRole(d, "calendar", { selfNames: "" });
  assert.deepEqual(b.calendar, { server: "s", listTool: "l", selfEmails: ["me@x.com"] });
});

test("setMcpRole: 任意の項目はカンマ区切りで保存し、既存の値に合成する（必須の 2 項目を毎回指定しなくてよい）。空にすると消える", () => {
  const d = dir();
  setMcpRole(d, "calendar", { server: "s", listTool: "l" });
  const a = setMcpRole(d, "calendar", { selfEmails: " me@x.com, Me2@x.com ,," });
  assert.deepEqual(a.calendar, { server: "s", listTool: "l", selfEmails: ["me@x.com", "Me2@x.com"] });
  const b = setMcpRole(d, "calendar", { roomKeywords: "会議室,Room" });
  assert.deepEqual(b.calendar, { server: "s", listTool: "l", selfEmails: ["me@x.com", "Me2@x.com"], roomKeywords: ["会議室", "Room"] });
  const c = setMcpRole(d, "calendar", { server: "s2", roomKeywords: "" });
  assert.deepEqual(c.calendar, { server: "s2", listTool: "l", selfEmails: ["me@x.com", "Me2@x.com"] });
  assert.deepEqual(readMcpConfig(d).calendar, c.calendar);
});

test("setMcpRole: 不明な項目（打ち間違い）は例外で、何も書かない。必須の項目が無ければ、任意の項目だけでは作れない", () => {
  const d = dir();
  assert.throws(() => setMcpRole(d, "calendar", { server: "s", listTool: "l", selfEmail: "a@x.com" }), /selfEmail/);
  assert.ok(!existsSync(join(d, "project-board-mcp.json")));
  assert.throws(() => setMcpRole(d, "calendar", { selfEmails: "a@x.com" }), /server/);
  assert.ok(!existsSync(join(d, "project-board-mcp.json")));
});

test("mcpconf CLI: set calendar selfEmails=… で任意の項目だけ足せる。show に出る。schema_version は 1 のまま", () => {
  const d = dir();
  assert.equal(cli(d, "set", ...CAL).status, 0);
  const r = cli(d, "set", "calendar", "selfEmails=me@x.com,me2@x.com", "roomKeywords=会議室");
  assert.equal(r.status, 0, r.err);
  const s = cli(d, "show");
  assert.deepEqual(s.out.config.calendar.selfEmails, ["me@x.com", "me2@x.com"]);
  assert.deepEqual(s.out.config.calendar.roomKeywords, ["会議室"]);
  assert.equal(s.out.config.schema_version, 1);
  assert.equal(cli(d, "set", "calendar", "selfEmail=a@x.com").status, 1);
});

test("setMcpRole: 一時ファイルを残さない", () => {
  const d = dir();
  setMcpRole(d, "calendar", { server: "s", listTool: "l" });
  assert.deepEqual(readdirSync(d), ["project-board-mcp.json"]);
});
