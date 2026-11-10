// 画面からの編集（追加・削除・更新）。すべて不変更新で、不正な入力は例外にする（呼び出し側が理由を表示する）。
import { addDays, diffDays, isDate, isTime, isWeekend, toMin, nowLocal } from "../core/dates.js";
import { calendarOf } from "../core/holidays.js";
import { taskStart } from "../core/metrics.js";
import { groupSections } from "../core/groups.js";
import { nextChecklistId } from "../core/checklist.js";
import { HOLIDAY_KINDS } from "../core/schema.js";

const mapTask = (data, id, fn) => {
  if (!data.tasks.some((t) => t.id === id)) throw new Error(`タスク ${id} がありません`);
  return { ...data, tasks: data.tasks.map((t) => (t.id === id ? fn(t) : t)) };
};
const mapProject = (data, id, fn) => {
  if (!data.projects.some((p) => p.id === id)) throw new Error(`プロジェクト ${id} がありません`);
  return { ...data, projects: data.projects.map((p) => (p.id === id ? fn(p) : p)) };
};
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** このタスクの次のタスク（推移的）の ID 集合 */
function downstream(data, id) {
  const down = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const t of data.tasks) {
      if ((t.predecessors ?? []).includes(cur) && !down.has(t.id)) { down.add(t.id); stack.push(t.id); }
    }
  }
  return down;
}

/** 前のタスクにできるタスク（同一プロジェクトで、自分・既に前のタスク・自分の次のタスクを除く。循環を作らせない） */
export function predecessorCandidates(data, taskId) {
  const t = data.tasks.find((x) => x.id === taskId);
  const down = downstream(data, taskId);
  return data.tasks
    .filter((u) => u.projectId === t.projectId && u.id !== taskId && !(t.predecessors ?? []).includes(u.id) && !down.has(u.id))
    .map((u) => u.id);
}

/**
 * patch: title / status / due / start / importance / memo / group / subgroup / predecessors / waitingOn
 * 状態を Done にすると doneAt に today、他へ戻すと null。Waiting は待ち先が必須で、外れると waitingOn は null。
 */
export function updateTask(data, taskId, patch, today = nowLocal().date) {
  return mapTask(data, taskId, (t) => {
    const n = { ...t };
    if ("title" in patch) {
      const title = String(patch.title ?? "").trim();
      if (!title) throw new Error("件名を入力してください");
      n.title = title;
    }
    if ("due" in patch) {
      if (!isDate(patch.due)) throw new Error("期限は YYYY-MM-DD の形式で入力してください");
      n.due = patch.due;
    }
    if ("start" in patch) {
      if (patch.start != null && patch.start !== "" && !isDate(patch.start)) throw new Error("開始日は YYYY-MM-DD の形式で入力してください");
      n.start = patch.start || null;
    }
    if ("importance" in patch) n.importance = patch.importance ?? null;
    if ("memo" in patch) n.memo = String(patch.memo ?? "");
    for (const k of ["group", "subgroup"]) if (k in patch) n[k] = String(patch[k] ?? "").trim() || null;
    if ("predecessors" in patch) {
      const ids = [...new Set(patch.predecessors)];
      for (const id of ids) {
        if (!data.tasks.some((x) => x.id === id)) throw new Error(`前のタスク ${id} がありません`);
        if (id === taskId || downstream(data, taskId).has(id)) throw new Error(`${id} を前のタスクにすると循環します`);
      }
      n.predecessors = ids;
    }
    if ("status" in patch) {
      n.status = patch.status;
      n.doneAt = patch.status === "Done" ? (t.status === "Done" && t.doneAt ? t.doneAt : today) : null; // すでに Done なら、元の完了日を保つ
    }
    if (n.status === "Waiting") {
      const w = "waitingOn" in patch ? patch.waitingOn : t.waitingOn;
      if (w && String(w.party ?? "").trim()) n.waitingOn = { party: String(w.party).trim(), since: w.since ?? t.waitingOn?.since ?? today };
      else if ("status" in patch || "waitingOn" in patch) throw new Error("Waiting にするときは待ち先を入力してください");
      else n.waitingOn = t.waitingOn; // 既存データの待ち先なしは、他の項目の編集を妨げない(validate が警告する)
    } else {
      n.waitingOn = null;
    }
    if (n.start && n.start > n.due) throw new Error("開始日は期限以前にしてください");
    return n;
  });
}

// ---- チェックリスト（task.checklist = [{ id, text, done }]） ----
const itemText = (text) => {
  const s = String(text ?? "").trim();
  if (!s) throw new Error("項目を入力してください");
  return s;
};
const mapChecklist = (data, taskId, fn) => mapTask(data, taskId, (t) => ({ ...t, checklist: fn(t.checklist ?? []) }));
const needItem = (items, itemId) => {
  if (!items.some((c) => c.id === itemId)) throw new Error(`項目 ${itemId} がありません`);
};

/** 末尾に項目を足す。ID は、いまある最大番号 + 1（c1, c2…） */
export function addChecklistItem(data, taskId, text) {
  const s = itemText(text);
  return mapChecklist(data, taskId, (items) => [...items, { id: nextChecklistId(items), text: s, done: false }]);
}

/** patch: { text?, done? } */
export function updateChecklistItem(data, taskId, itemId, patch) {
  return mapChecklist(data, taskId, (items) => {
    needItem(items, itemId);
    return items.map((c) => {
      if (c.id !== itemId) return c;
      const n = { ...c };
      if ("text" in patch) n.text = itemText(patch.text);
      if ("done" in patch) n.done = !!patch.done;
      return n;
    });
  });
}

export function removeChecklistItem(data, taskId, itemId) {
  return mapChecklist(data, taskId, (items) => {
    needItem(items, itemId);
    return items.filter((c) => c.id !== itemId);
  });
}

/** itemId を beforeId の前へ（null は末尾）。動かしても並びが同じなら、同じ data を返す */
export function moveChecklistItem(data, taskId, itemId, beforeId = null) {
  const cur = data.tasks.find((t) => t.id === taskId)?.checklist ?? [];
  needItem(cur, itemId);
  if (beforeId !== null) needItem(cur, beforeId);
  if (beforeId === itemId) return data;
  const moving = cur.find((c) => c.id === itemId);
  const rest = cur.filter((c) => c.id !== itemId);
  const at = beforeId === null ? rest.length : rest.findIndex((c) => c.id === beforeId);
  const next = [...rest.slice(0, at), moving, ...rest.slice(at)];
  if (next.every((c, i) => c === cur[i])) return data;
  return mapChecklist(data, taskId, () => next);
}

/** 全項目を済みにする */
export const checkAllChecklist = (data, taskId) => mapChecklist(data, taskId, (items) => items.map((c) => ({ ...c, done: true })));

/** 文言の一覧から、c1 から採番した項目を作る（空は除く）。addTask に付ける項目用 */
export const newChecklist = (texts) => texts.map((s) => s.trim()).filter(Boolean).map((text, i) => ({ id: `c${i + 1}`, text, done: false }));

/** patch: name / type / status / start / due */
export function updateProject(data, projectId, patch) {
  return mapProject(data, projectId, (p) => {
    const n = { ...p };
    if ("name" in patch) {
      const name = String(patch.name ?? "").trim();
      if (!name) throw new Error("プロジェクト名を入力してください");
      n.name = name;
    }
    for (const k of ["type", "status"]) if (k in patch) n[k] = patch[k];
    for (const k of ["start", "due"]) {
      if (k in patch) {
        if (!isDate(patch[k])) throw new Error("日付は YYYY-MM-DD の形式で入力してください");
        n[k] = patch[k];
      }
    }
    if (n.start > n.due) throw new Error("開始日は期限以前にしてください");
    return n;
  });
}

// ---- マイルストーン（日付昇順を保つ） ----
const sortedMs = (list) => [...list].sort(byDate);
const checkIndex = (p, index) => {
  if (!Number.isInteger(index) || index < 0 || index >= (p.milestones ?? []).length) throw new Error(`マイルストーン ${index} がありません`);
};

export function addMilestone(data, projectId, m) {
  if (!isDate(m.date)) throw new Error("日付は YYYY-MM-DD の形式で入力してください");
  return mapProject(data, projectId, (p) => ({ ...p, milestones: sortedMs([...(p.milestones ?? []), { name: m.name, date: m.date }]) }));
}

export function updateMilestone(data, projectId, index, patch) {
  return mapProject(data, projectId, (p) => {
    checkIndex(p, index);
    const cur = p.milestones[index];
    const next = { name: cur.name, date: cur.date };
    if ("name" in patch) next.name = String(patch.name ?? "").trim() || cur.name;
    if ("date" in patch) {
      if (!isDate(patch.date)) throw new Error("日付は YYYY-MM-DD の形式で入力してください");
      next.date = patch.date;
    }
    return { ...p, milestones: sortedMs(p.milestones.map((m, i) => (i === index ? next : m))) };
  });
}

export function deleteMilestone(data, projectId, index) {
  return mapProject(data, projectId, (p) => {
    checkIndex(p, index);
    return { ...p, milestones: p.milestones.filter((_, i) => i !== index) };
  });
}

export function moveMilestone(data, projectId, index, days) {
  const cur = data.projects.find((p) => p.id === projectId)?.milestones?.[index];
  if (!cur) throw new Error(`マイルストーン ${index} がありません`);
  return updateMilestone(data, projectId, index, { date: addDays(cur.date, days) });
}

// ---- ガントのドラッグ ----
/** mode: "start" | "due" | "both"。前のタスクとの関係は見ない（開始を動かすと、その日が start として保存される） */
export function moveTaskDates(data, taskId, mode, days) {
  const t = data.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`タスク ${taskId} がありません`);
  if (!days) return { data };
  const patch = {};
  if (mode === "start" || mode === "both") patch.start = addDays(taskStart(data, taskId), days);
  if (mode === "due" || mode === "both") patch.due = addDays(t.due, days);
  if ((patch.start ?? t.start ?? "") > (patch.due ?? t.due)) return { data, error: "開始日が期限より後になります" };
  return { data: mapTask(data, taskId, (x) => ({ ...x, ...patch })) };
}

/** 前のタスクを足す。開始日は触らない（指定してあれば、そのまま残る） */
export function addPredecessor(data, taskId, predId, today = nowLocal().date) {
  const t = data.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`タスク ${taskId} がありません`);
  return updateTask(data, taskId, { predecessors: [...(t.predecessors ?? []), predId] }, today);
}

/**
 * 表示順の入れ替え。beforeId のタスクの前へ入れ、そのタスクの大項目・中項目になる。
 * beforeId が null（省略）のときは、指定した大項目・中項目（空は「（なし）」）のセクションの末尾へ入れる。
 * 同じプロジェクトのタスクだけを指せる。動かしたあと、そのプロジェクトのタスクを表示の順（セクション順）に並べ直して、配列の同じ位置へ戻す
 * （他のプロジェクトのタスクの位置は変わらない）。今の表示と同じ位置・同じ大項目・中項目になるときは、同じデータを返す。
 */
export function moveTask(data, id, { beforeId = null, group = "", subgroup = "" } = {}) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`タスク ${id} がありません`);
  const b = beforeId ? data.tasks.find((x) => x.id === beforeId) : null;
  if (beforeId && !b) throw new Error(`タスク ${beforeId} がありません`);
  if (b && b.projectId !== t.projectId) throw new Error(`タスク ${id} と ${beforeId} は別のプロジェクトです`);
  if (beforeId === id) return data;

  const mine = data.tasks.filter((x) => x.projectId === t.projectId);
  const shown = groupSections(mine);
  const secs = shown.map((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) }));
  const g = b ? (b.group ?? "") : String(group ?? "").trim();
  const sg = b ? (b.subgroup ?? "") : String(subgroup ?? "").trim();
  let sec = b ? secs.find((s) => s.tasks.some((x) => x.id === beforeId)) : secs.find((s) => s.group === g && s.subgroup === sg);
  if (!sec) secs.push((sec = { group: g, subgroup: sg, tasks: [] }));
  sec.tasks.splice(b ? sec.tasks.findIndex((x) => x.id === beforeId) : sec.tasks.length, 0, { ...t, group: g || null, subgroup: sg || null });
  const order = groupSections(secs.flatMap((s) => s.tasks)).flatMap((s) => s.tasks);

  const before = shown.flatMap((s) => s.tasks);
  const same = order.every((x, i) => x.id === before[i].id) && (t.group ?? "") === g && (t.subgroup ?? "") === sg;
  if (same) return data;
  let k = 0;
  return { ...data, tasks: data.tasks.map((x) => (x.projectId === t.projectId ? order[k++] : x)) };
}

export function moveProjectDates(data, projectId, edge, days) {
  const p = data.projects.find((x) => x.id === projectId);
  if (!p) throw new Error(`プロジェクト ${projectId} がありません`);
  const v = addDays(p[edge], days);
  if ((edge === "start" ? v > p.due : v < p.start)) return { data, error: "開始日が期限より後になります" };
  return { data: mapProject(data, projectId, (x) => ({ ...x, [edge]: v })) };
}

// ---- 追加・削除 ----
/** ID の末尾の番号（「A3」→ 3）。このプロジェクトの ID でなければ 0 */
const idNumber = (id, projectId) => (String(id).startsWith(projectId) && /^\d+$/.test(String(id).slice(projectId.length)) ? Number(String(id).slice(projectId.length)) : 0);

/** いまのタスクと変更履歴（消したタスクの ID も残る）の最大番号 + 1。消したタスクの ID を使い回すと、変更履歴が別のタスクのものとして出る */
function nextTaskId(data, projectId) {
  const ids = [...data.tasks.map((t) => t.id), ...(data.changeLog ?? []).flatMap((c) => c.taskIds ?? [])];
  let n = ids.reduce((m, id) => Math.max(m, idNumber(id, projectId)), 0) + 1;
  while (data.tasks.some((t) => t.id === `${projectId}${n}`)) n++;
  return `${projectId}${n}`;
}

const newTask = (data, projectId, title, due, extra = {}) => ({
  id: nextTaskId(data, projectId), projectId, title, due, start: null, status: "To Do", memo: "",
  predecessors: [], waitingOn: null, importance: null, doneAt: null, sessions: [], ...extra,
});

/** place: { group, subgroup }。見出し行の「＋」から、そのグループへ入れる。含まれるキーだけ入れ、空白は null にする */
export function addTaskQuick(data, projectId, title, today = nowLocal().date, place = {}) {
  if (!data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  const extra = {};
  for (const k of ["group", "subgroup"]) if (k in place) extra[k] = String(place[k] ?? "").trim() || null;
  // 開始は今日、期限は 7 日後（開始がないと、ガントでバーにならず点で出るため）
  return { ...data, tasks: [...data.tasks, newTask(data, projectId, title, addDays(today, 7), { start: today, ...extra })] };
}

export function addTask(data, task) {
  if (!data.projects.some((p) => p.id === task.projectId)) throw new Error(`プロジェクト ${task.projectId} がありません`);
  const title = String(task.title ?? "").trim();
  if (!title) throw new Error("件名を入力してください");
  if (!isDate(task.due)) throw new Error("期限は YYYY-MM-DD の形式で入力してください");
  const { id, ...rest } = task;
  void id;
  return { ...data, tasks: [...data.tasks, newTask(data, task.projectId, title, task.due, { ...rest, title })] };
}

/** タスクを削除し、他のタスクの前のタスクからも外す */
export function deleteTask(data, taskId) {
  return { ...data, tasks: data.tasks.filter((t) => t.id !== taskId).map((t) => ((t.predecessors ?? []).includes(taskId) ? { ...t, predecessors: t.predecessors.filter((p) => p !== taskId) } : t)) };
}

/**
 * 設定（勤務時間・待ち長期化の日数・土日祝を営業日に数えるか・見出しの呼び名）の変更。patch に含まれる項目だけ変える。
 * 勤務時間は開始・終了を組で渡す。呼び名は空にするとそのキーを消す（既定の呼び名に戻る）。不正な値は例外
 */
export function updateSettings(data, patch) {
  const s = { ...(data.settings ?? {}) };
  if ("workday" in patch) {
    const { start, end } = patch.workday ?? {};
    if (!isTime(start) || !isTime(end) || toMin(start) >= toMin(end)) throw new Error("勤務時間は HH:MM で、開始を終了より前にしてください");
    s.workday = { start, end };
  }
  if ("waitingLongDays" in patch) {
    if (!Number.isInteger(patch.waitingLongDays) || patch.waitingLongDays < 1) throw new Error("待ち長期化の日数は 1 以上の整数にしてください");
    s.waitingLongDays = patch.waitingLongDays;
  }
  if ("countWeekendsAndHolidays" in patch) {
    if (patch.countWeekendsAndHolidays) s.countWeekendsAndHolidays = true; else delete s.countWeekendsAndHolidays;
  }
  if ("labels" in patch) {
    const labels = s.labels && typeof s.labels === "object" && !Array.isArray(s.labels) ? { ...s.labels } : {};
    for (const k of ["group", "subgroup"]) {
      if (!(k in patch.labels)) continue;
      const v = String(patch.labels[k] ?? "").trim();
      if (v) labels[k] = v; else delete labels[k];
    }
    if (Object.keys(labels).length) s.labels = labels; else delete s.labels;
  }
  return { ...data, settings: s };
}

// ---- 休み（settings.holidays）と営業日の指定（settings.workdays）。どちらも { date, ... } の配列で、日付の昇順。同じ日は置き換える ----
const isEntry = (x) => x && typeof x === "object" && isDate(x.date);

/** list に entry を足す（同じ日は置き換え、日付の昇順）。形の違う既存の要素は消さず、末尾に残す（validate が注意を出す） */
function upsertByDate(list, entry) {
  const cur = Array.isArray(list) ? list : [];
  return [...cur.filter((x) => isEntry(x) && x.date !== entry.date), entry].sort((p, q) => p.date.localeCompare(q.date)).concat(cur.filter((x) => !isEntry(x)));
}

function removeByDate(list, date) {
  const rest = (Array.isArray(list) ? list : []).filter((x) => !(isEntry(x) && x.date === date));
  return rest.length ? rest : undefined;
}

const withSetting = (data, key, value) => {
  const s = { ...data.settings };
  if (value === undefined) delete s[key]; else s[key] = value;
  return { ...data, settings: s };
};

const entryOf = ({ date, note }, extra = {}) => {
  if (!isDate(date)) throw new Error(`実在する日付（YYYY-MM-DD）にしてください: ${date}`);
  const n = String(note ?? "").trim();
  return { date, ...extra, ...(n ? { note: n } : {}) };
};

/** 休みを 1 日足す。区分は 祝日・有給・その他 */
export function addHoliday(data, { date, kind, note }) {
  if (!HOLIDAY_KINDS.includes(kind)) throw new Error(`区分は ${HOLIDAY_KINDS.join("・")} のどれかにしてください`);
  return withSetting(data, "holidays", upsertByDate(data.settings?.holidays, entryOf({ date, note }, { kind })));
}

/** from〜to（両端を含む）の各日から、土日と日本の祝日（取得済みのとき）を除いた日と、除いた日数。土日祝を営業日に数える設定のときは、何も除かない。to < from と 366 日を超える期間は例外 */
export function holidayRangeDays(data, from, to) {
  if (!isDate(from) || !isDate(to)) throw new Error(`実在する日付（YYYY-MM-DD）にしてください: ${isDate(from) ? to : from}`);
  if (to < from) throw new Error("終了日は開始日以降にしてください");
  if (diffDays(to, from) >= 366) throw new Error("期間は 366 日以内にしてください");
  const keepAll = data.settings?.countWeekendsAndHolidays === true;
  const national = new Set(calendarOf({ nationalHolidays: data.settings?.nationalHolidays }).off);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (keepAll || (!isWeekend(d) && !national.has(d))) days.push(d);
  return { days, skipped: diffDays(to, from) + 1 - days.length };
}

/** 期間の休みを 1 日ずつ足す（土日と日本の祝日は除く）。除いた結果が 0 日なら例外 */
export function addHolidayRange(data, { from, to, kind, note }) {
  const { days } = holidayRangeDays(data, from, to);
  if (!days.length) throw new Error("期間内に休みにできる日がありません（土日と日本の祝日は除きます）");
  return days.reduce((d, date) => addHoliday(d, { date, kind, note }), data);
}

/** 休みを外す。無い日は何もしない。空になったらキーを消す */
export const removeHoliday = (data, date) => withSetting(data, "holidays", removeByDate(data.settings?.holidays, date));

/** 営業日として扱う日（土日・祝日・休みでも営業日として数える）を足す */
export const addWorkday = (data, { date, note }) => withSetting(data, "workdays", upsertByDate(data.settings?.workdays, entryOf({ date, note })));

export const removeWorkday = (data, date) => withSetting(data, "workdays", removeByDate(data.settings?.workdays, date));

export function addProject(data, { name, type }, today = nowLocal().date) {
  const used = new Set(data.projects.map((p) => p.id));
  let id = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => !used.has(c));
  for (let i = 1; !id; i++) if (!used.has(`P${i}`)) id = `P${i}`;
  const p = { id, name, type, status: "計画中", start: today, due: addDays(today, 30), milestones: [] };
  return { ...data, projects: [...data.projects, p] };
}

export function deleteProject(data, projectId) {
  // そのプロジェクトを指す会議のひも付け・規則・WBS の対応・依頼の絞り込みも消す(ID が再利用されても、別のプロジェクトへ付け替わらないように)
  const events = data.events.map((e) => {
    if (e.projectId !== projectId) return e;
    const { projectBy, ...rest } = e;
    void projectBy;
    return { ...rest, projectId: null };
  });
  let settings = data.settings;
  if (settings) {
    settings = { ...settings };
    if (settings.projectRules) settings.projectRules = settings.projectRules.filter((r) => r.projectId !== projectId);
    if (settings.wbsMappings) settings.wbsMappings = Object.fromEntries(Object.entries(settings.wbsMappings).filter(([k]) => k !== projectId));
    if (settings.wbsImports) settings.wbsImports = Object.fromEntries(Object.entries(settings.wbsImports).filter(([k]) => k !== projectId));
  }
  // 依頼(受信箱)の絞り込みも外す(残すと、検証が不明な projectId で保存を止める)
  const inbox = data.inbox?.requests ? { ...data.inbox, requests: data.inbox.requests.map((r) => (r.projectId === projectId ? { ...r, projectId: null } : r)) } : data.inbox;
  return { ...data, settings, events, ...(inbox ? { inbox } : {}), projects: data.projects.filter((p) => p.id !== projectId), tasks: data.tasks.filter((t) => t.projectId !== projectId) };
}
