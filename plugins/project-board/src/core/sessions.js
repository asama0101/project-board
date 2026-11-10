// 作業枠（予定／実績）の規則。枠は「作業した時間の記録」で、タスクの状態は変えない。すべて不変更新。
import { toMin, toHHMM, isWeekend } from "./dates.js";
import { offDayChecker } from "./holidays.js";
import { DEFAULT_WORKDAY } from "./schema.js";

const MIN_LEN = 15;

const workdayOf = (data) => data.settings?.workday ?? DEFAULT_WORKDAY;
/** 全タスクの枠に taskId・title を付けて平らに */
export const allSessions = (data) => data.tasks.flatMap((t) => (t.sessions ?? []).map((s) => ({ ...s, taskId: t.id, title: t.title })));
const findSession = (data, id) => allSessions(data).find((s) => s.id === id);
const clash = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const isPast = (slot, now) => slot.date < now.date || (slot.date === now.date && slot.end <= now.time);

/** 過ぎた予定は unconfirmed、実績は actual、それ以外は planned */
export function sessionKind(session, now) {
  if (session.kind === "actual") return "actual";
  return isPast(session, now) ? "unconfirmed" : "planned";
}

const nextId = (data) => {
  const max = allSessions(data).reduce((m, s) => Math.max(m, +(/^S(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  return `S${max + 1}`;
};

/** 枠の置き場所の検証。他の枠との重なりは error、会議との重なりは warning */
function check(data, slot, ignoreId) {
  const wd = workdayOf(data);
  const [s, e] = [toMin(slot.start), toMin(slot.end)];
  if (e <= s) return { error: "終了は開始より後にしてください" };
  if (e - s < MIN_LEN) return { error: `枠は${MIN_LEN}分以上にしてください` };
  if (s < toMin(wd.start) || e > toMin(wd.end)) return { error: `勤務時間（${wd.start}〜${wd.end}）の中に置いてください` };
  // 休みの日に置けないのは、新しく置く・別の日から動かすとき。休みの日にすでにある枠は、同じ日の中なら直せる
  const stays = ignoreId && allSessions(data).some((x) => x.id === ignoreId && x.date === slot.date);
  if (!stays && offDayChecker(data.settings)(slot.date)) return { error: `${isWeekend(slot.date) && data.settings?.countWeekendsAndHolidays !== true ? "土日" : "休みの日"}には置けません（設定タブの「営業日として扱う日」に指定すると置けます）` };
  const other = allSessions(data).find((x) => x.id !== ignoreId && clash(x, slot));
  if (other) return { error: `他の枠（${other.start}〜${other.end}）と重なっています` };
  const mtg = data.events.find((m) => !m.skip && clash(m, slot));
  return mtg ? { warning: `会議「${mtg.title}」（${mtg.start}〜${mtg.end}）と重なっています` } : {};
}

const withTask = (data, taskId, fn) => ({ ...data, tasks: data.tasks.map((t) => (t.id === taskId ? fn(t) : t)) });
const mapSessions = (data, id, fn) => ({
  ...data,
  tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === id) ? { ...t, sessions: t.sessions.map((s) => (s.id === id ? fn(s) : s)) } : t)),
});

export function addSession(data, taskId, slot, now) {
  if (!data.tasks.some((t) => t.id === taskId)) return { data, error: `タスク ${taskId} がありません` };
  const r = check(data, slot);
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: isPast(slot, now) ? "actual" : "planned" };
  return { data: withTask(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** slot は { date, start }。長さは元のまま。種別は変えない（予定を過去へ動かしても未確認のまま） */
export function moveSession(data, sessionId, slot, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  const len = toMin(cur.end) - toMin(cur.start);
  const next = { date: slot.date, start: slot.start, end: toHHMM(toMin(slot.start) + len) };
  if (toMin(slot.start) + len > 24 * 60) return { data, error: "勤務時間の外になります" };
  const r = check(data, next, sessionId);
  if (r.error) return { data, error: r.error };
  // 実績の枠を未来へ動かしたら予定に戻す（未来の枠は実績にできない）
  const kind = cur.kind === "actual" && !isPast(next, now) ? "planned" : cur.kind;
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, ...next, kind })), ...(r.warning && { warning: r.warning }) };
}

export function resizeSession(data, sessionId, end, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  const r = check(data, { date: cur.date, start: cur.start, end }, sessionId);
  if (r.error) return { data, error: r.error };
  const kind = cur.kind === "actual" && !isPast({ date: cur.date, end }, now) ? "planned" : cur.kind;
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, end, kind })) };
}

export function confirmSession(data, sessionId, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (!isPast(cur, now)) return { data, error: "未来の枠は実績にできません" };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, kind: "actual" })) };
}

export function removeSession(data, sessionId) {
  return { ...data, tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === sessionId) ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t)) };
}

export function taskActual(data, taskId) {
  const ss = data.tasks.find((x) => x.id === taskId).sessions ?? [];
  const actual = ss.filter((s) => s.kind === "actual");
  const minutes = actual.reduce((sum, s) => sum + toMin(s.end) - toMin(s.start), 0);
  return { hours: minutes / 60, firstDate: actual.length ? actual.map((s) => s.date).sort()[0] : null, count: ss.length };
}

/** 進行中（開始済みで未終了）の予定枠の ID。タスクを完了にしても残す枠（futurePlanned に含めない） */
export function runningPlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  const started = (s) => s.date < now.date || (s.date === now.date && s.start <= now.time);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && started(s) && !isPast(s, now)).map((s) => s.id);
}

/** まだ開始していない予定枠の ID（進行中の枠・終了した枠・実績は含まない。完了にするとき解除する対象。進行中の枠は残り、終わったあとに実績にできる） */
export function futurePlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  const notStarted = (s) => s.date > now.date || (s.date === now.date && s.start > now.time);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && notStarted(s)).map((s) => s.id);
}
