// 空き時間・優先順位・会議の操作（純関数、不変更新）
import { toMin, toHHMM, diffDays, isDate, isTime } from "./dates.js";
import { assignMeetingProjects } from "./rules.js";
import { isClosed } from "./schema.js";
import { checklistCount } from "./checklist.js";

/** 対象日の空き時間。skip の会議は無視し、重なりを統合して勤務時間内に切り詰める */
export function freeSlots(events, date, workday) {
  const [ws, we] = [toMin(workday.start), toMin(workday.end)];
  const busy = events
    .filter((e) => e.date === date && !e.skip)
    .map((e) => [Math.max(ws, toMin(e.start)), Math.min(we, toMin(e.end))])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = ws;
  for (const [s, e] of busy) {
    if (s > cur) out.push({ start: toHHMM(cur), end: toHHMM(s) });
    cur = Math.max(cur, e);
  }
  if (cur < we) out.push({ start: toHHMM(cur), end: toHHMM(we) });
  return out;
}

/** このタスクを（推移的に）前のタスクとする未完了タスクの数。循環でも終了する */
function openDownstream(tasks, id) {
  const next = new Map();
  for (const t of tasks) for (const p of t.predecessors ?? []) next.set(p, [...(next.get(p) ?? []), t]);
  const seen = new Set([id]);
  const stack = [id];
  let n = 0;
  while (stack.length) {
    for (const t of next.get(stack.pop()) ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      stack.push(t.id);
      if (!isClosed(t)) n++;
    }
  }
  return n;
}

/**
 * 今日の優先。対象は Done/Cancelled 以外で、前のタスクがすべて完了しているもの。
 * 点数 = 期限超過 100 + 期限点 × 倍率 + 重要度(高 12)
 *   期限点 = 残り 30 日以内なら (30−残り日数)×1.5（超過した分も加算）、それより先は 0
 *   倍率   = 1 + min(未チェックの項目数, 10)/10（Waiting は 1）
 * 次のタスクの数と Waiting の催促は、点数には使わず、理由の表示だけに残す。
 */
export function rankTasks(data, today) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const out = [];
  for (const t of data.tasks) {
    if (isClosed(t)) continue;
    if ((t.predecessors ?? []).some((p) => byId.has(p) && !isClosed(byId.get(p)))) continue;
    const left = diffDays(t.due, today);
    const reasons = [];
    let score = 0;
    if (left < 0) { score += 100; reasons.push(`期限超過 ${-left}日`); }
    const waiting = t.status === "Waiting";
    const mult = waiting ? 1 : 1 + Math.min(checklistCount(t).open, 10) / 10;
    score += (left <= 30 ? (30 - left) * 1.5 : 0) * mult;
    if (left >= 0 && left <= 30) reasons.push(left === 0 ? "期限は今日" : `期限まで ${left}日`);
    const blocked = openDownstream(data.tasks, t.id);
    if (blocked) reasons.push(`次のタスク ${blocked} 件を止めている`);
    if (t.importance === "high") { score += 12; reasons.push("重要度: 高"); }
    let action = "work";
    if (waiting) {
      action = "chase";
      const w = t.waitingOn;
      reasons.unshift(w ? `${w.party} への${left < 0 ? "催促" : "確認"}${isDate(w.since) ? `（回答待ち ${diffDays(today, w.since)}日）` : ""}` : "待ち先が未設定");
    }
    out.push({ taskId: t.id, score, reasons, action, due: t.due });
  }
  return out.sort((a, b) => b.score - a.score || (a.due < b.due ? -1 : a.due > b.due ? 1 : a.taskId < b.taskId ? -1 : 1));
}

// ---- 会議の操作 ----
const maxMeetingNo = (events) => events.reduce((m, e) => Math.max(m, +(/^m(\d+)$/.exec(e.id)?.[1] ?? 0)), 0);
const nextMeetingId = (events) => `m${maxMeetingNo(events) + 1}`;

function assertTimes(m) {
  if (!isDate(m.date) || !isTime(m.start) || !isTime(m.end)) throw new Error("日付または時刻の形式が不正です");
  if (toMin(m.end) <= toMin(m.start)) throw new Error("終了は開始より後にしてください");
}

export function addMeeting(data, m) {
  assertTimes(m);
  const id = nextMeetingId(data.events);
  const e = { id, date: m.date, start: m.start, end: m.end, title: (m.title ?? "").trim() || "会議", source: "manual", skip: !!m.skip, externalId: null, confirmed: false, projectId: null };
  if (m.projectId) {
    if (!data.projects.some((p) => p.id === m.projectId)) throw new Error(`プロジェクト ${m.projectId} がありません`);
    e.projectId = m.projectId;
    e.projectBy = "manual";
  }
  return { data: assignMeetingProjects({ ...data, events: [...data.events, e] }), id };
}

export function updateMeeting(data, id, patch) {
  const cur = data.events.find((e) => e.id === id);
  if (!cur) throw new Error(`会議 ${id} がありません`);
  const common = ["skip", "projectId", "confirmed"];
  const allowed = cur.source === "manual" ? ["title", "date", "start", "end", ...common] : common;
  for (const k of Object.keys(patch)) {
    if (!allowed.includes(k) && patch[k] !== cur[k]) throw new Error(`この会議は ${k} を変更できません（予定表から取得した会議は「参加しない」のみ）`);
  }
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k) && k !== "projectId")) };
  if (cur.source === "manual") { assertTimes(next); next.title = (next.title ?? "").trim() || "会議"; }
  // 日時が変わったら、確認済みは外す(別の時間の会議を、確認したことにしない)。confirmed を明示したときは、その値に従う
  if (!("confirmed" in patch) && cur.confirmed === true && (next.date !== cur.date || next.start !== cur.start || next.end !== cur.end)) next.confirmed = false;
  if ("projectId" in patch) {
    if (patch.projectId === "" || patch.projectId == null) { delete next.projectBy; next.projectId = null; }
    else {
      if (!data.projects.some((p) => p.id === patch.projectId)) throw new Error(`プロジェクト ${patch.projectId} がありません`);
      next.projectId = patch.projectId;
      next.projectBy = "manual";
    }
  }
  const out = { ...data, events: data.events.map((e) => (e.id === id ? next : e)) };
  return assignMeetingProjects(out); // 件名が変わったときも、規則で付けたものを付け直す(手動は変わらない)
}

export const meetingPast = (m, now) => m.date < now.date || (m.date === now.date && m.end <= now.time);

/** 会議の状態: 参加しない=skipped / 確認済み=actual / 過ぎて未確認=unconfirmed / それ以外=planned */
export function meetingKind(m, now) {
  if (m.skip) return "skipped";
  if (m.confirmed === true) return "actual";
  return meetingPast(m, now) ? "unconfirmed" : "planned";
}

/** 過ぎた会議を実績として確認する。未来の会議と、参加しない会議は確認できない */
export function confirmMeeting(data, id, now) {
  const cur = data.events.find((e) => e.id === id);
  if (!cur) throw new Error(`会議 ${id} がありません`);
  if (cur.skip) throw new Error("参加しない会議は実績にできません");
  if (!meetingPast(cur, now)) throw new Error("未来の会議は実績にできません");
  return { ...data, events: data.events.map((e) => (e.id === id ? { ...e, confirmed: true } : e)) };
}

export function deleteMeeting(data, id) {
  const cur = data.events.find((e) => e.id === id);
  if (!cur) throw new Error(`会議 ${id} がありません`);
  if (cur.source !== "manual") throw new Error("予定表から取得した会議は削除できません（「参加しない」にしてください）");
  return { ...data, events: data.events.filter((e) => e.id !== id) };
}

/** 取得結果で、range 内の MCP 由来の会議だけを追加・更新・削除する。手入力の会議と、取得に無いだけの「参加しない」の会議は保つ。excludedIds は、取り込みの対象外になった externalId（その会議は消す） */
export function syncMcpEvents(data, fetched, range, excludedIds = new Set()) {
  const inRange = (d) => d >= range.start && d <= range.end;
  fetched = fetched.filter((f, k) => fetched.findIndex((x) => x.externalId === f.externalId) === k); // 同じ externalId は 1 件
  let seq = maxMeetingNo(data.events); // 消えた会議の ID を使い回さない
  const seen = new Set(fetched.map((f) => f.externalId));
  const existing = new Map(data.events.filter((e) => e.source === "mcp").map((e) => [e.externalId, e]));
  const kept = data.events.filter((e) => e.source !== "mcp" || (e.skip === true && !excludedIds.has(e.externalId)) || seen.has(e.externalId) || !inRange(e.date)); // 「参加しない」の印は、取得に無いだけなら消さない(対象外になった会議は消える)
  const events = kept.map((e) => {
    const f = e.source === "mcp" ? fetched.find((x) => x.externalId === e.externalId) : null;
    if (!f) return e;
    const moved = f.date !== e.date || f.start !== e.start || f.end !== e.end;
    return { ...e, title: f.title, date: f.date, start: f.start, end: f.end, ...(moved && e.confirmed ? { confirmed: false } : {}) };
  });
  for (const f of fetched) {
    if (existing.has(f.externalId)) continue;
    events.push({ id: `m${++seq}`, date: f.date, start: f.start, end: f.end, title: f.title, source: "mcp", skip: false, externalId: f.externalId });
  }
  return { ...data, events };
}
