// タスクの期限が動いたときの影響範囲。次のタスクは「最小限だけ」動かす（前のタスクの新しい期限を超えないようにする）。
import { addDays } from "./dates.js";
import { isClosed } from "./schema.js";

/**
 * opts.compress: 前倒し(deltaDays < 0)のとき、次のタスクも同じ日数だけ前倒しする(前のタスクの新しい期限より前にはしない)
 */
export function computeImpact(data, taskId, deltaDays, { compress = false } = {}) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const target = byId.get(taskId);

  const successors = new Map(); // 前のタスクID → 次のタスクの配列
  for (const t of data.tasks) {
    for (const p of t.predecessors ?? []) {
      if (!successors.has(p)) successors.set(p, []);
      successors.get(p).push(t);
    }
  }

  const newDue = new Map([[taskId, addDays(target.due, deltaDays)]]);
  const reason = new Map();
  const queue = [taskId];
  if (compress && deltaDays < 0) {
    // 期限は減る方向にしか更新しないので、循環があっても止まる
    while (queue.length) {
      const cur = queue.shift();
      for (const s of successors.get(cur) ?? []) {
        if (s.id === taskId || isClosed(s)) continue;
        const lower = s.predecessors.map((p) => newDue.get(p) ?? byId.get(p)?.due).filter(Boolean).reduce((a, b) => (a > b ? a : b), "");
        const shifted = addDays(s.due, deltaDays);
        const cand = lower > shifted ? lower : shifted;
        if (cand < (newDue.get(s.id) ?? s.due)) {
          newDue.set(s.id, cand);
          reason.set(s.id, `前のタスク ${cur} の前倒し`);
          queue.push(s.id);
        }
      }
    }
    queue.length = 0;
  }
  // 期限は増える方向にしか更新しないので、循環があっても既存の期限の最大値で止まる
  while (queue.length) {
    const cur = queue.shift();
    for (const s of successors.get(cur) ?? []) {
      if (s.id === taskId || isClosed(s)) continue;
      let best = s.due;
      let by = null;
      for (const p of s.predecessors) {
        const d = newDue.get(p); // 動いた前のタスクだけが対象（元からの不整合は直さない）
        if (d && d > best) { best = d; by = p; }
      }
      if (best > (newDue.get(s.id) ?? s.due)) {
        newDue.set(s.id, best);
        reason.set(s.id, `前のタスク ${by} の遅れ`);
        queue.push(s.id);
      }
    }
  }

  const changes = [...newDue].map(([id, nd]) => ({
    taskId: id,
    oldDue: byId.get(id).due,
    newDue: nd,
    reason: id === taskId ? `指定（${deltaDays >= 0 ? "+" : ""}${deltaDays}日）` : reason.get(id),
  })).filter((c) => c.oldDue !== c.newDue || c.taskId === taskId);

  const projectDueExceeded = [];
  for (const p of data.projects) {
    const latest = data.tasks.filter((t) => t.projectId === p.id).map((t) => newDue.get(t.id) ?? t.due)
      .reduce((a, b) => (a > b ? a : b), "");
    const moved = changes.some((c) => byId.get(c.taskId).projectId === p.id && c.newDue > p.due);
    if (moved) projectDueExceeded.push({ projectId: p.id, due: p.due, latestTaskDue: latest });
  }
  return { changes, projectDueExceeded };
}

