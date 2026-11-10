// 画面下端の「Claude Code に依頼する」の帯と引き出し（依頼の入力・履歴・提案のカード）。描画のみで、副作用はない。
// 属性: 開閉 data-ib-toggle / 対象 data-ib-project / 入力 data-ib-text / 例 data-ib-example / 送信 data-ib-send /
//       提案 data-ib-reason・data-ib-cause・data-ib-approve・data-ib-reply・data-ib-replysend・data-ib-reject（処理待ち・処理中にも出す）/ 再提案 data-ib-retry（値は依頼の ID）
import { CAUSES } from "../../core/schema.js";
import { isWatching } from "../../core/inbox.js";
import { addDays } from "../../core/dates.js";
import { esc, fmtMD } from "../common.js";

const STATUS = {
  pending: ["送信済み", "wait"], working: ["処理中", "wait"], question: ["聞き返しがあります", "warn"], proposed: ["提案があります", "ok"],
  applied: ["反映済み", "done"], rejected: ["却下", "off"], failed: ["失敗", "bad"],
};
const EXAMPLES = [["due", "期限が動いた"], ["add", "タスクを登録"]];

/** 「書き方の例」で入る文。対象のプロジェクト（空なら先頭のタスクのプロジェクト）の、終わっていないタスクの ID を使う（なければ終わったもの、タスクが 0 件のときだけ A1）。
 *  別のプロジェクトの ID を混ぜない（依頼が「別のプロジェクトです」で失敗する）。登録の期限の例は、今日の 14 日後 */
export function ibExamples(data, projectId, today) {
  const all = data?.tasks ?? [];
  const pid = projectId || all[0]?.projectId;
  const pool = all.filter((t) => t.projectId === pid);
  const ids = [...pool.filter((t) => t.status !== "Done"), ...pool.filter((t) => t.status === "Done")].map((t) => t.id);
  const a = ids[0] ?? "A1";
  return {
    due: `${a} が 5 日遅れた（原因: ベンダー）。`,
    add: `次を登録して: 結合テスト ${addDays(today, 14)} 大項目▸中項目 前のタスク ${a}`,
  };
}

const two = (n) => String(n).padStart(2, "0");
/** ISO 日時 → 「10/21 14:32」（この端末の時刻） */
function fmtAt(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function sectionHtml(s) {
  if (s.kind === "due") {
    const rows = s.rows.map((r) => `<tr><td class="id">${esc(r.taskId)}</td><td>${esc(r.title)}</td><td class="mono">${fmtMD(r.oldDue)}</td><td class="mono"><b>${fmtMD(r.newDue)}</b></td><td>${esc(r.reason)}</td></tr>`).join("");
    return `<div class="ib-sec"><b>期限の変更（${s.rows.length} 件）</b><table class="tbl"><thead><tr><th>ID</th><th>件名</th><th>旧期限</th><th>新期限</th><th>理由</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (s.kind === "add") {
    const rows = s.rows.map((r, i) => `<tr data-row="${i + 1}"><td class="mono">${i + 1}</td><td>${esc(r.title)}${(r.checklist ?? []).length ? ` <span class="muted">（項目 ${r.checklist.length} 件）</span>` : ""}</td><td>${r.group ? esc(r.group) : "（なし）"}${r.subgroup ? ` ▸ ${esc(r.subgroup)}` : ""}</td><td class="mono">${esc(r.businessDays ?? "—")}</td><td class="mono">${fmtMD(r.due)}</td><td class="mono">${(r.predecessors ?? []).length ? esc(r.predecessors.join(", ")) : "—"}</td></tr>`).join("");
    return `<div class="ib-sec"><b>タスクの登録（${s.rows.length} 件）</b><table class="tbl"><thead><tr><th>#</th><th>件名</th><th>大項目 ▸ 中項目</th><th>営業日</th><th>期限</th><th>前のタスク</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return "";
}

const threadHtml = (r) => r.thread.slice(1).map((m) => `<div class="ib-msg ${m.role}"><span class="muted">${m.role === "user" ? "あなた" : "Claude Code"}</span> ${esc(m.text)}</div>`).join("");

function detailHtml(data, r, ui) {
  if (r.status === "proposed" && r.proposal) {
    const p = r.proposal;
    const reason = ui.reasons?.[r.id] ?? p.reason ?? "";
    const cause = ui.causes?.[r.id] ?? p.cause ?? "その他";
    const warns = (p.warnings ?? []).map((w) => `<div class="ib-warn">${esc(w)}</div>`).join("");
    return `<div class="ib-card">${threadHtml(r)}${p.sections.map((s) => sectionHtml(s)).join("")}${warns}
      <div class="ib-ctl"><label>原因<select class="in" data-ib-cause="${esc(r.id)}" aria-label="原因">${CAUSES.map((c) => `<option${c === cause ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label style="flex:1 1 220px">変更履歴に残す理由<input class="in" data-ib-reason="${esc(r.id)}" value="${esc(reason)}" aria-label="変更履歴に残す理由"></label></div>
      <div class="ib-act"><button class="btn primary" data-ib-approve="${esc(r.id)}">承認して反映する</button><button class="btn" data-ib-reject="${esc(r.id)}">却下する</button></div>
      <div class="ib-ctl"><input class="in" data-ib-reply="${esc(r.id)}" value="${esc(ui.replies?.[r.id] ?? "")}" placeholder="修正の依頼（例: A5 は 5 営業日にして）" aria-label="修正の依頼" style="flex:1 1 240px"><button class="btn warm" data-ib-replysend="${esc(r.id)}">修正を依頼する</button></div></div>`;
  }
  if (r.status === "pending" || r.status === "working") {
    // 見張りが止まって、受け取られない・処理が止まった依頼を、画面から取り下げられるようにする
    return `<div class="ib-card">${threadHtml(r)}<div class="ib-act"><button class="btn" data-ib-reject="${esc(r.id)}">却下する</button></div></div>`;
  }
  if (r.status === "question") {
    return `<div class="ib-card">${threadHtml(r)}<div class="ib-ctl"><input class="in" data-ib-reply="${esc(r.id)}" value="${esc(ui.replies?.[r.id] ?? "")}" placeholder="返信" aria-label="返信" style="flex:1 1 240px"><button class="btn primary" data-ib-replysend="${esc(r.id)}">返信する</button></div></div>`;
  }
  if (r.status === "failed") {
    return `<div class="ib-card">${threadHtml(r)}<div class="ib-act"><button class="btn" data-ib-retry="${esc(r.id)}">もう一度提案してもらう</button></div></div>`;
  }
  if (r.status === "applied" && r.result) {
    return `<div class="ib-card muted">${esc(r.result.summary)}（${r.result.by === "claude" ? "Claude Code で承認" : "この画面で承認"}）</div>`;
  }
  return "";
}

/**
 * @param ui { open, canWrite, nowMs, text, projectId, replies, reasons, causes }  text は入力の下書き、projectId は対象（""＝すべて）
 */
export function renderInboxBar(data, ui) {
  if (!ui.canWrite) {
    return `<div class="ib ib-off"><div class="ib-bar"><b>Claude Code に依頼する</b><span class="ib-hint">この機能には、ファイルへの直接保存が必要です（Edge か Chrome で、データファイルを開いて使います）</span></div></div>`;
  }
  const reqs = data.inbox?.requests ?? [];
  const proposed = reqs.filter((r) => r.status === "proposed").length;
  const watching = isWatching(data, ui.nowMs);
  const state = `<span class="ib-state ${watching ? "on" : "off"}"><i></i>${watching ? "Claude Code が見ています" : "Claude Code が見ていません"}</span>`;
  const badge = proposed ? `<span class="ib-badge">提案が ${proposed} 件届いています</span>` : "";
  const head = `<div class="ib-bar"><button class="ib-toggle" data-ib-toggle aria-expanded="${ui.open}">${ui.open ? "▼ 閉じる" : "▲ 開く"}</button><b>Claude Code に依頼する</b>${ui.open ? "" : `<span class="ib-hint">「A3 が 5 日遅れた」「このタスクを登録して」など</span>`}<span class="ib-sp"></span>${badge}${state}</div>`;
  if (!ui.open) return `<div class="ib">${head}</div>`;

  const projects = data.projects ?? [];
  const select = `<select class="in" data-ib-project aria-label="対象のプロジェクト"><option value="">すべて</option>${projects.map((p) => `<option value="${esc(p.id)}"${p.id === ui.projectId ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
  const examples = EXAMPLES.map(([k, l]) => `<button class="ib-ex" data-ib-example="${k}">${l}</button>`).join("");
  const history = [...reqs].reverse().map((r) => {
    const [label, tone] = STATUS[r.status] ?? [r.status, "off"];
    const proj = r.projectId ? (projects.find((p) => p.id === r.projectId)?.name ?? r.projectId) : "すべて";
    return `<li class="ib-req" data-ib-req="${esc(r.id)}" data-status="${esc(r.status)}"><div class="ib-rh"><span class="mono muted">${esc(fmtAt(r.at))}</span><span class="pill ${tone}">${label}</span><span class="muted">対象: ${esc(proj)}</span></div><div class="ib-rt">${esc(r.thread[0]?.text ?? "")}</div>${detailHtml(data, r, ui)}</li>`;
  }).join("");
  const hint = watching ? "" : `<div class="ib-note">Claude Code が見ていないようです。Claude Code で <span class="mono">/project-board:watch</span> を実行すると、依頼を受け取ります。</div>`;
  return `<div class="ib open">${head}<section class="ib-drawer" role="dialog" aria-label="Claude Code に依頼する"><div class="ib-body">
    <div class="ib-compose"><div class="ib-row"><label>対象 ${select}</label><span class="muted">書き方の例（押すと入ります）:</span>${examples}</div>
      <label for="ib-text" class="muted">依頼（文章で。複数の種類を、まとめて書いても構いません）</label>
      <textarea id="ib-text" class="in" data-ib-text rows="7">${esc(ui.text)}</textarea>
      <div class="ib-row"><button class="btn primary" data-ib-send>依頼を送る</button><span class="muted">送ると、依頼がファイルに書かれます。承認するまで、タスクは変わりません。</span></div>${hint}</div>
    <div class="ib-hist"><div class="muted">これまでの依頼</div>${history ? `<ul class="ib-reqs">${history}</ul>` : `<p class="muted" style="margin:6px 0">まだ依頼はありません。</p>`}</div>
  </div></section></div>`;
}
