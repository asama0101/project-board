// 進捗率・遅延判定・ガント用の算出（純関数）
import { addDays, diffDays, weekday, isDate } from "./dates.js";
import { isClosed } from "./schema.js";

const WINDOW_DAYS = { m1: 31, m3: 92, m6: 183, y1: 365 };
const MARGIN_DAYS = 7;

const taskOf = (data, id) => data.tasks.find((t) => t.id === id);
const maxDate = (list) => list.reduce((a, b) => (a > b ? a : b));
const minDate = (list) => list.reduce((a, b) => (a < b ? a : b));

/** start があればそれ（前のタスクは見ない）、なければ前のタスクの期限の最大値、それもなければ期限 */
export function taskStart(data, taskId) {
  const t = taskOf(data, taskId);
  if (t.start) return t.start;
  const preds = (t.predecessors ?? []).map((id) => taskOf(data, id)).filter(Boolean);
  return preds.length ? maxDate(preds.map((p) => p.due)) : t.due;
}

/** 実績の線: 最初の実績枠の日 → 完了日（未完了なら today） */
function actualSpan(t, today) {
  const days = (t.sessions ?? []).filter((s) => s.kind === "actual").map((s) => s.date).sort();
  if (!days.length) return null;
  const finished = isClosed(t);
  let end = finished ? (t.doneAt ?? days[days.length - 1]) : today;
  if (end < days[0]) end = days[0];
  return { start: days[0], end };
}

export function ganttRows(data, projectId, today) {
  const p = data.projects.find((x) => x.id === projectId);
  const tasks = data.tasks.filter((t) => t.projectId === projectId);
  const milestones = [...(p.milestones ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rows = tasks.map((t) => {
    const s = taskStart(data, t.id);
    const point = !t.start && !(t.predecessors ?? []).length; // 点は、開始も前のタスクもない（期限だけの）タスクに限る。開始が期限以後の他のタスクは、期限の 1 日分の棒
    return {
      taskId: t.id,
      start: s >= t.due ? t.due : s,
      end: t.due,
      point,
      actual: actualSpan(t, today),
    };
  });
  const dates = [p.start, p.due, ...milestones.map((m) => m.date), ...rows.flatMap((r) => [r.start, r.end, ...(r.actual ? [r.actual.start, r.actual.end] : [])])];
  return {
    range: { start: addDays(minDate(dates), -MARGIN_DAYS), end: addDays(maxDate(dates), MARGIN_DAYS) },
    rows,
    milestones,
  };
}

/** 表示期間 → 範囲全体の幅が画面幅の何倍か（ratio）と目盛りの種類 */
export function ganttLayout(range, window) {
  const total = diffDays(range.end, range.start) + 1;
  const visibleDays = Math.min(window === "all" ? total : WINDOW_DAYS[window], total);
  const scale = visibleDays <= 40 ? "day" : visibleDays <= 100 ? "week" : visibleDays <= 420 ? "month" : "quarter";
  return { visibleDays, ratio: total / visibleDays, scale };
}

const ymd = (date) => date.split("-").map(Number);
const monthFirst = (y, m) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;

export function timeTicks(range, scale) {
  const out = [];
  if (scale === "day" || scale === "week") {
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      const [, m, day] = ymd(d);
      if (scale === "day") {
        out.push({ date: d, label: day === 1 ? `${m}/${day}` : String(day), yearStart: m === 1 && day === 1 });
      } else if (weekday(d) === 1) {
        // 1 月 1 日を含む週の月曜に年の境目を付ける
        out.push({ date: d, label: `${m}/${day}`, yearStart: ymd(addDays(d, 6))[0] !== ymd(d)[0] || (m === 1 && day === 1) });
      }
    }
    return out;
  }
  const step = scale === "quarter" ? 3 : 1;
  let [y, m] = ymd(range.start);
  if (step === 3) m = Math.floor((m - 1) / 3) * 3 + 1; // 範囲開始を含む四半期の頭から
  for (; monthFirst(y, m) <= range.end; m += step) {
    if (m > 12) { y += 1; m -= 12; }
    const first = monthFirst(y, m);
    if (first > range.end) break;
    const label = scale === "quarter" ? `${y} Q${Math.floor((m - 1) / 3) + 1}` : m === 1 ? `${y}/${m}` : `${m}月`;
    // 範囲開始より前の月初は、範囲開始の位置に寄せる
    out.push({ date: first < range.start ? range.start : first, label, yearStart: m === 1 });
  }
  return out;
}

export function projectProgress(data, projectId) {
  const ts = data.tasks.filter((t) => t.projectId === projectId && t.status !== "Cancelled");
  const done = ts.filter((t) => t.status === "Done").length;
  return { done, total: ts.length, rate: ts.length ? done / ts.length : 0 };
}

export function taskFlags(task, today, settings) {
  const flags = [];
  const open = task.status !== "Done" && task.status !== "Cancelled";
  if (open && task.due < today) flags.push("overdue");
  const long = settings?.waitingLongDays ?? 7;
  if (task.status === "Waiting" && task.waitingOn && isDate(task.waitingOn.since) && diffDays(today, task.waitingOn.since) >= long) flags.push("waiting-long");
  return flags;
}

export function projectFlags(data, projectId, today) {
  const p = data.projects.find((x) => x.id === projectId);
  const all = data.tasks.filter((t) => t.projectId === projectId).flatMap((t) => taskFlags(t, today, data.settings));
  const flags = [];
  if (all.includes("overdue")) flags.push("overdue-tasks");
  if (all.includes("waiting-long")) flags.push("waiting-long");
  if (p.due < today && !["完了", "中止"].includes(p.status)) flags.push("past-due");
  return flags;
}
