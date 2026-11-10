// ガントチャートでタスク名・バーをクリックしたときに開く、編集の小さな窓。
// 入力の属性（data-f・data-id・data-addpre・data-rmpre）は、リストの編集欄と同じ。保存と描き直しは、リストと同じ処理が受け持つ。
// 窓を閉じる ×: data-tpopclose / 窓: data-tpop。「リストで開く」は data-goto、削除は data-del（どちらも既存の処理）
import { esc, fmtMD } from "../common.js";
import { taskStart } from "../../core/metrics.js";
import { predecessorCandidates } from "../edit.js";
import { checklistEditorHtml } from "./checklist.js";

/** 前のタスクの外し方（×）と足し方（選択）。リストの編集欄と共用 */
export function predEditHtml(data, t) {
  const chips = (t.predecessors ?? []).map((id) => `<span class="chip">${esc(id)}<button data-rmpre="${esc(t.id)}|${esc(id)}" aria-label="${esc(id)} を前のタスクから外す">×</button></span>`).join("");
  const cand = predecessorCandidates(data, t.id).map((id) => data.tasks.find((u) => u.id === id));
  const add = cand.length ? `<select class="in sm" data-addpre="${esc(t.id)}" aria-label="前のタスクを追加"><option value="">＋前のタスク</option>${cand.map((u) => `<option value="${esc(u.id)}">${esc(u.id)} ${esc(u.title)}</option>`).join("")}</select>` : "";
  return `<div class="chips">${chips}${add}</div>`;
}

/** 開始日の入力。指定がなく前のタスクがあるときは、前のタスクの期限から決まる日を入れて「前のタスクから」と添える（空にすると指定を外す） */
export function startInputHtml(data, t) {
  const derived = !t.start && (t.predecessors ?? []).length > 0;
  const hint = derived ? ` <small class="muted" title="開始日を指定していないので、前のタスクの期限から決まります">前のタスクから</small>` : "";
  return `<input class="in" type="date" data-f="start" data-id="${esc(t.id)}" value="${esc(t.start || (derived ? taskStart(data, t.id) : ""))}" aria-label="${esc(t.id)} の開始日">${hint}`;
}

/**
 * @param pop { id, x, y }  クリックした位置（画面の座標）。置き場所の調整は呼び出し側（画面の端に収める）
 * @param statusHtml 状態の欄（リストと同じ。待ち先・Done の確認の表示を含む）
 */
export function renderTaskPop(data, pop, statusHtml) {
  const t = data.tasks.find((x) => x.id === pop.id);
  if (!t) return "";
  const id = esc(t.id);
  const field = (label, inner) => `<label class="tp-f"><span class="muted">${label}</span>${inner}</label>`;
  const importance = [["", "—"], ["high", "高"]].map(([v, l]) => `<option value="${v}" ${(t.importance ?? "") === v ? "selected" : ""}>${l}</option>`).join("");
  return `<div class="tpop" role="dialog" aria-label="${id} を編集" data-tpop style="left:${Math.round(pop.x)}px;top:${Math.round(pop.y)}px">
    <div class="tp-h"><b class="mono">${id}</b><span class="muted">${fmtMD(taskStart(data, t.id))}〜${fmtMD(t.due)}</span><button class="gx" data-tpopclose aria-label="編集を閉じる" style="opacity:1">×</button></div>
    ${field("件名", `<input class="in" data-f="title" data-id="${id}" value="${esc(t.title)}">`)}
    <div class="tp-f"><span class="muted">状態</span><div>${statusHtml}</div></div>
    <div class="tp-r">${field("開始", startInputHtml(data, t))}${field("期限", `<input class="in" type="date" data-f="due" data-id="${id}" value="${esc(t.due)}">`)}</div>
    ${checklistEditorHtml(t)}
    <div class="tp-f"><span class="muted">前のタスク</span>${predEditHtml(data, t)}</div>
    <div class="tp-r">${field("重要度", `<select class="in sm" data-f="importance" data-id="${id}">${importance}</select>`)}</div>
    ${field("メモ", `<input class="in" data-f="memo" data-id="${id}" value="${esc(t.memo ?? "")}" placeholder="メモ">`)}
    <div class="tp-a"><button class="btn" data-goto="${id}">リストで開く</button><button class="btn danger" data-del="${id}">削除</button></div>
  </div>`;
}
