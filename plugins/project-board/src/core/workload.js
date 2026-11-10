// 稼働の集計（純関数）: 実績の作業枠（タスク）と、確認済みで参加する会議の時間をプロジェクト別に集める。
import { addDays, toMin, weekday } from "./dates.js";
import { sessionKind } from "./sessions.js";
import { meetingKind } from "./schedule.js";

export const hours = (x) => (toMin(x.end) - toMin(x.start)) / 60;
const inRange = (d, r) => !r || (d >= r.start && d <= r.end);
const sumBy = (list, f) => list.reduce((a, x) => a + f(x), 0);

const actualSessions = (data, range) =>
  data.tasks.flatMap((t) => (t.sessions ?? []).filter((s) => s.kind === "actual" && inRange(s.date, range)).map((s) => ({ ...s, projectId: t.projectId })));
const countedMeetings = (data, range) => data.events.filter((m) => m.confirmed === true && !m.skip && inRange(m.date, range));

/** 全期間の、プロジェクトの稼働時間（h）: タスク（実績の作業枠）と会議（確認済み・参加するもの） */
export function projectHours(data, projectId) {
  return {
    task: sumBy(actualSessions(data).filter((s) => s.projectId === projectId), hours),
    meeting: sumBy(countedMeetings(data).filter((m) => m.projectId === projectId), hours),
  };
}

/**
 * 期間内の稼働。rows は data.projects の順（0 時間でも出す）。unassigned はプロジェクト未設定（または存在しない）の会議。
 * unconfirmed は、期間内で過ぎたのに未確認の作業枠と会議の件数（now があるときだけ数える。内訳は unconfirmedTasks・unconfirmedMeetings）
 */
export function workload(data, range, now) {
  const ids = new Set(data.projects.map((p) => p.id));
  const sessions = actualSessions(data, range);
  const meetings = countedMeetings(data, range);
  const rows = data.projects.map((p) => {
    const task = sumBy(sessions.filter((s) => s.projectId === p.id), hours);
    const meeting = sumBy(meetings.filter((m) => m.projectId === p.id), hours);
    return { projectId: p.id, task, meeting, total: task + meeting };
  });
  const unassigned = sumBy(meetings.filter((m) => !ids.has(m.projectId)), hours);
  let unconfirmedTasks = 0, unconfirmedMeetings = 0;
  if (now) {
    unconfirmedTasks = data.tasks.flatMap((t) => t.sessions ?? []).filter((s) => inRange(s.date, range) && sessionKind(s, now) === "unconfirmed").length;
    unconfirmedMeetings = data.events.filter((m) => inRange(m.date, range) && meetingKind(m, now) === "unconfirmed").length;
  }
  return { rows, unassigned, total: sumBy(rows, (r) => r.total) + unassigned, unconfirmed: unconfirmedTasks + unconfirmedMeetings, unconfirmedTasks, unconfirmedMeetings };
}

/** 週（月曜〜日曜）または月（月初〜月末）の範囲 */
export function periodRange(period, date) {
  if (period === "week") {
    const start = addDays(date, -((weekday(date) + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  const [y, m] = date.split("-").map(Number);
  const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${String(y + 1).padStart(4, "0")}-01-01` : `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end: addDays(next, -1) };
}
