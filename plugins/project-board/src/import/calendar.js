// 予定表（Outlook など、利用者が用意した MCP）から取得した会議の取り込み。
// 取得範囲内の MCP 由来の会議だけを追加・更新・削除し、手入力の会議と「参加しない」は保つ。続けてプロジェクトの規則を適用する。
import { syncMcpEvents, meetingPast } from "../core/schedule.js";
import { assignMeetingProjects } from "../core/rules.js";

const DEFAULT_ROOM_KEYWORDS = ["会議室"];

/**
 * 自分だけ・自分と会議室だけの予定を、取り込みの対象から外す（純関数。引数は変えない）。
 * fetched の各予定の attendees は [{type: "person"|"resource", email, name}]。項目がない予定は、参加者が不明なので残す。
 * 自分 = email が cfg.selfEmails のどれかと一致、または name が cfg.selfNames のどれかと一致（どちらも、前後の空白と大文字小文字を区別しない完全一致。予定表が email を表示名に置き換えて返すときのため、名前でも特定できる）。会議室 = type が "resource"、または name が cfg.roomKeywords（既定は「会議室」）を含む。
 * 自分と会議室を除いて参加者が 0 人（空の配列を含む）なら対象外。selfEmails も selfNames も未設定なら、自分を特定できないので何も除かない（参加者つきの予定があれば警告）。
 */
export function excludeSolo(fetched, cfg = {}) {
  const norm = (list) => new Set((list ?? []).map((e) => e.trim().toLowerCase())); // 空でない文字列の配列かは、validateMcpConfig が確かめている
  const selfs = norm(cfg?.selfEmails), selfNames = norm(cfg?.selfNames);
  if (!selfs.size && !selfNames.size) {
    const warnings = fetched.some((f) => Array.isArray(f.attendees)) ? ["自分のメールアドレス（selfEmails）も名前（selfNames）も設定されていない（または設定を読めていない）ため、対象外の判定をしていません。/project-board:mcp で設定してください"] : [];
    return { kept: fetched, excluded: [], warnings };
  }
  const keywords = (cfg.roomKeywords ?? DEFAULT_ROOM_KEYWORDS).map((k) => k.trim().toLowerCase());
  const isSelf = (a) => selfs.has(String(a.email ?? "").trim().toLowerCase()) || selfNames.has(String(a.name ?? "").trim().toLowerCase());
  const isRoom = (a) => a.type === "resource" || keywords.some((k) => String(a.name ?? "").toLowerCase().includes(k));
  const solo = (f) => Array.isArray(f.attendees) && f.attendees.every((a) => a && typeof a === "object" && (isSelf(a) || isRoom(a))); // 形が崩れた要素（null・文字列）がある予定は、不明として残す
  const warnings = fetched.length && !fetched.some((f) => Array.isArray(f.attendees)) ? ["どの予定にも参加者の情報がないため、対象外の判定ができていません。予定表の MCP が参加者を返すか、確認してください"] : [];
  return { kept: fetched.filter((f) => !solo(f)), excluded: fetched.filter(solo), warnings };
}

/** fetched = {externalId, title, date, start, end, attendees?}[]、range = {start, end}、cfg = {selfEmails, selfNames, roomKeywords}（excludeSolo を参照）。data は変えない */
export function planCalendarSync(data, fetched, range, cfg) {
  const { kept, excluded, warnings } = excludeSolo(fetched, cfg);
  const next = assignMeetingProjects(syncMcpEvents(data, kept, range, new Set(excluded.map((f) => f.externalId))));
  const before = new Map(data.events.map((e) => [e.id, e]));
  const after = new Map(next.events.map((e) => [e.id, e]));
  return {
    added: next.events.filter((e) => !before.has(e.id)),
    updated: next.events.filter((e) => before.has(e.id) && JSON.stringify(before.get(e.id)) !== JSON.stringify(e)).map((e) => ({ before: before.get(e.id), after: e })),
    removed: data.events.filter((e) => !after.has(e.id)),
    excluded,
    warnings,
    data: next,
  };
}

/**
 * 自動更新（`/project-board:intake calendar` と見張りが使う。承認の確認なしで書く）。planCalendarSync の結果から、次を取り除く。
 * - 終わった会議と確認済みの会議（実績になる）の、更新と削除。変えずに残し、held に出す（now = {date, time}）。
 * - 取得が 0 件のときの削除（取得の失敗かもしれない）。変えずに残し、blocked に出す。
 * 戻り値は planCalendarSync と同じ形に、held（[{id, title, date, change: "updated"|"removed"}]）と blocked（null か {reason, count}）を足したもの。data は変えない
 */
export function planAutoSync(data, fetched, range, cfg, now) {
  const plan = planCalendarSync(data, fetched, range, cfg);
  const fixed = (e) => e.confirmed === true || meetingPast(e, now); // 終わった会議・確認済みの会議
  const held = [
    ...plan.updated.filter((u) => fixed(u.before) && ["title", "date", "start", "end"].some((k) => u.before[k] !== u.after[k])).map((u) => ({ e: u.before, change: "updated" })), // 予定表の内容が変わったものだけ。規則でプロジェクトが付いただけの変更は、そのまま反映する
    ...plan.removed.filter(fixed).map((e) => ({ e, change: "removed" })),
  ];
  const left = new Set(held.map((h) => h.e.id));
  const open = plan.removed.filter((e) => !left.has(e.id));
  const none = fetched.length === plan.excluded.length; // 取得が 0 件、または全件が対象外（自分のメールアドレスの設定の誤りかもしれない）
  const blocked = none && open.length ? { reason: `予定表の取得が 0 件（または全件が対象外）のため、削除していません（取得の失敗か、自分のメールアドレスの設定の誤りかもしれません。設定は /project-board:mcp、削除してよいときは /project-board:intake calendar で確認できます）`, count: open.length } : null;
  const keep = new Map([...held.map((h) => h.e), ...(blocked ? open : [])].map((e) => [e.id, e]));
  const events = plan.data.events.map((e) => keep.get(e.id) ?? e);
  for (const e of keep.values()) if (!events.some((x) => x.id === e.id)) events.push(e);
  return {
    ...plan,
    updated: plan.updated.filter((u) => !keep.has(u.before.id)),
    removed: plan.removed.filter((e) => !keep.has(e.id)),
    held: held.map(({ e, change }) => ({ id: e.id, title: e.title, date: e.date, change })),
    blocked,
    data: { ...plan.data, events },
  };
}
