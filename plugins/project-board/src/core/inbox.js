// 受信箱（HTML から Claude Code への依頼）のデータ操作。すべて不変更新の純関数。now は ISO 日時の文字列（呼び出し側が渡す）。
// 依頼: { id, at, projectId, status, thread: [{ role: "user"|"claude", at, text }], proposal, result }。状態の遷移は下の表のとおりで、合わない遷移は例外にする。
export const MAX_REQUESTS = 20;
export const MAX_TEXT = 4000;
export const WATCH_FRESH_MS = 90000;

const FINISHED = ["applied", "rejected", "failed"];
const emptyInbox = (d) => d.inbox ?? { watching: null, requests: [] };
const requestsOf = (d) => emptyInbox(d).requests;
const withInbox = (d, patch) => ({ ...d, inbox: { watching: null, ...emptyInbox(d), ...patch } });

export const getRequest = (data, id) => requestsOf(data).find((r) => r.id === id);

/** 20 件を超えたら、完了（applied・rejected・failed）の古いものから消す。処理中は消さない */
export function pruneRequests(requests) {
  let over = requests.length - MAX_REQUESTS;
  if (over <= 0) return requests;
  const drop = new Set();
  for (const r of requests) {
    if (over <= 0) break;
    if (FINISHED.includes(r.status)) { drop.add(r.id); over--; }
  }
  return requests.filter((r) => !drop.has(r.id));
}

function checkText(text, label) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error(`${label}を入力してください`);
  if (t.length > MAX_TEXT) throw new Error(`${label}は ${MAX_TEXT} 文字までにしてください`);
  return t;
}

const pushThread = (r, role, at, text) => [...r.thread, { role, at, text }];

/** id の依頼を、許された状態からだけ変える。fn(依頼) が新しい依頼を返す */
function transition(data, id, from, to, fn) {
  const r = getRequest(data, id);
  if (!r) throw new Error(`依頼 ${id} がありません`);
  if (!from.includes(r.status)) throw new Error(`依頼 ${id} は ${r.status} なので、${to} にできません`);
  const next = { ...fn(r), status: to };
  return withInbox(data, { requests: requestsOf(data).map((x) => (x.id === id ? next : x)) });
}

/** 依頼を足す（状態 pending）。履歴は 20 件まで */
export function submitRequest(data, { text, projectId = null, now, working = false }) {
  const t = checkText(text, "依頼");
  if (projectId != null && !data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  const reqs = requestsOf(data);
  const n = reqs.reduce((m, r) => Math.max(m, Number(/^R(\d+)$/.exec(r.id)?.[1] ?? 0)), 0) + 1;
  const r = { id: `R${n}`, at: now, projectId, status: working ? "working" : "pending", thread: [{ role: "user", at: now, text: t }], proposal: null, result: null, ...(working ? { claimedAt: now } : {}) };
  return withInbox(data, { requests: pruneRequests([...reqs, r]) });
}

export const claimRequest = (data, id, now) => transition(data, id, ["pending"], "working", (r) => ({ ...r, claimedAt: now }));

export const askQuestion = (data, id, text, now) =>
  transition(data, id, ["working"], "question", (r) => ({ ...r, thread: pushThread(r, "claude", now, checkText(text, "質問")) }));

/** 利用者の返信（聞き返しへの答え、提案への修正の依頼）。提案は消えて、pending に戻る */
export const replyToRequest = (data, id, text, now) =>
  transition(data, id, ["question", "proposed", "failed"], "pending", (r) => ({ ...r, thread: pushThread(r, "user", now, checkText(text, "返信")), proposal: null }));

export const setProposal = (data, id, proposal, now) =>
  transition(data, id, ["working", "proposed"], "proposed", (r) => ({ ...r, thread: pushThread(r, "claude", now, checkText(proposal.summary || "提案を作りました", "提案の要約")), proposal }));

export const rejectRequest = (data, id, now) =>
  transition(data, id, ["pending", "working", "question", "proposed"], "rejected", (r) => ({ ...r, result: { at: now, by: null, summary: "却下" } }));

/** 反映済みにする。proposed のときだけ（二重適用の防止）。by: "html" | "claude" */
export const markApplied = (data, id, { by, summary, now }) =>
  transition(data, id, ["proposed"], "applied", (r) => ({ ...r, result: { at: now, by, summary } }));

export const markFailed = (data, id, message, now) =>
  transition(data, id, ["pending", "working", "question", "proposed"], "failed", (r) => ({ ...r, thread: pushThread(r, "claude", now, checkText(message, "理由")), proposal: null }));

/** 失敗した依頼を、もう一度提案してもらう（pending に戻す） */
export const retryRequest = (data, id, now) =>
  transition(data, id, ["failed"], "pending", (r) => ({ ...r, thread: pushThread(r, "user", now, "もう一度提案してください"), proposal: null }));

export const touchWatching = (data, now) => withInbox(data, { watching: { at: now } });

/** Claude Code が見ているか（印が WATCH_FRESH_MS 以内） */
export function isWatching(data, nowMs) {
  const at = Date.parse(emptyInbox(data).watching?.at ?? "");
  return Number.isFinite(at) && nowMs - at <= WATCH_FRESH_MS;
}
