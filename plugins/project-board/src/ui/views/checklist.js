// チェックリストの編集欄（リストの展開行と、ガントの編集の窓が共用）。
// 属性（data-ck*）は app.js のイベントが読む: data-ckbox（タスク）・data-ckid（項目の行）・data-ckmv（並び替えの取っ手）・
//   data-ckdone（チェック）・data-cktext（文言）・data-ckdel（削除）・data-ckadd（追加欄）。値は「タスクID|項目ID」。
import { checklistOf } from "../../core/checklist.js";
import { esc, checkMeterHtml } from "../common.js";

export function checklistEditorHtml(t) {
  const id = esc(t.id);
  const rows = checklistOf(t).map((c) => {
    const key = `${id}|${esc(c.id)}`;
    return `<div class="ck-row" data-ckid="${esc(c.id)}"><span class="mv" draggable="true" data-ckmv="${key}" title="ドラッグで並べ替え" aria-label="${esc(c.text)} を並べ替え">⠿</span><input type="checkbox" data-ckdone="${key}"${c.done ? " checked" : ""} aria-label="済み"><input class="in${c.done ? " done" : ""}" data-cktext="${key}" value="${esc(c.text)}" aria-label="項目"><button class="gx" data-ckdel="${key}" aria-label="${esc(c.text)} を削除">×</button></div>`;
  }).join("");
  return `<div class="ckedit" data-ckbox="${id}"><div class="ck-head"><b>チェックリスト</b> ${checkMeterHtml(t)}</div>${rows}<div class="ck-add"><input class="in" data-ckadd="${id}" placeholder="項目を追加（Enter で追加）" aria-label="項目を追加"></div></div>`;
}
