// タスクを Done・Cancelled にするとき、確認が要るものを調べる（データは変えない）。changeStatus が使う。
import { futurePlanned } from "../core/sessions.js";
import { checklistOf } from "../core/checklist.js";

/**
 * open: Done にするとき、未チェックの項目の文言（Cancelled など他の状態では空）
 * future: Done・Cancelled にすると解除される、未来の予定枠の ID
 */
export function planDone(data, id, status, now) {
  const t = data.tasks.find((x) => x.id === id);
  const open = status === "Done" ? checklistOf(t).filter((c) => !c.done).map((c) => c.text) : [];
  const future = status === "Done" || status === "Cancelled" ? futurePlanned(data, id, now) : [];
  return { open, future };
}
