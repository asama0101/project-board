// プロジェクト画面: 絞り込み × ガント／リスト、右に「今日のタスク」「今日の優先」
import { projectProgress, projectFlags, taskFlags } from "../../core/metrics.js";
import { taskActual } from "../../core/sessions.js";
import { projectHours } from "../../core/workload.js";
import { TASK_STATUS, PROJECT_STATUS, PROJECT_TYPE } from "../../core/schema.js";
import { esc, fmtMD, flagPills } from "../common.js";
import { groupLabels, groupSections } from "../../core/groups.js";
import { renderGantt } from "./gantt.js";
import { renderSide, renderSideToggle, todayTaskIds, doneAskHtml } from "./prio.js";
import { renderTaskPop, predEditHtml, startInputHtml } from "./taskpop.js";
import { checklistEditorHtml } from "./checklist.js";
import { checklistCount } from "../../core/checklist.js";

const actText = (data, id) => {
  const a = taskActual(data, id);
  return a.count ? `${a.hours.toFixed(1)}h${a.firstDate ? "・初回 " + fmtMD(a.firstDate) : ""}・${a.count}回` : "—";
};

/** 状態の欄（選択。待ち先の入力・Done の確認が出ているときは、その表示）。リストとガントの編集の窓で共用 */
function statusCellHtml(t, opts, late) {
  const id = esc(t.id);
  if (opts.pendingWait === t.id) {
    return `<div class="ask" style="max-width:none">待ち先を入力<input class="in" data-waitparty="${id}" placeholder="ベンダー・部署名" aria-label="${id} の待ち先"><div style="display:flex;gap:6px;margin-top:4px"><button class="btn" data-waitok="${id}">Waiting にする</button><button class="btn" data-waitno>やめる</button></div></div>`;
  }
  if (opts.pendingDone?.id === t.id && !opts.todayIds?.has(t.id)) return doneAskHtml(opts.pendingDone);
  return `<select class="in" data-f="status" data-id="${id}" aria-label="${id} の状態">${TASK_STATUS.map((o) => `<option ${o === t.status ? "selected" : ""}>${o}</option>`).join("")}</select>${late ? ` <span class="pill late">期限超過</span>` : ""}`;
}

/** リストの「チェック」列。押すと、その行の下に編集欄が開く（開いているタスクは opts.checkOpen の Set） */
function checkCell(t, opts) {
  const { total, done } = checklistCount(t);
  const open = !!opts.checkOpen?.has(t.id);
  const label = total ? `${open ? "▾" : "▸"} ${done}/${total}` : "＋ 追加";
  return `<button class="ck-toggle${total ? "" : " ck-empty"}" data-cktoggle="${esc(t.id)}" aria-expanded="${open}" aria-label="${esc(t.id)} のチェックリスト">${label}</button>`;
}

function renderList(data, p, today, opts) {
  const prog = projectProgress(data, p.id);
  const tasks = data.tasks.filter((t) => t.projectId === p.id);
  const labels = groupLabels(data.settings);
  const rowOf = (t) => {
    const needParty = t.status === "Waiting" && !t.waitingOn?.party ? `<span class="pill wait">待ち先を入力</span>` : "";
    const dependents = data.tasks.filter((o) => (o.predecessors ?? []).includes(t.id)).map((o) => o.id);
    const delCell = opts.askDel === t.id
      ? `<div class="ask">${dependents.length ? `次のタスク ${esc(dependents.join(", "))} の前のタスクから外れます。` : "このタスクを削除します。"}<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-delyes="${esc(t.id)}">削除する</button><button class="btn" data-delno>やめる</button></div></div>`
      : `<button class="btn" data-del="${esc(t.id)}" aria-label="${esc(t.id)} を削除">削除</button>`;
    const late = taskFlags(t, today, data.settings).includes("overdue");
    return `<tr data-row="${esc(t.id)}" data-mvrow="${esc(t.id)}"><td class="id" data-l="ID"><span class="mv" draggable="true" data-mvh="${esc(t.id)}" title="ドラッグで並べ替え" aria-label="${esc(t.id)} を並べ替え">⠿</span>${esc(t.id)}</td>
      <td data-l="${esc(labels.group)}"><input class="in gi" data-f="group" data-id="${esc(t.id)}" value="${esc(t.group ?? "")}" aria-label="${esc(t.id)} の${esc(labels.group)}"></td>
      <td data-l="${esc(labels.subgroup)}"><input class="in gi" data-f="subgroup" data-id="${esc(t.id)}" value="${esc(t.subgroup ?? "")}" aria-label="${esc(t.id)} の${esc(labels.subgroup)}"></td>
      <td data-l="件名"><input class="in" id="f-${esc(t.id)}-t" data-f="title" data-id="${esc(t.id)}" value="${esc(t.title)}" aria-label="${esc(t.id)} の件名"></td>
      <td data-l="状態">${statusCellHtml(t, opts, late)}</td>
      <td data-l="開始">${startInputHtml(data, t)}</td>
      <td data-l="期限"><input class="in" type="date" data-f="due" data-id="${esc(t.id)}" value="${esc(t.due)}" aria-label="${esc(t.id)} の期限"></td>
      <td data-l="前のタスク">${predEditHtml(data, t)}</td>
      <td data-l="待ち先"><input class="in" data-f="party" data-id="${esc(t.id)}" value="${esc(t.waitingOn?.party ?? "")}" placeholder="${t.status === "Waiting" ? "ベンダー・部署名" : "—"}" ${t.status === "Waiting" ? "" : "disabled"} aria-label="${esc(t.id)} の待ち先">${needParty}</td>
      <td data-l="重要度"><select class="in sm" data-f="importance" data-id="${esc(t.id)}" aria-label="${esc(t.id)} の重要度">${[["", "—"], ["high", "高"]].map(([v, l]) => `<option value="${v}" ${(t.importance ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td data-l="メモ"><input class="in" data-f="memo" data-id="${esc(t.id)}" value="${esc(t.memo ?? "")}" placeholder="メモ" aria-label="${esc(t.id)} のメモ"></td>
      <td data-l="チェック">${checkCell(t, opts)}</td>
      <td data-l="実績" class="mono muted">${actText(data, t.id)}</td><td data-l="">${delCell}</td></tr>${opts.checkOpen?.has(t.id) ? `<tr class="ck-tr" data-ckpanel="${esc(t.id)}"><td colspan="14">${checklistEditorHtml(t)}</td></tr>` : ""}`;
  };
  // (大項目, 中項目) ごとに見出し行を入れて並べる。「＋」はそのグループへ追加する入口なので、0 件でも「（なし）」を出す
  const secs = groupSections(tasks, { ensureNone: true });
  const rows = secs.map((sec) => {
    const name = `${sec.group || "（なし）"}${sec.subgroup ? ` ▸ ${sec.subgroup}` : ""}`;
    return `<tr class="grp-tr" data-mvgrp="${esc(p.id)}" data-mvg="${esc(sec.group)}" data-mvsg="${esc(sec.subgroup)}"><td colspan="14"><b>${esc(sec.group || "（なし）")}</b>${sec.subgroup ? ` <span class="muted">▸ ${esc(sec.subgroup)}</span>` : ""} <button class="plus" data-addat="${esc(p.id)}" data-ag="${esc(sec.group)}" data-asg="${esc(sec.subgroup)}" aria-label="${esc(name)} にタスクを追加">＋</button></td></tr>${sec.tasks.map(rowOf).join("")}`;
  }).join("");

  const projTaskIds = new Set(tasks.map((t) => t.id));
  const log = data.changeLog.filter((l) => l.source == null || Number(l.deltaDays) !== 0).filter((l) => (l.taskIds ?? []).some((id) => projTaskIds.has(id)))
    .map((l) => `<li><span class="d">${fmtMD(l.at)}</span><span><span class="pill">${esc(l.cause ?? "—")}</span> ${esc(l.reason)} <span class="mono muted">(${esc((l.taskIds ?? []).join(", "))}・${Number(l.deltaDays) > 0 ? "+" : ""}${Number(l.deltaDays)}日)</span></span></li>`).join("")
    || `<li class="muted">変更履歴はありません。</li>`;

  const ms = (p.milestones ?? []).map((m, i) => `<div class="msrow"><input class="in" data-mf="name" data-pid="${esc(p.id)}" data-i="${i}" value="${esc(m.name)}" aria-label="マイルストーン名"><input class="in sm" type="date" data-mf="date" data-pid="${esc(p.id)}" data-i="${i}" value="${esc(m.date)}" aria-label="マイルストーンの日付"><button class="btn" data-msdel="${esc(p.id)}|${i}" aria-label="${esc(m.name)} を削除">削除</button></div>`).join("")
    || '<p class="muted" style="margin:0">マイルストーンはありません。</p>';

  const delProj = opts.askDelProject === p.id
    ? `<span class="ask" style="max-width:none">プロジェクトと配下のタスク ${tasks.length} 件を削除します。 <button class="btn danger" data-pdelyes="${esc(p.id)}">削除する</button> <button class="btn" data-pdelno>やめる</button></span>`
    : `<button class="btn" data-pdel="${esc(p.id)}">プロジェクトを削除</button>`;

  return `<section class="panel" aria-label="${esc(p.name)}"><div class="pstick"><div class="prow"><h2><input class="in" data-pf="name" data-pid="${esc(p.id)}" value="${esc(p.name)}" style="font-size:17px;font-weight:700" aria-label="プロジェクト名"></h2><label>状態 <select class="in sm" data-pf="status" data-pid="${esc(p.id)}" aria-label="${esc(p.name)} の状態">${PROJECT_STATUS.map((o) => `<option ${o === p.status ? "selected" : ""}>${o}</option>`).join("")}</select></label></div><div class="phead"><div><div class="kv" style="align-items:center">
      <label>種別 <select class="in sm" data-pf="type" data-pid="${esc(p.id)}" aria-label="種別">${PROJECT_TYPE.map((o) => `<option ${o === p.type ? "selected" : ""}>${o}</option>`).join("")}</select></label>
      <label>開始 <input class="in sm" type="date" data-pf="start" data-pid="${esc(p.id)}" value="${esc(p.start)}" aria-label="${esc(p.name)} の開始日"></label>
      <label>期限 <input class="in sm" type="date" data-pf="due" data-pid="${esc(p.id)}" value="${esc(p.due)}" aria-label="${esc(p.name)} の期限"></label>
      <span>進捗 <b class="mono">${prog.done}/${prog.total}</b> (${Math.round(prog.rate * 100)}%)</span><span class="mono hrs">${(() => { const hh = projectHours(data, p.id); return `稼働 ${(hh.task + hh.meeting).toFixed(1)}h（タスク ${hh.task.toFixed(1)}h・会議 ${hh.meeting.toFixed(1)}h）`; })()}</span></div></div><div>${flagPills(data, p.id, today, projectFlags(data, p.id, today))}</div></div>
    </div><div class="twrap"><div class="thstrip" aria-hidden="true"></div><div class="tscroll tlist"><table class="tbl edit"><thead><tr><th>ID</th><th>${esc(labels.group)}</th><th>${esc(labels.subgroup)}</th><th>件名</th><th>状態</th><th>開始</th><th>期限</th><th>前のタスク</th><th>待ち先</th><th>重要度</th><th>メモ</th><th>チェック</th><th>実績</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap"><span class="note">変更はその場でファイルに保存されます。次のタスクの日程をまとめて見直すときは、画面の下端の「Claude Code に依頼する」に頼みます。</span></div>
    <h2 style="margin:18px 0 8px;font-size:13px">マイルストーン</h2>
    <div class="mslist">${ms}<div><button class="btn" data-msadd="${esc(p.id)}">＋ マイルストーンを追加</button> <span class="note">ガントに◆で表示されます。</span></div></div>
    <h2 style="margin:18px 0 2px;font-size:13px">日程変更の履歴</h2><p class="note" style="margin:0 0 8px">日程が動いたとき、いつ・何が・なぜ動いたか(原因: ベンダー／社内／自分)の記録です。「Claude Code に依頼する」で期限の変更を反映したときに記録されます。画面で期限を直接変えたときは記録されません。</p><ul class="log">${log}</ul>
    <div style="margin-top:18px">${delProj}</div></section>`;
}

/**
 * @param opts.filter  "all" か projectId
 * @param opts.view    "gantt" | "list"
 * @param opts.window  ガントの表示期間
 * @param opts.tpop    ガントの編集の窓({ id, x, y })。なければ出さない
 * @param opts.showPrio / opts.showActual  今日の優先・ガントの実績を出すか(既定は出す)
 */
export function renderProjects(data, today, opts = {}) {
  const { view = "gantt", hideDone = false, showPrio = true, showActual = true } = opts;
  const addBtn = `<button class="btn" data-addproject>＋ プロジェクトを追加</button>`;
  if (!data.projects.length) {
    return `<div class="toolbar"><div></div>${addBtn}</div><section class="panel"><p class="muted" style="margin:0">プロジェクトがありません。「＋ プロジェクトを追加」から追加してください。</p></section>`;
  }
  const filter = opts.filter && data.projects.some((p) => p.id === opts.filter) ? opts.filter : "all";
  const ids = filter === "all" ? data.projects.map((p) => p.id) : [filter];
  // チップは、状態が「完了」のプロジェクトを出さない(選択中のあいだだけ出す)。完了のものも、プルダウンから選べる
  const chips = [["all", "すべて"], ...data.projects.filter((p) => p.status !== "完了" || p.id === filter).map((p) => [p.id, p.name])]
    .map(([k, l]) => `<button class="chip-btn" data-filter="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("");
  const pick = `<label class="pfilter">プロジェクト <select class="in sm" data-projectpick aria-label="プロジェクト名で絞り込み"><option value="all"${filter === "all" ? " selected" : ""}>すべて</option>${data.projects.map((p) => `<option value="${esc(p.id)}"${p.id === filter ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`;
  const todayIds = showPrio ? new Set(todayTaskIds(data, today)) : new Set();
  const body = view === "gantt"
    ? `<section class="panel"><h2 class="sr">ガントチャート</h2>${renderGantt(data, ids, today, { window: opts.window, hideDone, askDel: opts.askDel, showActual, addAt: opts.addAt })}</section>`
    : `<div style="display:flex;flex-direction:column;gap:16px">${ids.map((id) => renderList(data, data.projects.find((p) => p.id === id), today, { ...opts, todayIds })).join("")}</div>`;
  const pt = view === "gantt" && opts.tpop ? data.tasks.find((t) => t.id === opts.tpop.id) : null;
  const pop = pt ? renderTaskPop(data, opts.tpop, statusCellHtml(pt, { ...opts, todayIds }, taskFlags(pt, today, data.settings).includes("overdue"))) : "";
  // チップはプロジェクトの数だけ並ぶので、1 行に収めて横にスクロールする(折り返すと、固定の行が高くなり、表が見えなくなる)。プロジェクト名のプルダウンと追加ボタンは、スクロールの外
  return `<div class="toolbar ptool"><div class="chips-row" role="group" aria-label="プロジェクトで絞り込み">${chips}</div>
    <div class="ptool-end">${pick}${addBtn}</div></div>
    <div class="cols${showPrio ? "" : " one"}">${body}${renderSideToggle(showPrio)}${showPrio ? renderSide(data, today, { sched: false, pendingDone: opts.pendingDone }) : ""}</div>${pop}`;
}
