// 使い方: node tools/inbox.js <コマンド> <data.json> ...   （コマンドの一覧は引数なしで実行すると出る）
// HTML の「Claude Code に依頼する」の受信箱（data.json の inbox）を、Claude Code から扱う。結果は JSON で標準出力へ。
// list・get は data.json を書かない。それ以外は、書く直前にファイルを読み直して、検証に通ったときだけ書く。
import { CAUSES } from "../src/core/schema.js";
import { today } from "../src/core/dates.js";
import { readJson, out, save } from "./cli.js";
import {
  submitRequest, claimRequest, askQuestion, setProposal, rejectRequest, markApplied, markFailed, touchWatching, getRequest,
} from "../src/core/inbox.js";
import { planOps, applyProposal, summarizeSections } from "../src/ui/inboxops.js";
import { fetchHolidays, holidayStatus, needsHolidayUpdate } from "./holidays.js";

const USAGE = `使い方: node tools/inbox.js <コマンド> <data.json> ...
  submit  <data.json> <projectId|-> <text> [--working]   依頼を足す（--working は処理中として作る。文章の取り込み用）
  list    <data.json>                             依頼の一覧
  get     <data.json> <id>                        依頼 1 件（やりとり・提案つき）
  wait    <data.json> [--timeout <秒>]            依頼を待つ。1 行 1 イベントの JSON を出し続ける
  claim   <data.json> <id>                        受け取る（pending → working）
  ask     <data.json> <id> <text>                 聞き返す（→ question）
  propose <data.json> <id> <ops.json> [--summary <文>] [--reason <文>] [--cause <原因>]   提案を書く（→ proposed）
  approve <data.json> <id>                        承認して適用する（proposed のときだけ）
  reject  <data.json> <id>                        却下する
  fail    <data.json> <id> <message>              できない・失敗として返す`;

const now = () => new Date().toISOString();
const usage = () => { console.error(USAGE); process.exit(2); };

const COMMANDS = {
  submit: [3, (d, [path, pid, text], o) => {
    const next = submitRequest(d, { text, projectId: pid === "-" ? null : pid, now: now(), working: o.working === true });
    save(path, next);
    const r = next.inbox.requests.at(-1);
    out({ ok: true, id: r.id, status: r.status });
  }],
  list: [1, (d) => out((d.inbox?.requests ?? []).map((r) => ({ id: r.id, at: r.at, status: r.status, projectId: r.projectId, text: (r.thread[0]?.text ?? "").slice(0, 80) })))],
  get: [2, (d, [, id]) => {
    const r = getRequest(d, id);
    if (!r) throw new Error(`依頼 ${id} がありません`);
    out(r);
  }],
  claim: [2, (d, [path, id]) => { save(path, claimRequest(d, id, now())); out(getRequest(readJson(path), id)); }],
  ask: [3, (d, [path, id, text]) => { save(path, askQuestion(d, id, text, now())); out({ ok: true, id, status: "question" }); }],
  propose: [3, async (d, [path, id, opsFile], o) => {
    const cause = o.cause ?? "その他";
    if (!CAUSES.includes(cause)) throw new Error(`原因は ${CAUSES.join("・")} のいずれかにしてください`);
    const ops = readJson(opsFile);
    let plan = planOps(d, ops, { today: today() });
    // 営業日で期限を置く提案は、日本の祝日が未取得・古い・範囲外なら、提案の前に取得する（取れなくても提案は止めず、注意に書く）
    if (ops.some((x) => x.op === "addTask" && x.businessDays !== undefined)) {
      const lastDue = (s) => s.sections.flatMap((x) => x.rows).filter((r) => r.businessDays != null).map((r) => r.due).sort().at(-1);
      if (needsHolidayUpdate(d.settings, lastDue(plan)).need) {
        let nationalHolidays = null;
        try { nationalHolidays = await fetchHolidays(); } catch { /* 下で注意に書く */ }
        d = readJson(path); // 取得の間（最長 15 秒）に他が更新していても消さないよう、書く直前に読み直す
        if (nationalHolidays) d = { ...d, settings: { ...d.settings, nationalHolidays } };
        plan = planOps(d, ops, { today: today() });
        if (!nationalHolidays) plan.warnings.push("祝日を取得できませんでした（手動登録の休みだけで計算）");
      }
      const to = holidayStatus(d.settings).to;
      if (to && d.settings?.countWeekendsAndHolidays !== true && lastDue(plan) > to) plan.warnings.push(`祝日の一覧は ${to} までです。それ以降は手動登録の休みだけで計算しています`);
    }
    const summary = o.summary ?? `提案: ${summarizeSections(plan.sections)}`;
    const proposal = { ...plan, summary, reason: o.reason ?? summary, cause };
    save(path, setProposal(d, id, proposal, now()));
    out({ ok: true, id, status: "proposed", sections: plan.sections, warnings: plan.warnings });
  }],
  approve: [2, (d, [path, id]) => {
    const r = getRequest(d, id);
    if (!r) throw new Error(`依頼 ${id} がありません`);
    if (r.status !== "proposed") throw new Error(`依頼 ${id} は ${r.status} なので、承認できません`);
    let applied;
    try {
      applied = applyProposal(d, r.proposal, { reason: r.proposal.reason, cause: r.proposal.cause, today: today() });
    } catch (e) {
      if (e.code === "stale") save(path, markFailed(d, id, e.message, now()));
      throw e;
    }
    save(path, markApplied(applied, id, { by: "claude", summary: `${summarizeSections(r.proposal.sections)}を反映しました`, now: now() }));
    out({ ok: true, id, status: "applied" });
  }],
  reject: [2, (d, [path, id]) => { save(path, rejectRequest(d, id, now())); out({ ok: true, id, status: "rejected" }); }],
  fail: [3, (d, [path, id, message]) => { save(path, markFailed(d, id, message, now())); out({ ok: true, id, status: "failed" }); }],
};

/** 依頼を待つ。起動時に届いている pending、待っている間に届いた pending・返信・再提案を出す。30 秒ごとに「見ている印」を書く */
function wait(path, o) {
  const interval = Number(o.interval ?? 2000), timeoutMs = Number(o.timeout ?? 0) * 1000;
  const announced = new Set();
  const started = Date.now();
  let lastBeat = 0;
  const emit = (e) => console.log(JSON.stringify(e));
  const tick = () => {
    let d;
    try { d = readJson(path); } catch { return; } // 書き込みの途中などで読めないときは、次の回に
    if (Date.now() - lastBeat >= 30000) {
      lastBeat = Date.now();
      try { save(path, touchWatching(readJson(path), now())); } catch { /* 次の回にもう一度試す */ }
    }
    for (const r of d.inbox?.requests ?? []) {
      const key = `${r.id}:${r.thread.length}`;
      if (r.status === "pending" && !announced.has(key)) { announced.add(key); emit({ event: "request", id: r.id, status: "pending" }); }
    }
    if (timeoutMs && Date.now() - started >= timeoutMs) { clearInterval(timer); emit({ event: "end" }); }
  };
  const timer = setInterval(tick, interval);
  tick();
}

// --flag 値 を取り除いて、残りを位置引数にする
const argv = process.argv.slice(2);
const FLAGS = ["summary", "reason", "cause", "timeout", "interval"];
const opts = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const f = /^--(\w+)$/.exec(argv[i])?.[1];
  if (f === "working") { opts.working = true; } else if (f && FLAGS.includes(f)) {
    if (i + 1 >= argv.length) { console.error(`--${f} の値がありません`); process.exit(2); }
    opts[f] = argv[++i];
  } else rest.push(argv[i]);
}
const [cmd, ...args] = rest;
if (cmd === "wait") {
  if (!args[0]) usage();
  wait(args[0], opts);
} else {
  const spec = COMMANDS[cmd];
  if (!spec || args.length < spec[0]) usage();
  try {
    await spec[1](readJson(args[0]), args, opts);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
