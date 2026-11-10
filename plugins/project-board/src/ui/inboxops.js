// 受信箱の依頼の「変更の操作（ops）」の計画と適用。HTML と CLI（tools/inbox.js）が共有する。受ける操作は addTask と moveDue だけ（PROPOSE_OPS）。
// 計画（planOps）は、操作を作業用のコピーに当てて、変更案の表・警告を作る。データは変えない。
// 適用（applyProposal）は、いまのデータで同じ手順をもう一度計算して、提案の表と同じときだけ、変更履歴を足して返す。
// 当てる順: addTask（前のタスクは足し終えてから結ぶ）→ moveDue（書かれた順）。次のタスクの動きは computeImpact の規則に合わせる。
import { diffDays, dueAfter } from "../core/dates.js";
import { calendarOf } from "../core/holidays.js";
import { computeImpact } from "../core/impact.js";
import { CAUSES, PROPOSE_OPS, isClosed, validate } from "../core/schema.js";
import { addTask, newChecklist, updateTask } from "./edit.js";

const max = (a, b) => (a > b ? a : b);

/** 依頼で受ける操作（PROPOSE_OPS）だけを通す。保存済みの提案に残る古い操作も、ここで止める */
function checkOps(ops) {
  if (!Array.isArray(ops) || !ops.length) throw new Error("操作がありません");
  for (const o of ops) if (!PROPOSE_OPS.includes(o?.op)) throw new Error(`この操作は依頼では受けられません: ${o?.op}（画面で行ってください）`);
}

function simulate(data, ops, today) {
  checkOps(ops);

  const before = new Map(data.tasks.map((t) => [t.id, t]));
  let w = data;
  const T = (id) => w.tasks.find((t) => t.id === id);
  const need = (id) => { const t = T(id); if (!t) throw new Error(`タスク ${id} がありません`); return t; };

  const refs = new Map();       // ref → 追加したタスクの ID
  const touched = new Set();    // 操作が触る既存のタスク
  const changed = new Set();    // 期限が動いたタスク（動いた順）
  const reasons = new Map();    // タスク ID → 期限が動いた理由
  const warnings = [];
  const moves = [];
  const inboxIds = new Set();   // source: inbox の記録に載せるタスク
  let addCount = 0;

  const setDue = (id, due, reason) => {
    const start = w.tasks.find((x) => x.id === id)?.start;
    const patch = { due };
    // 画面で指定した開始日より前へ期限が動くなら、開始日を外す（外すと、前のタスクから決まる開始日に戻る）。そのままだと保存の検査で失敗する
    if (start && start > due) { patch.start = null; warnings.push(`${id} は期限が開始日 ${start} より前になるので、開始日を外します（前のタスクがあれば、前のタスクから決まります）`); }
    w = updateTask(w, id, patch, today);
    changed.add(id);
    reasons.set(id, reason);
  };
  /** id の期限を minDue 以上にする。動いたら、次のタスクも前のタスクの新しい期限を超えないように連鎖させる */
  const raise = (id, minDue, reason, group) => {
    const t = need(id);
    if (isClosed(t) || t.due >= minDue) return;
    setDue(id, minDue, reason);
    group.add(id);
    for (const s of w.tasks.filter((x) => (x.predecessors ?? []).includes(id))) raise(s.id, minDue, `前のタスク ${id} の遅れ`, group);
  };
  const resolve = (token) => refs.get(token) ?? token;

  // ① addTask（まず全部足し、前のタスクは、足し終えてから結ぶ。ref で別の addTask を指せるように）
  // businessDays 指定の期限は、前のタスク（既存のタスク、または別の addTask の ref）が決まってから計算する。ops の書く順には依存しない
  const adds = ops.filter((o) => o.op === "addTask");
  const dueOf = new Map(); // ref → 計算した期限（businessDays 指定のもの）
  const pending = adds.filter((o) => o.businessDays !== undefined);
  for (const o of adds) {
    const ref = String(o.ref ?? "").trim();
    if (!ref) throw new Error("addTask には ref が必要です");
    if (o.days !== undefined) throw new Error(`addTask（${ref}）には days は使えません。営業日は businessDays で指定してください`);
    const hasDue = o.due !== undefined, hasDays = o.businessDays !== undefined;
    if (hasDue === hasDays) throw new Error(`addTask（${ref}）には due か businessDays のどちらか一方が必要です`);
  }
  // 期限を動かす操作と同じ依頼に営業日指定の登録があると、前のタスクの期限が動いて営業日が吸収される。2 回に分けてもらう（addTask 自体の誤りを先に知らせる）
  if (ops.some((o) => o.op === "moveDue") && pending.length) {
    throw new Error("期限の移動（moveDue）と営業日指定の登録（businessDays）は、同じ依頼にできません。先に期限の移動を承認してから、登録を依頼してください");
  }
  const refDue = new Map(adds.filter((o) => o.due !== undefined).map((o) => [String(o.ref).trim(), o.due]));
  while (pending.length) {
    const ready = pending.filter((o) => (o.predecessors ?? []).every((p) => !adds.some((x) => String(x.ref).trim() === p) || refDue.has(p)));
    if (!ready.length) throw new Error("addTask の前のタスクが循環しています");
    for (const o of ready) {
      const open = (o.predecessors ?? []).map((p) => (refDue.has(p) ? { due: refDue.get(p), status: "To Do" } : need(p))).filter((t) => !isClosed(t));
      const base = open.map((t) => t.due).reduce(max, "") || today;
      const ref = String(o.ref).trim();
      dueOf.set(ref, dueAfter(base, o.businessDays, calendarOf(w.settings)));
      refDue.set(ref, dueOf.get(ref));
      pending.splice(pending.indexOf(o), 1);
    }
  }
  const planned = new Map(); // ref → businessDays を due に固定した op
  for (const o of adds) {
    const ref = String(o.ref ?? "").trim();
    if (refs.has(ref)) throw new Error(`ref "${ref}" が重複しています`);
    const due = o.due ?? dueOf.get(ref);
    planned.set(o, o.businessDays === undefined ? o : (({ businessDays, ...rest }) => ({ ...rest, due }))(o));
    // 開始日: 書かれていればそのとおり。前のタスクがあるタスクは入れない（前のタスクから決まる開始日にする）。なければ今日（期限が過去なら入れない）
    const start = o.start ?? ((o.predecessors ?? []).length || due < today ? null : today);
    if (o.checklist !== undefined && (!Array.isArray(o.checklist) || o.checklist.some((x) => typeof x !== "string"))) throw new Error(`addTask（${ref}）の checklist は文字列の配列にしてください`);
    const items = o.checklist?.length ? newChecklist(o.checklist) : [];
    w = addTask(w, { projectId: o.projectId, title: o.title, due, start, group: o.group ?? null, subgroup: o.subgroup ?? null, ...(items.length ? { checklist: items } : {}) });
    const id = w.tasks.at(-1).id;
    refs.set(ref, id);
    inboxIds.add(id);
    addCount++;
  }
  for (const o of adds) {
    const id = refs.get(String(o.ref).trim());
    const preds = (o.predecessors ?? []).map(resolve);
    if (!preds.length) continue;
    for (const p of preds) {
      const pt = need(p);
      if (pt.projectId !== T(id).projectId) throw new Error(`前のタスク ${p} は別のプロジェクトのタスクです`);
      if (before.has(p)) touched.add(p);
    }
    w = updateTask(w, id, { predecessors: preds }, today);
    const lower = preds.map((p) => T(p)).filter((p) => !isClosed(p)).map((p) => p.due).reduce(max, "");
    if (lower > T(id).due) {
      warnings.push(`登録するタスク ${id}（${T(id).title}）の期限は、前のタスクより前なので ${lower} に合わせました`);
      raise(id, lower, "前のタスクの期限に合わせた", inboxIds);
    }
  }

  // ② moveDue（日数は、その時点の期限から数える）
  for (const o of ops.filter((x) => x.op === "moveDue")) {
    const id = resolve(o.taskId);
    const t = need(id);
    if (isClosed(t)) throw new Error(`タスク ${id} は完了しているので、期限を動かせません`);
    let delta;
    if (Number.isInteger(o.deltaDays)) delta = o.deltaDays;
    else if (typeof o.newDue === "string") delta = diffDays(o.newDue, t.due);
    else throw new Error(`moveDue（${id}）には deltaDays か newDue が必要です`);
    if (!delta) throw new Error(`moveDue（${id}）の動かす日数が 0 日です`);
    const impact = computeImpact(w, id, delta, { compress: !!o.compress });
    const ids = [];
    for (const c of impact.changes) { setDue(c.taskId, c.newDue, c.reason); ids.push(c.taskId); }
    // この計画が触った（動かした・前のタスクに足した）前のタスクの期限より前には、手動の前倒しでもしない（遅い方を採る）
    const lower = (T(id).predecessors ?? []).filter((p) => changed.has(p) || touched.has(p)).map((p) => T(p)).filter((p) => !isClosed(p)).map((p) => ({ id: p.id, due: p.due }));
    const need2 = lower.reduce((a, b) => (b.due > a.due ? b : a), { id: null, due: "" });
    if (need2.id && need2.due > T(id).due) {
      warnings.push(`${id} は、前のタスク ${need2.id} の新しい期限より前にできないので、${need2.due} にしました`);
      raise(id, need2.due, `前のタスク ${need2.id} の期限より前にできない`, new Set(ids));
    }
    moves.push({ deltaDays: delta, taskIds: ids });
    for (const x of ids) if (before.has(x)) touched.add(x);
  }

  const { errors } = validate(w);
  if (errors.length) throw new Error(errors.join(" / "));

  const dueRows = [...changed].filter((id) => before.has(id) && T(id) && before.get(id).due !== T(id).due)
    .map((id) => ({ taskId: id, title: T(id).title, oldDue: before.get(id).due, newDue: T(id).due, reason: reasons.get(id) }));
  // プロジェクト期限の超過（動いたタスクがあるプロジェクトだけ）
  for (const p of w.projects ?? []) {
    const movedHere = dueRows.some((r) => T(r.taskId).projectId === p.id && r.newDue > p.due);
    if (!movedHere) continue;
    const latest = w.tasks.filter((t) => t.projectId === p.id).map((t) => t.due).reduce(max, "");
    warnings.push(`${p.name}の期限（${p.due}）を超えます（最後のタスクは ${latest}）`);
  }

  // 前のタスクが、そのまた前のタスクに合わせて引き上げられると、businessDays の期限も引き上げられ、営業日が吸収される。表の営業日と食い違うので知らせる
  for (const o of adds.filter((x) => x.businessDays !== undefined)) {
    const ref = String(o.ref).trim();
    if (T(refs.get(ref)).due !== dueOf.get(ref)) warnings.push(`登録するタスク ${ref}（${o.title}）の営業日 ${o.businessDays} は、前のタスクの期限が引き上げられたため反映されていません（期限は ${T(refs.get(ref)).due}）`);
  }
  const addRows = adds.map((o) => { const t = T(refs.get(String(o.ref).trim())); return { ref: String(o.ref).trim(), title: t.title, projectId: t.projectId, group: t.group ?? null, subgroup: t.subgroup ?? null, due: t.due, businessDays: o.businessDays ?? null, start: t.start ?? null, predecessors: o.predecessors ?? [], checklist: (t.checklist ?? []).map((c) => c.text) }; });
  const sections = [];
  if (addRows.length) sections.push({ kind: "add", rows: addRows });
  if (dueRows.length) sections.push({ kind: "due", rows: dueRows });
  return { data: w, ops: ops.map((o) => planned.get(o) ?? o), sections, warnings, moves, inboxIds: [...inboxIds], addCount };
}

/** 変更案の表の同一性（提案と、いまのデータでの計算結果の比較用）。登録する開始日の既定（日付で変わる）と、理由の文は含めない */
const sectionsKey = (sections) => JSON.stringify(sections.map((s) => [s.kind, s.rows.map((r) =>
  s.kind === "due" ? [r.taskId, r.oldDue, r.newDue] : [r.ref, r.title, r.projectId, r.group, r.subgroup, r.due, r.predecessors, r.checklist])]));

const count = (sections, kind) => sections.find((s) => s.kind === kind)?.rows.length ?? 0;

/** 変更案（sections）の要約。例: 「登録 2 件・期限の変更 3 件」 */
export function summarizeSections(sections) {
  return `登録 ${count(sections, "add")} 件・期限の変更 ${count(sections, "due")} 件`;
}

/** 操作の計画（データは変えない）。例外: 不明なタスク・プロジェクト、循環、別のプロジェクトの前のタスク、完了済みの moveDue、依頼で受けない op、など */
export function planOps(data, ops, { today }) {
  const s = simulate(data, ops, today);
  return { ops: s.ops, sections: s.sections, warnings: s.warnings };
}

/** 提案を適用する。いまのデータで操作をもう一度計算して、提案の表と違う（または計算できない）ときは、code: "stale" の例外（データは変えない） */
export function applyProposal(data, proposal, { reason, cause, today }) {
  const why = String(reason ?? "").trim();
  if (!why) throw new Error("理由を入力してください");
  if (!CAUSES.includes(cause)) throw new Error(`原因は ${CAUSES.join("・")} のいずれかにしてください`);
  // 保存済みの提案に、依頼で受けなくなった操作が残っていたら、提案後にデータが変わったときと同じく、失敗にする（code: "stale"）
  try { checkOps(proposal.ops); } catch (e) { throw Object.assign(e, { code: "stale" }); }
  const stale = (message = "提案のあとにデータが変わりました。もう一度提案してもらってください") => Object.assign(new Error(message), { code: "stale" });

  let s;
  try { s = simulate(data, proposal.ops, today); } catch { throw stale(); }
  if (sectionsKey(s.sections) !== sectionsKey(proposal.sections ?? [])) throw stale();
  const log = [...(s.data.changeLog ?? [])];
  for (const m of s.moves) log.push({ at: today, taskIds: m.taskIds, reason: why, cause, deltaDays: m.deltaDays });
  if (s.addCount) {
    log.push({ at: today, taskIds: [...s.inboxIds], reason: `受信箱: ${summarizeSections(s.sections)}`, cause: null, deltaDays: 0, source: "inbox" });
  }
  const out = { ...s.data, changeLog: log };
  const { errors } = validate(out);
  if (errors.length) throw new Error(errors.join(" / "));
  return out;
}
