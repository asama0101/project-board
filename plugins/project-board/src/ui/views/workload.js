// 「稼働」画面: 期間（週・月）ごとに、プロジェクト別のタスク（実績の作業枠）と会議（確認済み・参加するもの）の時間を見せる。
import { addDays } from "../../core/dates.js";
import { workload, periodRange } from "../../core/workload.js";
import { esc, fmtMD } from "../common.js";

const h = (v) => `${v.toFixed(1)}h`;

/**
 * @param opts.period "week" | "month"
 * @param opts.date   表示する日（その日を含む週・月）
 * @param opts.now    {date, time} 未確認の件数を数えるための現在時刻
 */
export function renderWorkload(data, today, opts = {}) {
  const { period = "week", date = today, now } = opts;
  const range = periodRange(period, date);
  const w = workload(data, range, now);
  const [y, m] = date.split("-").map(Number);
  const title = period === "week" ? `${fmtMD(range.start)}〜${fmtMD(range.end)} の週` : `${y}年${m}月`;
  const todayLabel = period === "week" ? "今週" : "今月";
  const max = Math.max(0, ...w.rows.map((r) => r.total), w.unassigned);
  const bar = (task, meeting) => {
    const total = task + meeting;
    const width = max ? (total / max) * 100 : 0;
    const tp = total ? (task / total) * 100 : 0;
    return `<div class="wl-bar" style="width:${width.toFixed(1)}%"><i class="t" style="width:${tp.toFixed(1)}%"></i><i class="m" style="width:${(100 - tp).toFixed(1)}%"></i></div>`;
  };
  const rows = w.rows.map((r) => `<tr><td>${esc(data.projects.find((p) => p.id === r.projectId)?.name ?? r.projectId)}</td><td class="num mono">${h(r.task)}</td><td class="num mono">${h(r.meeting)}</td><td class="num mono"><b>${h(r.total)}</b></td><td>${bar(r.task, r.meeting)}</td></tr>`).join("");
  const un = w.unassigned > 0
    ? `<tr class="muted"><td>プロジェクト未設定の会議</td><td class="num mono">—</td><td class="num mono">${h(w.unassigned)}</td><td class="num mono"><b>${h(w.unassigned)}</b></td><td><div class="wl-bar un" style="width:${(max ? (w.unassigned / max) * 100 : 0).toFixed(1)}%"><i class="m" style="width:100%"></i></div></td></tr>`
    : "";
  const sumTask = w.rows.reduce((a, r) => a + r.task, 0);
  const sumMtg = w.rows.reduce((a, r) => a + r.meeting, 0) + w.unassigned;
  const note = w.unconfirmed > 0
    ? `<div class="banner">未確認 ${w.unconfirmed}件（作業枠 ${w.unconfirmedTasks}・会議 ${w.unconfirmedMeetings}）は、まだ含まれていません。スケジュール画面で「実績にする」と確認すると加わります。</div>`
    : "";
  const none = data.projects.length ? "" : `<p class="muted">プロジェクトがありません。ガントチャートかリストの「＋ プロジェクトを追加」から追加してください。</p>`;
  return `<section class="panel wl" aria-label="稼働">
    <div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-wnav="-1" aria-label="前へ">←</button><button class="btn" data-wnav="1" aria-label="次へ">→</button><button class="btn" data-wtoday>${todayLabel}</button><strong style="margin-left:6px">${title}</strong></div>
      <div class="seg" role="group" aria-label="期間"><button data-wperiod="week" aria-pressed="${period === "week"}">週</button><button data-wperiod="month" aria-pressed="${period === "month"}">月</button></div></div>
    <div class="legend"><span><i class="sw wl-t"></i>タスク（実績の作業枠）</span><span><i class="sw wl-m"></i>会議（確認済み・参加するもの）</span></div>
    ${none}
    <div class="tscroll"><table class="tbl wl-tbl"><thead><tr><th>プロジェクト</th><th class="num">タスク</th><th class="num">会議</th><th class="num">合計</th><th>内訳</th></tr></thead><tbody>${rows}${un}</tbody>
      <tfoot><tr><td>合計</td><td class="num mono">${h(sumTask)}</td><td class="num mono">${h(sumMtg)}</td><td class="num mono">${h(w.total)}</td><td></td></tr></tfoot></table></div>
    ${note}
  </section>`;
}

/** 期間を 1 つ前後へ動かした日（週は 7 日、月は 1 か月） */
export function shiftWorkloadDate(period, date, dir) {
  if (period === "week") return addDays(date, 7 * dir);
  const [y, m] = date.split("-").map(Number);
  const t = y * 12 + (m - 1) + dir;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
