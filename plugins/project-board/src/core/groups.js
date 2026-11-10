// 大項目（group）・中項目（subgroup）の扱い（純関数）。階層の集計はせず、見出しに使う文字列として持つ。

const DEFAULT_LABELS = { group: "大項目", subgroup: "中項目" };

/** 画面での見出しの呼び名。settings.labels の非空の文字列で上書きできる */
export function groupLabels(settings) {
  const l = settings?.labels ?? {};
  const pick = (k) => (typeof l[k] === "string" && l[k].trim() ? l[k].trim() : DEFAULT_LABELS[k]);
  return { group: pick("group"), subgroup: pick("subgroup") };
}

/**
 * 大項目の最初の登場順に、その中は中項目の最初の登場順に束ねる。タスクの順序は保つ。未設定は空文字。
 * 大項目が空の組は最後のブロックに置く。ensureNone なら、(空, 空) の組がなくても空の組を末尾に足す（追加の入口にするため）
 */
export function groupSections(tasks, { ensureNone = false } = {}) {
  const out = [];
  const at = new Map();
  for (const t of tasks) {
    const group = t.group ?? "", subgroup = t.subgroup ?? "";
    const key = `${group}\u0000${subgroup}`;
    if (!at.has(key)) { at.set(key, out.length); out.push({ group, subgroup, tasks: [] }); }
    out[at.get(key)].tasks.push(t);
  }
  const first = new Map();
  out.forEach((s, i) => { if (!first.has(s.group)) first.set(s.group, i); });
  // 大項目の最初の登場位置で並べ（安定ソート）、大項目が空の組は最後に回す
  out.sort((a, b) => (a.group === "") - (b.group === "") || first.get(a.group) - first.get(b.group));
  if (ensureNone && !out.some((s) => s.group === "" && s.subgroup === "")) out.push({ group: "", subgroup: "", tasks: [] });
  return out;
}
