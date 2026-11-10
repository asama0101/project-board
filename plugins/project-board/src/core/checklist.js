// タスクのチェックリスト（task.checklist = [{ id, text, done }]）の読み取り用の小さな道具。純関数。
// checklist がないタスクは「チェックリストなし」として扱う。

/** タスクの項目の一覧（なければ空の配列） */
export const checklistOf = (t) => t.checklist ?? [];

/** 全体・済み・未チェックの件数 */
export function checklistCount(t) {
  const items = checklistOf(t);
  const done = items.filter((x) => x.done).length;
  return { total: items.length, done, open: items.length - done };
}

/** 次の項目 ID。既存の c<数字> の最大番号 + 1（なければ c1） */
export function nextChecklistId(items) {
  const max = items.reduce((m, x) => Math.max(m, +(/^c(\d+)$/.exec(x.id)?.[1] ?? 0)), 0);
  return `c${max + 1}`;
}
