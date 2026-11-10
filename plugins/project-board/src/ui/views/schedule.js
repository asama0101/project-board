// スケジュール画面（週／日）。位置と高さは勤務時間に対する % で表し、カレンダーの高さは CSS で画面に追従させる。
import { addDays, toMin, weekday } from "../../core/dates.js";
import { freeSlots, meetingKind } from "../../core/schedule.js";
import { matchProject } from "../../core/rules.js";
import { offDayChecker } from "../../core/holidays.js";
import { sessionKind, allSessions } from "../../core/sessions.js";
import { DEFAULT_WORKDAY } from "../../core/schema.js";
import { esc, fmtMD, wdJa, STATUS_UI } from "../common.js";
import { renderSide, renderSideToggle } from "./prio.js";

const SLOT_STEP = 15;

/** 15 分刻みに丸め、勤務時間内に収める（開始の分を返す） */
export function snapStart(minutes, durationMin, workday = DEFAULT_WORKDAY) {
  const [ws, we] = [toMin(workday.start), toMin(workday.end)];
  return Math.max(ws, Math.min(Math.round(minutes / SLOT_STEP) * SLOT_STEP, we - durationMin));
}

export const weekStartOf = (d) => addDays(d, -((weekday(d) + 6) % 7));

/** 勤務時間 → 位置計算（すべて % ） */
export function calendarGeometry(data) {
  const wd = data.settings?.workday ?? DEFAULT_WORKDAY;
  const h0 = toMin(wd.start);
  const span = toMin(wd.end) - h0;
  const pc = (m) => ((m - h0) / span) * 100;
  return { wd, h0, span, pc, tp: (m) => `${pc(m).toFixed(3)}%`, ht: (a, b) => `calc(${(pc(b) - pc(a)).toFixed(3)}% - 2px)` };
}

const hoursHtml = (g) => {
  let s = "";
  for (let h = Math.ceil(g.h0 / 60); h * 60 <= g.h0 + g.span; h++) s += `<div class="hour" style="top:${(((h * 60 - g.h0) / g.span) * 100).toFixed(3)}%"><span>${h}:00</span></div>`;
  return s;
};

function meetingBlocks(data, d, full, g, ctx) {
  return (data.events ?? []).filter((m) => m.date === d && (ctx.showSkipped || !m.skip || ctx.selMtg === m.id)).map((m) => {
    const a = Math.max(toMin(m.start), g.h0);
    const b = Math.min(toMin(m.end), g.h0 + g.span);
    if (b <= a) return "";
    const manual = m.source === "manual";
    const kind = meetingKind(m, ctx.now);
    const kc = kind === "actual" ? "act" : kind === "unconfirmed" ? "unconf" : "";
    const mark = m.skip ? " 不参加" : kind === "actual" ? " ✓" : kind === "unconfirmed" ? " 未確認" : "";
    const pname = (data.projects ?? []).find((p) => p.id === m.projectId)?.name;
    const by = m.projectBy === "manual" ? "（手動）" : m.projectBy === "rule" ? "（規則）" : "";
    const proj = full ? `<span class="mp">${pname ? `プロジェクト: ${esc(pname)}${by}` : "プロジェクト未設定"}</span>` : "";
    const confirm = full && kind === "unconfirmed" ? `<span class="bb"><button class="btn" data-confirmmtg="${esc(m.id)}">実績にする</button></span>` : "";
    return `<div class="blk mtg ${m.skip ? "skip" : ""} ${kc} ${ctx.selMtg === m.id ? "sel" : ""}" data-mtg="${esc(m.id)}" tabindex="0" ${manual ? `draggable="true" data-dragmtg="${esc(m.id)}"` : ""} style="top:${g.tp(a)};height:${g.ht(a, b)}" title="${esc(m.title)}${m.skip ? "(参加しない)" : ""}${manual ? "" : "(予定表から取得)"}"><span class="tm">${esc(m.start)}-${esc(m.end)}${mark}</span>${esc(m.title)}${proj}${confirm}${manual ? `<i class="rz" data-rzm="${esc(m.id)}" aria-label="終了時刻を変更"></i>` : ""}</div>`;
  }).join("");
}

const KIND_CLS = { actual: "act", unconfirmed: "unconf", planned: "plan" };
const KIND_JA = { act: "実績", unconf: "未確認", plan: "予定" };
/** 日表示の枠に出す、タスクの状態の文字 */
const STATUS_JA = { "To Do": "未着手", "In Progress": "着手中", Waiting: "待ち", Done: "完了", Cancelled: "中止" };

function sessionBlocks(data, d, full, g, ctx) {
  return allSessions(data).filter((s) => s.date === d).map((s) => {
    const kind = sessionKind(s, ctx.now);
    const c = KIND_CLS[kind];
    const confirm = full && kind === "unconfirmed" ? `<span class="bb"><button class="btn" data-confirm="${esc(s.id)}">実績にする</button></span>` : "";
    const st = full ? ` <span class="stt">${STATUS_JA[data.tasks.find((t) => t.id === s.taskId).status] ?? ""}</span>` : "";
    return `<div class="blk task ${c} ${ctx.selSess === s.id ? "sel" : ""}" draggable="true" tabindex="0" data-dragsess="${esc(s.id)}" style="top:${g.tp(toMin(s.start))};height:${g.ht(toMin(s.start), toMin(s.end))}" title="${esc(s.title)}(${KIND_JA[c]})"><span class="tm">${esc(s.start)}-${esc(s.end)}${c === "act" ? " ✓" : c === "unconf" ? " 未確認" : ""}</span>${full ? `${esc(s.taskId)} ` : ""}${esc(s.title)}${st}${confirm}<i class="rz" data-rz="${esc(s.id)}" aria-label="終了時刻を変更"></i></div>`;
  }).join("");
}

/** 会議と配置済みの枠を除いた空き時間 */
function freeOf(data, d, g, isOff) {
  if (isOff(d)) return [];
  const busy = [...(data.events ?? []), ...allSessions(data)].filter((x) => x.date === d);
  return freeSlots(busy, d, g.wd);
}

function meetingForm(data, ctx) {
  const draft = ctx.mtgDraft;
  const m = draft ?? (data.events ?? []).find((o) => o.id === ctx.selMtg);
  if (!m) return "";
  const isNew = !!draft;
  const lock = !isNew && m.source === "mcp" ? "disabled" : "";
  const projects = data.projects ?? [];
  const autoId = matchProject(m.title, (data.settings?.projectRules ?? []).filter((r) => projects.some((p) => p.id === r.projectId)));
  const autoName = projects.find((p) => p.id === autoId)?.name ?? "未設定";
  const cur = isNew ? (m.projectId ?? "") : m.projectBy === "manual" ? m.projectId : "";
  const projOpts = [`<option value=""${cur === "" ? " selected" : ""}>自動（規則）→ ${esc(autoName)}</option>`, ...projects.map((p) => `<option value="${esc(p.id)}"${cur === p.id ? " selected" : ""}>${esc(p.name)}</option>`)].join("");
  return `<div class="mtgform" role="group" aria-label="会議の${isNew ? "追加" : "編集"}">
    <label>件名<input class="in" data-mt="title" value="${esc(m.title)}" placeholder="会議名" style="min-width:200px" ${lock}></label>
    <label>日付<input class="in" type="date" data-mt="date" value="${esc(m.date)}" ${lock}></label>
    <label>開始<input class="in" type="time" step="900" data-mt="start" value="${esc(m.start)}" ${lock}></label>
    <label>終了<input class="in" type="time" step="900" data-mt="end" value="${esc(m.end)}" ${lock}></label>
    <label>プロジェクト<select class="in" data-mt="projectId" aria-label="会議のプロジェクト">${projOpts}</select></label>
    <label class="chk"><input type="checkbox" data-mt="skip" ${m.skip ? "checked" : ""}>参加しない(空き時間として扱う)</label>
    <div style="display:flex;gap:6px;align-items:center">${isNew ? `<button class="btn" data-mtgsave>追加</button><button class="btn" data-mtgcancel>キャンセル</button>` : `${m.source === "manual" ? `<button class="btn danger" data-delsel>会議を削除</button>` : ""}<button class="btn" data-mtgclose>閉じる</button>`}</div>
    ${!isNew && m.source === "manual" ? `<p class="note" style="flex-basis:100%;margin:0">カレンダー上でドラッグして移動（別の日へも）、下端をドラッグして長さを変えられます。</p>` : ""}${!isNew && m.source === "mcp" ? `<p class="note" style="flex-basis:100%;margin:0">予定表から取得した会議です。件名と時間は取得内容が正のため変更できません。プロジェクトは、規則で自動に付き、ここで手動に変えられます。出席しない会議は「参加しない」にします（削除しても、次の取得で戻ります）。</p>` : ""}
  </div>`;
}

/** カレンダー部分（週または日）＋凡例。会議の編集中はここだけを描き直す */
export function renderCalendar(data, today, opts) {
  const { view = "week", date = today } = opts;
  const ctx = { now: opts.now ?? { date: today, time: "00:00" }, selSess: opts.selSess ?? null, selMtg: opts.selMtg ?? null, showSkipped: opts.showSkipped === true };
  const g = calendarGeometry(data);
  const isOff = offDayChecker(data.settings);
  let cal;
  if (view === "week") {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStartOf(date), i));
    const heads = days.map((d) => {
      const free = freeOf(data, d, g, isOff).reduce((a, x) => a + toMin(x.end) - toMin(x.start), 0);
      return `<button class="dh ${d === today ? "t" : ""}" data-day="${d}" aria-label="${fmtMD(d)}の1日表示">${fmtMD(d)}(${wdJa(d)})<small class="mono">${isOff(d) ? "—" : `空き ${(free / 60).toFixed(1)}h`}</small></button>`;
    }).join("");
    const cols = days.map((d) => `<div class="col dz ${d === today ? "today" : ""} ${isOff(d) ? "weekend" : ""}" data-date="${d}">${meetingBlocks(data, d, false, g, ctx)}${sessionBlocks(data, d, false, g, ctx)}</div>`).join("");
    const dues = days.map((d) => {
      const due = data.tasks.filter((t) => t.due === d && t.status !== "Done" && t.status !== "Cancelled");
      return `<div class="duecell">${due.map((t) => `<div style="display:flex;gap:6px;align-items:baseline"><i class="dot ${STATUS_UI[t.status]?.dot ?? ""}${t.due < today ? " is-late" : ""}"></i><span>${esc(t.title)}</span></div>`).join("") || '<span class="muted">—</span>'}</div>`;
    }).join("");
    cal = `<div class="cal wk"><div class="week"><div></div>${heads}<div class="hrs">${hoursHtml(g)}</div>${cols}</div><div class="week" style="margin-top:8px"><div class="note" style="padding-top:6px">期限</div>${dues}</div></div>
      <p class="note" style="margin:8px 0 0">日付を押すと1日表示に切り替わります。枠をクリックして選び、「枠を削除」か Delete キーで削除できます。</p>`;
  } else {
    const free = freeOf(data, date, g, isOff).filter((x) => toMin(x.end) - toMin(x.start) >= 20);
    const fb = free.map((x) => `<button class="free" data-free="${toMin(x.start)}" style="top:calc(${g.pc(toMin(x.start)).toFixed(3)}% + 1px);height:calc(${(g.pc(toMin(x.end)) - g.pc(toMin(x.start))).toFixed(3)}% - 3px)" aria-label="空き ${x.start}から${x.end}">${x.start}-${x.end} 空き</button>`).join("");
    const nowLine = date === ctx.now.date && toMin(ctx.now.time) >= g.h0 && toMin(ctx.now.time) <= g.h0 + g.span ? `<span class="nowline" style="top:${g.tp(toMin(ctx.now.time))}" title="現在 ${ctx.now.time}"></span>` : "";
    const offKinds = data.settings?.countWeekendsAndHolidays === true ? "休み" : "土日・日本の祝日・休み"; // 土日祝を営業日に数える設定のときは、手動の休みだけが休みの日
    const offNote = isOff(date) ? `<p class="note" style="margin:0 0 8px">この日は休みです（${offKinds}）。作業枠は置けません。設定タブの「営業日として扱う日」に指定すると置けます。</p>` : "";
    cal = `${offNote}<div class="cal"><div class="cal-grid">${hoursHtml(g)}<div class="cal-body dz" id="calbody" data-date="${date}">${meetingBlocks(data, date, true, g, ctx)}${sessionBlocks(data, date, true, g, ctx)}${fb}${nowLine}</div></div></div>`;
  }
  const day = view === "day";
  const legend = `<div class="slegend" aria-label="色の凡例"><span><i class="sw mtg"></i>会議</span>${ctx.showSkipped ? '<span><i class="sw skipsw"></i>参加しない会議</span>' : ""}<span><i class="sw mtgun"></i>未確認の会議</span><span><i class="sw plan"></i>予定</span><span><i class="sw act"></i>実績(✓)</span><span><i class="sw unconf"></i>未確認(過ぎた予定)</span>${day ? '<span><i class="sw free"></i>空き時間</span><span><i class="sw now"></i>現在時刻</span>' : ""}<span><i class="sw sel"></i>選択中</span></div>`;
  return cal + legend;
}

/**
 * @param opts.view      "week" | "day"
 * @param opts.date      表示する日（週表示ではその日を含む週）
 * @param opts.now       {date, time}  現在時刻（過ぎた予定の判定に使う）
 * @param opts.selSess   選択中の枠 ID / opts.selMtg 選択中の会議 ID / opts.mtgDraft 追加中の会議の下書き
 * @param opts.picked    選択中のタスク ID（キーボード配置用）
 * @param opts.showPrio  false なら今日の優先を出さない
 * @param opts.showSkipped  true なら「参加しない」の会議も出す（既定は出さない。選択中の会議だけは、隠さない。空き時間の計算は変わらない）
 */
export function renderSchedule(data, today, opts) {
  const { view = "week", date = today } = opts;
  const now = opts.now ?? { date: today, time: "00:00" };
  const step = view === "week" ? 7 : 1;
  const days = view === "week" ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStartOf(date), i)) : [date];
  const title = view === "week" ? `${fmtMD(days[0])}〜${fmtMD(days[6])} の週` : `${fmtMD(date)}(${wdJa(date)})`;
  const inView = allSessions(data).filter((s) => days.includes(s.date));
  const kinds = inView.map((s) => sessionKind(s, now));
  const hours = inView.filter((s, i) => kinds[i] === "actual").reduce((a, s) => a + toMin(s.end) - toMin(s.start), 0) / 60;
  const planned = kinds.filter((k) => k === "planned").length;
  const unconfS = kinds.filter((k) => k === "unconfirmed").length;
  const unconfM = (data.events ?? []).filter((m) => days.includes(m.date) && meetingKind(m, now) === "unconfirmed").length;
  const unconf = unconfS + unconfM;
  const selSess = inView.find((s) => s.id === opts.selSess);
  const selMtg = (data.events ?? []).find((m) => m.id === opts.selMtg && days.includes(m.date));
  const delLabel = selSess ? `「${esc(selSess.title)}」の枠を削除` : selMtg && selMtg.source === "manual" ? `会議「${esc(selMtg.title)}」を削除` : "枠や会議を選んで削除";
  const delOk = !!selSess || (selMtg && selMtg.source === "manual");
  const calOpts = { ...opts, view, date, now, selSess: selSess?.id ?? null, selMtg: selMtg?.id ?? null };

  const nav = `<div class="toolbar"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="btn" data-nav="${-step}" aria-label="前へ">←</button><button class="btn" data-nav="${step}" aria-label="次へ">→</button><button class="btn" data-sgoto>今日</button><strong style="margin-left:6px">${title}</strong></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="chip-btn pref" data-sskip aria-pressed="${opts.showSkipped === true}" title="「参加しない」にした会議を、カレンダーに出したり隠したりします">参加しない会議</button><button class="btn" data-mtgadd>＋ 会議を追加</button><div class="seg" role="group" aria-label="表示"><button data-sview="week" aria-pressed="${view === "week"}">週</button><button data-sview="day" aria-pressed="${view === "day"}">日</button></div></div></div>
    <div class="summary"><span>実績 <b class="mono">${hours.toFixed(1)}時間</b></span><span>予定 <b class="mono">${planned}件</b></span>${unconf ? `<span class="pill wait">未確認 ${unconf}件（作業枠 ${unconfS}・会議 ${unconfM}）</span><button class="btn" data-confirmall>未確認をすべて実績にする</button>` : ""}<button class="btn danger" data-delsel ${delOk ? "" : "disabled"}>${delLabel}</button></div>`;
  return `<div class="cols${opts.showPrio === false ? " one" : ""}"><section class="panel">${nav}<div id="mtgslot">${meetingForm(data, { mtgDraft: opts.mtgDraft, selMtg: selMtg?.id })}</div><div id="calslot">${renderCalendar(data, today, calOpts)}</div></section>${renderSideToggle(opts.showPrio !== false)}${opts.showPrio === false ? "" : renderSide(data, today, { sched: true, picked: opts.picked, pendingDone: opts.pendingDone })}</div>`;
}

