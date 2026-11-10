// 会議のプロジェクト規則（件名のキーワード → プロジェクト）。すべて不変更新。
// 手動で付けたもの（projectBy: "manual"）は、規則の再適用で変えない。

/** text が keyword を含む最初の規則の projectId。大文字小文字は区別せず、空の keyword は無視する */
export function matchProject(text, rules) {
  const t = String(text ?? "").toLowerCase();
  for (const r of rules) {
    const k = String(r?.keyword ?? "").trim().toLowerCase();
    if (k && t.includes(k)) return r.projectId;
  }
  return null;
}

/** 手動以外の会議に、規則でプロジェクトを付け直す（当たらなければ、規則で付けた分だけ外す）。存在しないプロジェクトの規則は無視する */
export function assignMeetingProjects(data) {
  const ids = new Set(data.projects.map((p) => p.id));
  const rules = (data.settings?.projectRules ?? []).filter((r) => ids.has(r.projectId));
  const events = data.events.map((e) => {
    // 手動、または projectBy の無い projectId（手で書かれたもの）は変えない
    if (e.projectBy === "manual" || (e.projectBy == null && e.projectId)) return e;
    const m = matchProject(e.title, rules);
    if (m) return e.projectId === m && e.projectBy === "rule" ? e : { ...e, projectId: m, projectBy: "rule" };
    if (e.projectBy == null) return e;
    const { projectBy, ...rest } = e;
    void projectBy;
    return { ...rest, projectId: null };
  });
  return { ...data, events };
}

const sameKey = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** 規則を追加（同じ keyword なら置き換え）して、会議へ反映する */
export function setProjectRule(data, keyword, projectId) {
  const k = String(keyword ?? "").trim();
  if (!k) throw new Error("キーワードを入力してください");
  if (!data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  const rules = data.settings?.projectRules ?? [];
  const next = rules.some((r) => sameKey(r.keyword, k))
    ? rules.map((r) => (sameKey(r.keyword, k) ? { keyword: k, projectId } : r))
    : [...rules, { keyword: k, projectId }];
  return assignMeetingProjects({ ...data, settings: { ...data.settings, projectRules: next } });
}

/** 規則を消して、会議へ反映する（手動のひも付けは残る） */
export function removeProjectRule(data, keyword) {
  const rules = (data.settings?.projectRules ?? []).filter((r) => !sameKey(r.keyword, keyword));
  return assignMeetingProjects({ ...data, settings: { ...data.settings, projectRules: rules } });
}

/** 規則を 1 つ上（delta = -1）・下（delta = 1）へ動かし、会議へ付け直す（上の規則が先に当たるため）。端では動かさない。不明なキーワードは例外 */
export function moveProjectRule(data, keyword, delta) {
  const rules = data.settings?.projectRules ?? [];
  const at = rules.findIndex((r) => sameKey(r.keyword, keyword));
  if (at < 0) throw new Error(`キーワード「${keyword}」の規則がありません`);
  const to = at + delta;
  if (to < 0 || to >= rules.length) return data;
  const next = [...rules];
  [next[at], next[to]] = [next[to], next[at]];
  return assignMeetingProjects({ ...data, settings: { ...data.settings, projectRules: next } });
}

/** 規則のキーワードを書き換える（順序とプロジェクトは保つ）。会議へ付け直す。空・不明な元・他の規則と同じキーワードは例外 */
export function renameProjectRule(data, oldKeyword, newKeyword) {
  const k = String(newKeyword ?? "").trim();
  if (!k) throw new Error("キーワードを入力してください");
  const rules = data.settings?.projectRules ?? [];
  const at = rules.findIndex((r) => sameKey(r.keyword, oldKeyword));
  if (at < 0) throw new Error(`キーワード「${oldKeyword}」の規則がありません`);
  if (rules.some((r, i) => i !== at && sameKey(r.keyword, k))) throw new Error(`キーワード「${k}」の規則がすでにあります`);
  const next = rules.map((r, i) => (i === at ? { ...r, keyword: k } : r));
  return assignMeetingProjects({ ...data, settings: { ...data.settings, projectRules: next } });
}

/** 規則の並びで、その規則で付いている会議（projectBy が rule）の件数。複数の規則に当たる会議は、先の規則だけが数える */
export function ruleMeetingCounts(data) {
  const rules = data.settings?.projectRules ?? [];
  const ids = new Set((data.projects ?? []).map((p) => p.id));
  const counts = rules.map(() => 0);
  for (const e of data.events) {
    if (e.projectBy !== "rule") continue;
    const t = String(e.title ?? "").toLowerCase();
    const at = rules.findIndex((r) => ids.has(r.projectId) && String(r.keyword ?? "").trim() && t.includes(String(r.keyword).trim().toLowerCase()));
    if (at >= 0) counts[at]++;
  }
  return counts;
}
