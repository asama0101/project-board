// WBS（Excel など）の取り込み。エージェントが読み取って正規化した行（WbsRow）を、プロジェクトのタスクと照合する。
// plan は data を変えない。apply の結果の検証は、書き込む側（tools/cli.js の save）が行う（Node 専用。ブラウザには入れない）。
import { isDate } from "../core/dates.js";
import { TASK_STATUS } from "../core/schema.js";
import { addTask, updateTask } from "../ui/edit.js";

const s = (v) => String(v ?? "").trim();
const nz = (v) => (s(v) === "" ? null : s(v));
const FIELDS = ["due", "start", "group", "subgroup", "status", "importance", "memo"];

const esc = (p) => s(p).replace(/\\/g, "\\\\").replace(/\//g, "\\/");

/**
 * WBS 上の項目名を `/` で連結した、照合用のキー（大項目/中項目/件名）。前後の空白（全角を含む）は除き、名前に含まれる `/` は
 * エスケープする。空の段は位置を残す（`構築//機器設定`）ので、空の段の位置が違う行は別のキーになる。件名だけの行は件名のまま
 */
export function wbsKey(row) {
  const [g, sg, t] = [row.group, row.subgroup, row.title].map(esc);
  if (!g && !sg) return t;
  return `${g}/${sg}/${t}`;
}

/** 空の段を詰めた形（`構築/機器設定`）。前のタスクキーの書き方の揺れを許すための比較用 */
const squeeze = (k) => k.split("/").filter(Boolean).join("/");

function rowProblem(r) {
  if (!s(r.title)) return "件名がありません";
  if (s(r.due) && !isDate(s(r.due))) return "期限の形式が不正です（YYYY-MM-DD）";
  if (s(r.start) && !isDate(s(r.start))) return "開始日の形式が不正です（YYYY-MM-DD）";
  if (s(r.status)) {
    if (!TASK_STATUS.includes(r.status)) return `不明な状態です: ${r.status}`;
    if (r.status === "Waiting") return "Waiting は待ち先が必要なため、WBS からは設定できません";
  }
  if (s(r.importance) && r.importance !== "high") return `不明な重要度です: ${r.importance}`;
  return null;
}

const value = (f, v) => (f === "memo" ? s(v) : nz(v));
/** 行に値が指定されているか。null・未指定は「指定なし」。期限と状態の空欄は、消せない項目なので「指定なし」 */
const given = (r, f) => r[f] !== undefined && r[f] !== null && !((f === "due" || f === "status") && s(r[f]) === "");

/** 行と既存タスクの照合。追加・更新・変更なし・WBS に無い既存・弾いた行・警告を返す。data は変えない */
export function planWbsImport(data, projectId, rows) {
  const tasks = data.tasks.filter((t) => t.projectId === projectId);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const existing = new Map(tasks.filter((t) => t.wbsKey).map((t) => [t.wbsKey, t]));
  // wbsKey の無い手入力のタスクは、同じ件名のものが1つだけのときに限り、その件名の行と照合する（取り込みで wbsKey を付ける）
  const titleCount = new Map();
  for (const t of tasks.filter((x) => !x.wbsKey)) titleCount.set(s(t.title), (titleCount.get(s(t.title)) ?? 0) + 1);
  const legacy = new Map(tasks.filter((t) => !t.wbsKey && titleCount.get(s(t.title)) === 1).map((t) => [s(t.title), t]));
  const usedLegacy = new Set();
  const plan = { add: [], update: [], same: [], missing: [], rejected: [], warnings: [] };

  const seen = new Set();
  const valid = [];
  rows.forEach((r, index) => {
    const key = wbsKey(r);
    let reason = rowProblem(r);
    if (!reason && seen.has(key)) reason = "WBS の項目名が重複しています";
    let adopt = null;
    if (!reason && !existing.has(key)) {
      const l = legacy.get(s(r.title));
      if (l && !usedLegacy.has(l.id)) adopt = l;
    }
    if (!reason && !existing.has(key) && !adopt && !s(r.due)) reason = "期限がありません（新しい項目には期限が必要です）";
    if (reason) { plan.rejected.push({ index, key, reason }); return; }
    if (adopt) usedLegacy.add(adopt.id);
    seen.add(key);
    valid.push({ r, key, index, adopt });
  });

  /** 前のタスクキーを、既存・今回の行のキーへ解決する。空の段を詰めた書き方でも、曖昧でなければ解決する */
  const known = [...new Set([...existing.keys(), ...seen])];
  const resolve = (k) => {
    if (known.includes(k)) return k;
    const hit = known.filter((x) => squeeze(x) === squeeze(k));
    return hit.length === 1 ? hit[0] : null;
  };

  for (const { r, key, index, adopt } of valid) {
    let predKeys;
    if (r.predecessorKeys != null) {
      predKeys = [];
      for (const k of r.predecessorKeys.map(s).filter(Boolean)) {
        const hit = resolve(k);
        if (hit) predKeys.push(hit);
        else plan.warnings.push(`行 ${index + 1}「${key}」: 前のタスク "${k}" が見つかりません`);
      }
    }
    const row = { title: s(r.title) };
    for (const f of FIELDS) if (given(r, f)) row[f] = value(f, r[f]);
    if (predKeys) row.predecessorKeys = predKeys;

    const cur = existing.get(key) ?? adopt;
    const due = row.due ?? cur?.due ?? null, start = row.start !== undefined ? row.start : (cur?.start ?? null);
    if (start && due && start > due) { plan.rejected.push({ index, key, reason: "開始日が期限より後です" }); continue; }
    if (!cur) { plan.add.push({ key, row }); continue; }
    const before = {}, after = {};
    if (adopt) { before.wbsKey = null; after.wbsKey = key; }
    for (const f of FIELDS) {
      if (row[f] === undefined) continue;
      if ((row[f] ?? "") !== (f === "memo" ? s(cur[f]) : (cur[f] ?? ""))) { before[f] = cur[f] ?? null; after[f] = row[f]; }
    }
    if (predKeys) {
      const now = (cur.predecessors ?? []).map((id) => byId.get(id)?.wbsKey ?? id).sort();
      const want = [...predKeys].sort();
      if (now.join("\n") !== want.join("\n")) { before.predecessorKeys = now; after.predecessorKeys = predKeys; }
    }
    if (Object.keys(after).length) plan.update.push({ taskId: cur.id, key, before, after });
    else plan.same.push(cur.id);
  }
  plan.missing = tasks.filter((t) => t.wbsKey && !seen.has(t.wbsKey)).map((t) => t.id);
  return plan;
}

/**
 * plan を適用したデータを返す。変更が無ければ data をそのまま返す。検証は、書き込む save が行う。
 * source: 取り込んだファイル名（パスなし。分からなければ省略）。追加か更新があったときだけ、プロジェクトごとの取り込み記録（最後の 1 件）を settings.wbsImports に書く
 */
export function applyWbsImport(data, projectId, plan, { today, source = null }) {
  if (!plan.add.length && !plan.update.length) return data;
  let d = data;
  const idByKey = new Map(d.tasks.filter((t) => t.projectId === projectId && t.wbsKey).map((t) => [t.wbsKey, t.id]));
  for (const u of plan.update) idByKey.set(u.key, u.taskId); // wbsKey を付けて取り込む手入力のタスクも、前のタスクとして解決できるように
  const added = [];
  for (const a of plan.add) {
    const had = new Set(d.tasks.map((t) => t.id));
    const r = a.row;
    d = addTask(d, { projectId, title: r.title, due: r.due, start: r.start ?? null, importance: r.importance ?? null, memo: r.memo ?? "", group: r.group ?? null, subgroup: r.subgroup ?? null, wbsKey: a.key });
    const id = d.tasks.find((t) => !had.has(t.id)).id;
    if (r.status && r.status !== "To Do") d = updateTask(d, id, { status: r.status }, today);
    idByKey.set(a.key, id);
    added.push(id);
  }
  for (const u of plan.update) {
    const patch = {};
    for (const f of ["due", "start", "status", "importance", "memo"]) if (f in u.after) patch[f] = u.after[f];
    if (Object.keys(patch).length) d = updateTask(d, u.taskId, patch, today);
    const g = {};
    for (const f of ["group", "subgroup", "wbsKey"]) if (f in u.after) g[f] = u.after[f];
    if (Object.keys(g).length) d = { ...d, tasks: d.tasks.map((t) => (t.id === u.taskId ? { ...t, ...g } : t)) };
  }
  const setPreds = (id, keys) => { d = updateTask(d, id, { predecessors: keys.map((k) => idByKey.get(k)).filter(Boolean) }, today); };
  for (const a of plan.add) if (a.row.predecessorKeys?.length) setPreds(idByKey.get(a.key), a.row.predecessorKeys);
  for (const u of plan.update) if (u.after.predecessorKeys) setPreds(u.taskId, u.after.predecessorKeys);

  d = {
    ...d,
    changeLog: [...d.changeLog, {
      at: today, taskIds: [...added, ...plan.update.map((u) => u.taskId)],
      reason: `WBS 取り込み: 追加 ${added.length} 件・更新 ${plan.update.length} 件`, cause: null, deltaDays: 0, source: "wbs",
    }],
  };
  return { ...d, settings: { ...d.settings, wbsImports: { ...(d.settings?.wbsImports ?? {}), [projectId]: { file: source || null, at: today, added: added.length, updated: plan.update.length } } } };
}

/** 保存済みの WBS の列の対応（無ければ null） */
export function getWbsMapping(data, projectId) {
  return data.settings?.wbsMappings?.[projectId] ?? null;
}

/** 列の対応（field → Excel の列見出し）をプロジェクトごとに保存する。件名の列は必須 */
export function setWbsMapping(data, projectId, mapping) {
  if (!data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  if (!s(mapping?.title)) throw new Error("件名の列が必要です");
  const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => s(v)).map(([k, v]) => [k, s(v)]));
  return { ...data, settings: { ...data.settings, wbsMappings: { ...(data.settings?.wbsMappings ?? {}), [projectId]: clean } } };
}
