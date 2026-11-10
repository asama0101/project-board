// data.json の検証。errors は保存してはいけない不整合、warnings は保存を止めない注意。
import { isDate, isTime, toMin, nowLocal } from "./dates.js";

export const TASK_STATUS = ["To Do", "In Progress", "Waiting", "Done", "Cancelled"];
export const PROJECT_STATUS = ["計画中", "進行中", "保留", "完了", "中止"];
export const PROJECT_TYPE = ["増設", "更改", "改善", "不具合対処", "その他"];
export const IMPORTANCE = ["high"];
export const CAUSES = ["ベンダー", "社内", "自分", "その他"];
export const HOLIDAY_KINDS = ["祝日", "有給", "その他"];
const REQUEST_STATUS = ["pending", "working", "question", "proposed", "applied", "rejected", "failed"];
export const OP_KINDS = ["moveDue", "addPred", "removePred", "addTask", "addProject", "setStatus", "setImportance", "updateProject", "removeTask", "removeProject", "addMilestone", "moveMilestone", "removeMilestone", "addChecklistItem", "setChecklistDone", "setChecklistText", "removeChecklistItem"];
/** 新しい依頼（提案・承認）で受ける操作。OP_KINDS は、保存済みの proposal.ops の検証用に残す */
export const PROPOSE_OPS = ["addTask", "moveDue"];
export const DEFAULT_WORKDAY = { start: "09:00", end: "18:00" };

/** 終わったタスク（Done・Cancelled）か */
export const isClosed = (t) => t.status === "Done" || t.status === "Cancelled";

/** 同じ日の枠が重なるか（端が接するだけは重ならない） */
const overlap = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/** 前のタスクの循環を DFS で探す。循環に含まれるタスク ID の一覧を返す */
function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map(); // 1=探索中, 2=完了
  const stack = [];
  let found = null;
  const dfs = (id) => {
    if (found) return;
    state.set(id, 1);
    stack.push(id);
    for (const p of byId.get(id)?.predecessors ?? []) {
      if (!byId.has(p)) continue;
      if (state.get(p) === 1) { found = [...stack.slice(stack.indexOf(p)), p]; return; }
      if (!state.has(p)) dfs(p);
      if (found) return;
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.has(t.id)) dfs(t.id);
  return found;
}

/**
 * @param {object} data
 * @param {{date:string,time:string}} [now] 「未来の予定枠」の判定に使う現在時刻
 */
export function validate(data, now = nowLocal()) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!data || typeof data !== "object") return { errors: ["データがオブジェクトではありません"], warnings };
  for (const k of ["projects", "tasks", "events", "changeLog"]) {
    if (!Array.isArray(data[k])) err(`${k} が配列ではありません`);
  }
  if (errors.length) return { errors, warnings };

  const dup = (list, label) => {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) err(`${label} の ID が重複しています: ${x.id}`);
      seen.add(x.id);
    }
  };
  dup(data.projects, "プロジェクト");
  dup(data.tasks, "タスク");
  dup(data.events, "会議");
  // 作業枠の ID は、移動・削除が ID だけで探すので、重複すると両方に効く。保存は止めず、注意に出す
  const sessionIds = new Set();
  for (const t of data.tasks) for (const s of t.sessions ?? []) {
    if (sessionIds.has(s.id)) warn(`作業枠の ID が重複しています: ${s.id}（移動・削除が両方に効きます。data.json から直接直してください）`);
    sessionIds.add(s.id);
  }

  const projectIds = new Set(data.projects.map((p) => p.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));

  for (const p of data.projects) {
    if (!PROJECT_STATUS.includes(p.status)) err(`プロジェクト ${p.id}: 不明な状態 "${p.status}"`);
    if (!isDate(p.start)) err(`プロジェクト ${p.id}: 開始日の形式が不正です (${p.start})`);
    if (!isDate(p.due)) err(`プロジェクト ${p.id}: 期限の形式が不正です (${p.due})`);
    if (isDate(p.start) && isDate(p.due) && p.start > p.due) err(`プロジェクト ${p.id}: 開始日が期限より後です`);
    for (const m of p.milestones ?? []) {
      if (!isDate(m.date)) err(`プロジェクト ${p.id}: マイルストーン "${m.name}" の日付が不正です`);
    }
  }

  for (const t of data.tasks) {
    if (!TASK_STATUS.includes(t.status)) err(`タスク ${t.id}: 不明な状態 "${t.status}"`);
    if (!projectIds.has(t.projectId)) err(`タスク ${t.id}: 不明な projectId "${t.projectId}"`);
    if (!isDate(t.due)) err(`タスク ${t.id}: 期限の形式が不正です (${t.due})`);
    if (t.start != null && !isDate(t.start)) err(`タスク ${t.id}: 開始日の形式が不正です (${t.start})`);
    if (t.doneAt != null && !isDate(t.doneAt)) err(`タスク ${t.id}: 完了日の形式が不正です (${t.doneAt})`);
    if (t.importance != null && !IMPORTANCE.includes(t.importance)) err(`タスク ${t.id}: 重要度 "${t.importance}" は使えません。重要度は高（high）かなしにしてください。data.json の importance を直してください`);
    if (t.checklist !== undefined) {
      if (!Array.isArray(t.checklist)) err(`タスク ${t.id}: チェックリスト (checklist) が配列ではありません`);
      else {
        const seen = new Set();
        for (const c of t.checklist) {
          if (typeof c?.id !== "string" || !c.id) err(`タスク ${t.id}: チェックリストの項目の ID が文字列ではありません`);
          else if (seen.has(c.id)) err(`タスク ${t.id}: チェックリストの項目の ID が重複しています: ${c.id}`);
          else seen.add(c.id);
          if (typeof c?.text !== "string" || !c.text.trim()) err(`タスク ${t.id}: チェックリストの項目 ${c?.id} の文言が空です`);
          if (typeof c?.done !== "boolean") err(`タスク ${t.id}: チェックリストの項目 ${c?.id} の done が真偽値ではありません`);
        }
      }
    }
    const preds = t.predecessors ?? [];
    for (const pid of preds) {
      if (!taskIds.has(pid)) err(`タスク ${t.id}: 存在しない前のタスク "${pid}"`);
      if (pid === t.id) err(`タスク ${t.id}: 自分自身を前のタスクにしています（循環）`);
    }
    const predDue = preds.map((id) => data.tasks.find((x) => x.id === id)?.due).filter(isDate);
    if (isDate(t.due) && predDue.length && predDue.reduce((a, b) => (a > b ? a : b)) > t.due) warn(`タスク ${t.id}: 前のタスクの期限が自分の期限より後です`);
    if (t.waitingOn && !isDate(t.waitingOn.since)) err(`タスク ${t.id}: 待ち開始日 (waitingOn.since) の形式が不正です`);
    if (t.status === "Waiting" && !t.waitingOn) warn(`タスク ${t.id}: Waiting なのに待ち先 (waitingOn) がありません`);
    if (isDate(t.start) && isDate(t.due) && t.start > t.due) warn(`タスク ${t.id}: 開始日が期限より後です`);

    for (const s of t.sessions ?? []) {
      const label = `タスク ${t.id} の枠 ${s.id}`;
      if (!isDate(s.date) || !isTime(s.start) || !isTime(s.end)) { err(`${label}: 日付または時刻の形式が不正です`); continue; }
      if (toMin(s.end) <= toMin(s.start)) err(`${label}: 終了が開始以前です`);
      if (!["planned", "actual"].includes(s.kind)) err(`${label}: 不明な kind "${s.kind}"`);
      const notStarted = s.date > now.date || (s.date === now.date && s.start > now.time); // 進行中の枠は、完了にしても残す（futurePlanned）
      if (isClosed(t) && s.kind === "planned" && notStarted) warn(`タスク ${t.id}: ${t.status} なのに未来の予定枠 ${s.id} が残っています`);
    }
  }

  const cycle = findCycle(data.tasks);
  if (cycle) err(`前のタスクが循環しています: ${cycle.join(" → ")}`);

  // 同じ日の枠どうしの重なり（タスクをまたいで判定）。日付で束ねて、同じ日の中だけ総当たりにする（全枠の総当たりは、数年分で秒単位になる）
  const byDay = new Map();
  for (const t of data.tasks) {
    for (const s of t.sessions ?? []) {
      if (!isDate(s.date) || !isTime(s.start) || !isTime(s.end)) continue;
      if (!byDay.has(s.date)) byDay.set(s.date, []);
      byDay.get(s.date).push(s);
    }
  }
  for (const [date, list] of byDay) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlap(list[i], list[j])) err(`枠 ${list[i].id} と ${list[j].id} が重なっています (${date})`);
      }
    }
  }

  for (const e of data.events) {
    if (!isDate(e.date) || !isTime(e.start) || !isTime(e.end)) err(`会議 ${e.id}: 日付または時刻の形式が不正です`);
    else if (toMin(e.end) <= toMin(e.start)) err(`会議 ${e.id}: 終了が開始以前です`);
    if (!["mcp", "manual"].includes(e.source)) err(`会議 ${e.id}: 不明な source "${e.source}"`);
    if (e.projectId != null && !projectIds.has(e.projectId)) err(`会議 ${e.id}: 不明な projectId "${e.projectId}"`);
    if (e.projectBy != null && !["rule", "manual"].includes(e.projectBy)) err(`会議 ${e.id}: 不明な projectBy "${e.projectBy}"`);
    if (e.confirmed != null && typeof e.confirmed !== "boolean") err(`会議 ${e.id}: confirmed が真偽値ではありません`);
  }

  const st = data.settings ?? {};
  // 形の違う設定は、注意にとどめる（読む側は、既定値で動く。workday だけは、HH:MM でないと画面が動かない）
  const w = st.workday;
  if (w != null && !(typeof w === "object" && isTime(w.start) && isTime(w.end) && toMin(w.start) < toMin(w.end))) {
    warn("settings.workday: start・end は HH:MM で、開始 < 終了にしてください。直すまでスケジュール画面は正しく動きません");
  }
  if (st.waitingLongDays != null && !(Number.isInteger(st.waitingLongDays) && st.waitingLongDays >= 1)) {
    warn("settings.waitingLongDays: 1 以上の整数にしてください（直すまで、遅延バッジと「今日の優先」の待ち長期化が正しく出ません）");
  }
  const lb = st.labels;
  if (lb != null && !(typeof lb === "object" && !Array.isArray(lb) && ["group", "subgroup"].every((k) => lb[k] === undefined || typeof lb[k] === "string"))) {
    warn("settings.labels: group・subgroup は文字列にしてください（既定の呼び名で動きます）");
  }
  if (st.countWeekendsAndHolidays != null && typeof st.countWeekendsAndHolidays !== "boolean") {
    warn("settings.countWeekendsAndHolidays: true か false にしてください（既定の false で動きます）");
  }
  const listOf = (v, ok) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && isDate(x.date) && ok(x));
  if (st.holidays != null && !listOf(st.holidays, (x) => HOLIDAY_KINDS.includes(x.kind))) {
    warn(`settings.holidays: { date, kind } の配列にしてください（kind は ${HOLIDAY_KINDS.join("・")}。文字列の配列など、形の違う要素は画面から消せないので、data.json から直接直してください）`);
  }
  if (st.workdays != null && !listOf(st.workdays, () => true)) {
    warn("settings.workdays: { date } の配列にしてください（形の違う要素は、data.json から直接直してください）");
  }
  const nh = st.nationalHolidays;
  if (nh != null && !(typeof nh === "object" && isDate(nh.fetchedAt) && listOf(nh.dates, () => true))) {
    warn("settings.nationalHolidays: { fetchedAt, dates: [{ date }] } にしてください（次に営業日を使う提案を作るか、見張りを始めると、自動で取り直されます）");
  }
  (st.projectRules ?? []).forEach((r, i) => {
    if (!String(r?.keyword ?? "").trim()) err(`settings.projectRules[${i}]: keyword が空です`);
    if (!projectIds.has(r?.projectId)) err(`settings.projectRules[${i}]: 不明な projectId "${r?.projectId}"`);
  });
  for (const [pid, m] of Object.entries(st.wbsMappings ?? {})) {
    if (!projectIds.has(pid)) err(`settings.wbsMappings: 不明なプロジェクト "${pid}"`);
    if (!m || typeof m !== "object" || Object.values(m).some((x) => typeof x !== "string")) err(`settings.wbsMappings.${pid}: 値は文字列のオブジェクトにしてください`);
  }

  for (const [pid, w] of Object.entries(st.wbsImports ?? {})) {
    if (!projectIds.has(pid)) err(`settings.wbsImports: 不明なプロジェクト "${pid}"`);
    const okCount = (n) => Number.isInteger(n) && n >= 0;
    if (!w || typeof w !== "object" || !(w.file === null || typeof w.file === "string") || !isDate(w.at) || !okCount(w.added) || !okCount(w.updated)) {
      err(`settings.wbsImports.${pid}: file（文字列か null）・at（日付）・added と updated（0 以上の整数）にしてください`);
    }
  }

  const ib = data.inbox;
  if (ib != null) {
    if (typeof ib !== "object" || Array.isArray(ib)) err("inbox: オブジェクトにしてください");
    else {
      if (ib.watching != null && !(typeof ib.watching === "object" && typeof ib.watching.at === "string" && ib.watching.at)) err("inbox.watching: at（日時の文字列）が必要です");
      if (!Array.isArray(ib.requests)) err("inbox.requests: 配列にしてください");
      else {
        const seen = new Set();
        ib.requests.forEach((r, i) => {
          const w = `inbox.requests[${i}]`;
          if (!r || typeof r.id !== "string" || !r.id) { err(`${w}: id が必要です`); return; }
          if (seen.has(r.id)) err(`${w}: id "${r.id}" が重複しています`);
          seen.add(r.id);
          if (!REQUEST_STATUS.includes(r.status)) err(`${w}: 不明な status "${r.status}"`);
          if (r.projectId != null && !projectIds.has(r.projectId)) err(`${w}: 不明な projectId "${r.projectId}"`);
          if (!Array.isArray(r.thread) || r.thread.some((m) => !m || !["user", "claude"].includes(m.role) || typeof m.text !== "string" || typeof m.at !== "string")) err(`${w}: thread は {role（user か claude）, at, text} の配列にしてください`);
          if (r.proposal != null && (!Array.isArray(r.proposal.ops) || r.proposal.ops.some((o) => !OP_KINDS.includes(o?.op)))) err(`${w}: proposal.ops の op は ${OP_KINDS.join("・")} のいずれかにしてください`);
        });
      }
    }
  }

  for (const c of data.changeLog) {
    if (!isDate(c.at)) err("changeLog: 日付が不正です");
    if (!Number.isInteger(c.deltaDays)) err("changeLog: deltaDays が整数ではありません");
    if (c.cause != null && !CAUSES.includes(c.cause)) err(`changeLog: 不明な原因 "${c.cause}"`);
    if (c.source != null && !["wbs", "calendar", "inbox"].includes(c.source)) err(`changeLog: 不明な source "${c.source}"`);
  }

  return { errors, warnings };
}
