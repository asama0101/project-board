// 予定表の「どの MCP のどのツールを使うか」の指定。利用者の環境の事情なので、プロジェクトの data.json には入れず、
// プラグイン専用フォルダ（${CLAUDE_PLUGIN_DATA}）の project-board-mcp.json に保存する。保存先のフォルダは引数で受け取る。
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { today } from "../core/dates.js";

const FILE = "project-board-mcp.json";
/** 保存形式の版。形式を変える版では上げ、移行手順を開発者向けの文書（非公開）に書く */
export const SCHEMA_VERSION = 1;

/** 役割ごとの必須項目: 予定表は期間の取得 */
export const ROLES = { calendar: ["server", "listTool"] };
/** 役割ごとの任意項目（空でない文字列の配列）: 予定表は、自分のメールアドレスと名前、会議室の名前のキーワード（取り込みで、自分だけ・自分と会議室だけの予定を除く） */
export const OPTIONAL = { calendar: ["selfEmails", "selfNames", "roomKeywords"] };

/** 指定の誤り（空なら正常）。役割は calendar のみ、各役割の必須項目は非空の文字列 */
export function validateMcpConfig(cfg) {
  const errors = [];
  for (const [role, v] of Object.entries(cfg)) {
    if (role === "savedAt" || role === "schema_version") continue;
    if (!ROLES[role]) { errors.push(`不明な役割です: ${role}（calendar のみ）`); continue; }
    for (const k of ROLES[role]) if (typeof v?.[k] !== "string" || !v[k].trim()) errors.push(`${role}.${k} が必要です`);
    for (const k of OPTIONAL[role]) {
      if (v?.[k] !== undefined && !(Array.isArray(v[k]) && v[k].every((x) => typeof x === "string" && x.trim()))) errors.push(`${role}.${k} は、空でない文字列の配列にしてください`);
    }
  }
  return errors;
}

/** 保存済みの指定。ファイルが無ければ {}。schema_version が無いファイルは、古い形式なのでエラー */
export function readMcpConfig(dir) {
  const p = join(dir, FILE);
  if (!existsSync(p)) return {};
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  if (cfg.schema_version === undefined) throw new Error(`project-board-mcp.json に schema_version がありません（古い形式です）。project-board-mcp.json（${p}）を削除してから、/project-board:mcp で指定し直してください`);
  if (cfg.schema_version !== SCHEMA_VERSION) {
    throw new Error(`project-board-mcp.json の schema_version ${cfg.schema_version} には対応していません（対応: ${SCHEMA_VERSION}）。docs/development.md の移行手順を見てください`);
  }
  return cfg;
}

function write(dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const out = { schema_version: SCHEMA_VERSION, ...cfg }; // 書くときは必ず現在の版を付ける（読んだ設定の版は、無いか現在の版）
  const tmp = join(dir, `${FILE}.${process.pid}.tmp`); // 書き込みの途中で止まっても、元のファイルが壊れないよう、一時ファイルに書いてから置き換える
  try {
    writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
    renameSync(tmp, join(dir, FILE));
  } finally {
    rmSync(tmp, { force: true });
  }
  return out;
}

/**
 * 役割の指定を保存する（他の役割は保つ）。values に無い項目は、保存済みの値を保つ（任意の項目だけを足せる）。
 * 任意の項目は、カンマ区切りの文字列で渡し、空にすると消える。不明な項目（打ち間違い）・検証に通らない指定は例外で、何も書かない
 */
export function setMcpRole(dir, role, values) {
  const known = [...ROLES[role], ...OPTIONAL[role]];
  const unknown = Object.keys(values).filter((k) => !known.includes(k));
  if (unknown.length) throw new Error(`不明な項目です: ${unknown.join("・")}（${known.join("・")}）`);
  const entry = { ...readMcpConfig(dir)[role] };
  for (const k of ROLES[role]) entry[k] = String(values[k] ?? entry[k] ?? "").trim();
  for (const k of OPTIONAL[role]) {
    if (!(k in values)) continue;
    const list = values[k].split(",").map((x) => x.trim()).filter(Boolean);
    if (list.length) entry[k] = list; else delete entry[k];
  }
  const errors = validateMcpConfig({ [role]: entry });
  if (errors.length) throw new Error(errors.join(" / "));
  return write(dir, { ...readMcpConfig(dir), [role]: entry, savedAt: today() });
}

/** 役割の指定を消す */
export function clearMcpRole(dir, role) {
  const { [role]: removed, ...rest } = readMcpConfig(dir);
  void removed;
  return write(dir, rest);
}
