import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REQUESTS, MAX_TEXT, WATCH_FRESH_MS,
  submitRequest, pruneRequests, claimRequest, askQuestion, replyToRequest, setProposal, rejectRequest,
  markApplied, markFailed, retryRequest, touchWatching, isWatching, getRequest,
} from "../plugins/project-board/src/core/inbox.js";

const NOW = "2026-10-21T10:00:00.000Z";
const later = (s) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const base = () => ({ projects: [{ id: "A" }], tasks: [], events: [], changeLog: [] });
const withReq = (status, extra = {}) => ({ ...base(), inbox: { watching: null, requests: [{ id: "R1", at: NOW, projectId: null, status, thread: [{ role: "user", at: NOW, text: "依頼" }], proposal: null, result: null, ...extra }] } });
const status = (d, id = "R1") => getRequest(d, id).status;

test("定数: 履歴 20 件・1 メッセージ 4000 文字・見ている印 90 秒", () => {
  assert.deepEqual([MAX_REQUESTS, MAX_TEXT, WATCH_FRESH_MS], [20, 4000, 90000]);
});

test("submitRequest: R1・pending・thread 1 件。連番は履歴の最大＋1。元のデータは変えない", () => {
  const d0 = base();
  const d1 = submitRequest(d0, { text: "  A3 が 5 日遅れた  ", projectId: "A", now: NOW });
  const r = getRequest(d1, "R1");
  assert.deepEqual([r.status, r.projectId, r.at, r.proposal, r.result], ["pending", "A", NOW, null, null]);
  assert.deepEqual(r.thread, [{ role: "user", at: NOW, text: "A3 が 5 日遅れた" }]);
  assert.equal(getRequest(submitRequest(d1, { text: "2 件目", now: NOW }), "R2").projectId, null);
  assert.equal(d0.inbox, undefined);
  const gap = { ...base(), inbox: { watching: null, requests: [{ ...r, id: "R7", status: "applied" }] } };
  assert.ok(getRequest(submitRequest(gap, { text: "x", now: NOW }), "R8"));
});

test("submitRequest: 空・4000 文字超・不明なプロジェクトは例外", () => {
  assert.throws(() => submitRequest(base(), { text: "   ", now: NOW }), /依頼/);
  assert.throws(() => submitRequest(base(), { text: "あ".repeat(MAX_TEXT + 1), now: NOW }), /4000/);
  assert.throws(() => submitRequest(base(), { text: "x", projectId: "ZZ", now: NOW }), /ZZ/);
  assert.doesNotThrow(() => submitRequest(base(), { text: "あ".repeat(MAX_TEXT), now: NOW }));
});

test("pruneRequests: 20 件を超えたら完了の古いものから消し、処理中は消さない", () => {
  const mk = (i, st) => ({ id: `R${i}`, at: NOW, projectId: null, status: st, thread: [], proposal: null, result: null });
  const done = Array.from({ length: 25 }, (_, i) => mk(i + 1, "applied"));
  assert.deepEqual(pruneRequests(done).map((r) => r.id), done.slice(5).map((r) => r.id));
  const active = [...Array.from({ length: 21 }, (_, i) => mk(i + 1, "working")), mk(22, "applied"), mk(23, "rejected"), mk(24, "failed")];
  const kept = pruneRequests(active);
  assert.equal(kept.filter((r) => r.status === "working").length, 21, "処理中は消えない");
  assert.equal(kept.length, 21, "完了 3 件が消える");
  assert.equal(pruneRequests(done.slice(0, 20)).length, 20);
});

test("submitRequest: 履歴が 21 件になったら、完了の最古が消える", () => {
  let d = base();
  for (let i = 0; i < 20; i++) d = submitRequest(d, { text: `依頼${i}`, now: NOW });
  for (const r of d.inbox.requests) r.status = "applied";
  d = submitRequest(d, { text: "新しい依頼", now: NOW });
  assert.equal(d.inbox.requests.length, 20);
  assert.equal(d.inbox.requests.at(-1).thread[0].text, "新しい依頼");
  assert.equal(getRequest(d, "R1"), undefined);
});

test("状態の遷移: pending → working → proposed → applied（by・summary・at が result に残る）", () => {
  let d = withReq("pending");
  d = claimRequest(d, "R1", later(1));
  assert.equal(status(d), "working");
  d = setProposal(d, "R1", { summary: "2 件を変更します", ops: [], sections: [], warnings: [], base: {} }, later(2));
  assert.equal(status(d), "proposed");
  assert.equal(getRequest(d, "R1").thread.at(-1).role, "claude");
  d = markApplied(d, "R1", { by: "html", summary: "反映しました", now: later(3) });
  assert.deepEqual([status(d), getRequest(d, "R1").result], ["applied", { at: later(3), by: "html", summary: "反映しました" }]);
});

test("markApplied: proposed のときだけ。2 回目（二重適用）は例外", () => {
  const d = markApplied(withReq("proposed"), "R1", { by: "claude", summary: "s", now: NOW });
  assert.throws(() => markApplied(d, "R1", { by: "html", summary: "s", now: NOW }), /applied/);
  for (const st of ["pending", "working", "question", "rejected", "failed"]) {
    assert.throws(() => markApplied(withReq(st), "R1", { by: "html", summary: "s", now: NOW }), new RegExp(st), st);
  }
});

test("askQuestion → replyToRequest: 質問が thread に入り、返信で pending に戻り、提案は消える", () => {
  let d = askQuestion(withReq("working"), "R1", "どのプロジェクトですか", later(1));
  assert.equal(status(d), "question");
  assert.equal(getRequest(d, "R1").thread.at(-1).text, "どのプロジェクトですか");
  d = replyToRequest(d, "R1", "A です", later(2));
  assert.deepEqual([status(d), getRequest(d, "R1").thread.at(-1)], ["pending", { role: "user", at: later(2), text: "A です" }]);
  const p = replyToRequest(withReq("proposed", { proposal: { summary: "s", ops: [] } }), "R1", "A5 は 5 日に", NOW);
  assert.equal(getRequest(p, "R1").proposal, null);
  assert.throws(() => replyToRequest(withReq("applied"), "R1", "x", NOW), /applied/);
});

test("rejectRequest・markFailed・retryRequest", () => {
  assert.equal(status(rejectRequest(withReq("proposed"), "R1", NOW)), "rejected");
  assert.throws(() => rejectRequest(withReq("applied"), "R1", NOW), /applied/);
  const f = markFailed(withReq("proposed"), "R1", "提案のあとにデータが変わりました", NOW);
  assert.deepEqual([status(f), getRequest(f, "R1").thread.at(-1).text], ["failed", "提案のあとにデータが変わりました"]);
  assert.throws(() => markFailed(withReq("applied"), "R1", "x", NOW), /applied/);
  const r = retryRequest(f, "R1", later(5));
  assert.equal(status(r), "pending");
  assert.equal(getRequest(r, "R1").proposal, null);
  assert.throws(() => retryRequest(withReq("proposed"), "R1", NOW), /proposed/);
});

test("遷移: 不明な ID は例外", () => {
  assert.throws(() => claimRequest(withReq("pending"), "R9", NOW), /R9/);
  assert.throws(() => claimRequest(withReq("working"), "R1", NOW), /working/);
});

test("isWatching: 89 秒前は true、91 秒前・null・印なしは false。touchWatching が印を書く", () => {
  const d = touchWatching(base(), NOW);
  assert.equal(d.inbox.watching.at, NOW);
  const ms = Date.parse(NOW);
  assert.equal(isWatching(d, ms + 89000), true);
  assert.equal(isWatching(d, ms + 91000), false);
  assert.equal(isWatching(base(), ms), false);
  assert.equal(isWatching({ ...base(), inbox: { watching: null, requests: [] } }, ms), false);
});

test("submitRequest: working を指定すると、working・claimedAt つきで作る。そのまま提案まで進める", () => {
  const d = submitRequest(base(), { text: "文章の要約", projectId: "A", now: NOW, working: true });
  const r = getRequest(d, "R1");
  assert.equal(r.status, "working");
  assert.equal(r.claimedAt, NOW);
  assert.equal(status(setProposal(d, "R1", { summary: "案", sections: [], ops: [] }, later(1))), "proposed");
  assert.equal(getRequest(submitRequest(base(), { text: "x", now: NOW }), "R1").status, "pending");
});

test("setProposal: 提案済み（proposed）の依頼にも、直した提案を差し替えられる（行番号で直してもう一度 propose）", () => {
  const first = setProposal(withReq("working"), "R1", { summary: "1 回目", sections: [], ops: [] }, later(1));
  const second = setProposal(first, "R1", { summary: "直した案", sections: [], ops: [] }, later(2));
  assert.equal(status(second), "proposed");
  assert.equal(getRequest(second, "R1").proposal.summary, "直した案");
  assert.throws(() => setProposal(withReq("applied"), "R1", { summary: "x", sections: [], ops: [] }, later(3)), /applied/);
});
