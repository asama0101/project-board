// 「設定」タブ: 基本の設定（営業日の数え方・勤務時間・待ち長期化の日数・見出しの呼び名）と、休みと営業日（日本の祝日（表示のみ）・休み（手動）・営業日として扱う日）と、キーワード規則（会議名。編集できる）と、WBS の取り込み記録（表示のみ）。節は折りたため、閉じている節は opts.closed で渡す。
import { ruleMeetingCounts } from "../../core/rules.js";
import { validate, HOLIDAY_KINDS, DEFAULT_WORKDAY } from "../../core/schema.js";
import { isDate, isTime, toMin } from "../../core/dates.js";
import { groupLabels } from "../../core/groups.js";
import { esc } from "../common.js";

/** 基本の設定の入力に出す値。形が違う・無い項目は既定値（画面の描画と、不正な入力を元に戻すときに使う） */
export function settingsInputValues(data) {
  const st = data.settings ?? {};
  const ok = st.workday && isTime(st.workday.start) && isTime(st.workday.end) && toMin(st.workday.start) < toMin(st.workday.end);
  const wd = ok ? st.workday : DEFAULT_WORKDAY;
  const lb = groupLabels(st);
  return { workdayStart: wd.start, workdayEnd: wd.end, waitingLongDays: Number.isInteger(st.waitingLongDays) && st.waitingLongDays >= 1 ? st.waitingLongDays : 7, labelGroup: lb.group, labelSubgroup: lb.subgroup };
}

/** @param opts.ruleError  規則の追加・書き換えで出たエラーの文言
 *  @param opts.closed     閉じている節の ID の配列（prefs.js の SETTINGS_FOLDS）。省略はすべて開く */
export function renderSettings(data, today, opts = {}) {
  const projects = data.projects ?? [];
  const rules = data.settings?.projectRules ?? [];
  const counts = ruleMeetingCounts(data);
  const closed = opts.closed ?? [];
  /** 折りたためる節。見出し（h）は summary の中に置く。ID は prefs.js の SETTINGS_FOLDS。閉じていて注意（n 件）があるときは、見出しに件数を出す */
  const fold = (id, cls, h, title, body, n = 0) => `<details class="${cls}" data-fold="${id}" aria-labelledby="h-${id}"${closed.includes(id) ? "" : " open"}><summary><${h} id="h-${id}">${title}</${h}>${closed.includes(id) && n ? `<span class="note err">注意 ${n} 件</span>` : ""}</summary>${body}</details>`;
  const options = (sel) => projects.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");

  // 基本の設定: 値は settings の値。形が違う項目（validate の注意が出る項目）は、既定値を出して、横に注意を出す
  const warns = validate(data).warnings.filter((m) => m.startsWith("settings."));
  const warnOf = (key) => warns.filter((m) => m.startsWith(`settings.${key}:`)).map((m) => `<div class="note err">${esc(m)}</div>`).join("");
  const warnN = (...keys) => warns.filter((m) => keys.some((k) => m.startsWith(`settings.${k}:`))).length;
  const st = data.settings ?? {};
  const countOn = st.countWeekendsAndHolidays === true; // 土日祝を営業日に数える。true 以外（"true" など）はオフ
  const iv = settingsInputValues(data);
  const basic = fold("basic", "panel fold", "h2", "基本の設定", `
      <p class="note" style="margin:0 0 10px">変更はその場でファイルに保存されます。</p>
      <div class="tscroll"><table class="tbl edit"><tbody>
        <tr><td data-l="項目">営業日の数え方</td><td data-l="値"><label><input type="checkbox" data-set="countWeekendsAndHolidays" aria-label="土日祝を営業日に数える"${countOn ? " checked" : ""}> 土日祝を営業日に数える</label>${warnOf("countWeekendsAndHolidays")}</td><td class="muted" data-l="説明">日数の計算（営業日後の期限）とスケジュールの作業枠で、土日と日本の祝日を飛ばすかどうかを選びます。オンにしても、手動の休みは飛ばします。</td></tr>
        <tr><td data-l="項目">勤務時間</td><td data-l="値"><input class="in" type="time" data-set="workday-start" value="${esc(iv.workdayStart)}" aria-label="勤務時間の開始"> 〜 <input class="in" type="time" data-set="workday-end" value="${esc(iv.workdayEnd)}" aria-label="勤務時間の終了">${warnOf("workday")}</td><td class="muted" data-l="説明">スケジュールで作業枠を置ける範囲です。</td></tr>
        <tr><td data-l="項目">待ち長期化の日数</td><td data-l="値"><input class="in" type="number" min="1" step="1" data-set="waitingLongDays" value="${iv.waitingLongDays}" aria-label="待ち長期化とみなす日数"> 日${warnOf("waitingLongDays")}</td><td class="muted" data-l="説明">Waiting がこの日数を超えると、「今日の優先」と遅延バッジに出ます。</td></tr>
        <tr><td data-l="項目">見出しの呼び名</td><td data-l="値"><input class="in" data-set="label-group" value="${esc(iv.labelGroup)}" aria-label="大項目の呼び名"> <input class="in" data-set="label-subgroup" value="${esc(iv.labelSubgroup)}" aria-label="中項目の呼び名">${warnOf("labels")}</td><td class="muted" data-l="説明">ガント・リストの見出しの呼び名です。空にすると既定（大項目・中項目）に戻ります。</td></tr>
      </tbody></table></div>`, warnN("countWeekendsAndHolidays", "workday", "waitingLongDays", "labels"));

  // 休みと営業日の指定: 形が違う要素は出さず（validate の注意が節の上に出る）、日付の昇順で並べる
  const entries = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && isDate(x.date)) : []).slice().sort((p, q) => p.date.localeCompare(q.date));
  const noteTd = (x) => `<td class="muted" data-l="メモ">${x.note ? esc(x.note) : ""}</td>`;
  const nh = st.nationalHolidays, nhDates = entries(nh?.dates);
  const nhRows = nhDates.filter((x) => x.date >= today).slice(0, 12).map((x) => `<tr><td class="mono" data-l="日付">${esc(x.date)}</td><td data-l="名称">${esc(x.name ?? "")}</td></tr>`).join("");
  const nationalSec = fold("nat", "subfold", "h3", "日本の祝日", `
      <p class="note" style="margin:0 0 10px">営業日の計算で飛ばす日です。内閣府の祝日一覧から、Claude Code が取得して保存します（営業日を使う提案を作るときと、見張りを始めるときに、自動で更新します。この画面からは取得しません）。</p>
      ${countOn ? `<p class="muted" style="margin:0 0 8px">いまは土日祝を営業日に数える設定なので、この一覧は日数計算に使いません。</p>` : ""}
      ${warnOf("nationalHolidays")}
      ${nh && typeof nh === "object" && isDate(nh.fetchedAt) && nhDates.length
        ? `<p style="margin:0 0 8px">取得日 <span class="mono">${esc(nh.fetchedAt)}</span>・<span class="mono">${nhDates.length} 件</span>（<span class="mono">${esc(nhDates[0].date)}〜${esc(nhDates.at(-1).date)}</span>）。今日以降の祝日:</p>
         ${nhRows ? `<div class="tscroll"><table class="tbl"><tbody>${nhRows}</tbody></table></div>` : `<p class="muted" style="margin:0">今日以降の祝日は、取得した範囲にありません。次に自動で更新されます。</p>`}`
        : `<p class="muted" style="margin:0">まだ取得していません。営業日を使う提案を作るときと、見張りを始めるときに、自動で取得します。</p>`}
    `, warnN("nationalHolidays"));

  const kindOptions = (cur) => HOLIDAY_KINDS.concat(HOLIDAY_KINDS.includes(cur) || cur === undefined ? [] : [cur]).map((k) => `<option${k === (cur ?? HOLIDAY_KINDS[0]) ? " selected" : ""}>${esc(k)}</option>`).join("");
  const holidayRows = entries(st.holidays).map((x) => `<tr><td class="mono" data-l="日付">${esc(x.date)}</td><td data-l="区分"><select class="in sm" data-hrowkind="${esc(x.date)}" aria-label="${esc(x.date)} の区分">${kindOptions(x.kind)}</select></td>${noteTd(x)}<td data-l=""><button class="btn" data-hdel="${esc(x.date)}" aria-label="${esc(x.date)} を休みから外す">削除</button></td></tr>`).join("");
  const holidaySec = fold("hol", "subfold", "h3", "休み（手動）", `
      <p class="note" style="margin:0 0 10px">有給・会社独自の休みなどを登録します。営業日の計算で飛ばします（区分は整理用で、計算は同じです）。${countOn ? "終了日を入れると期間として登録します。土日祝を営業日に数えるときは、期間内の土日と日本の祝日も除きません。" : "終了日を入れると期間として登録し、期間内の土日と日本の祝日は除きます。"}変更はその場でファイルに保存されます。</p>
      ${warnOf("holidays")}
      <div class="tscroll"><table class="tbl edit"><thead><tr><th>日付</th><th>区分</th><th>メモ</th><th></th></tr></thead><tbody>${holidayRows || `<tr><td colspan="4" class="muted">休みは登録されていません。下の行から追加します。</td></tr>`}
        <tr><td data-l="日付"><input class="in" type="date" data-hnew aria-label="休みの開始日"> 〜 <input class="in" type="date" data-hto aria-label="休みの終了日（期間のとき）"></td><td data-l="区分"><select class="in sm" data-hkind aria-label="追加する休みの区分">${kindOptions()}</select></td><td data-l="メモ"><input class="in" data-hnote placeholder="メモ（任意）" aria-label="休みのメモ"></td><td data-l=""><button class="btn" data-hadd>＋ 追加</button></td></tr></tbody></table></div>
    `, warnN("holidays"));

  const workdayRows = entries(st.workdays).map((x) => `<tr><td class="mono" data-l="日付">${esc(x.date)}</td>${noteTd(x)}<td data-l=""><button class="btn" data-wdel="${esc(x.date)}" aria-label="${esc(x.date)} を営業日の指定から外す">削除</button></td></tr>`).join("");
  const workdaySec = fold("wrk", "subfold", "h3", "営業日として扱う日", `
      <p class="note" style="margin:0 0 10px">土日・祝日・休みでも、この日は営業日として数えます（休日出勤など）。変更はその場でファイルに保存されます。</p>
      ${warnOf("workdays")}
      <div class="tscroll"><table class="tbl edit"><thead><tr><th>日付</th><th>メモ</th><th></th></tr></thead><tbody>${workdayRows || `<tr><td colspan="3" class="muted">営業日の指定はありません。下の行から追加します。</td></tr>`}
        <tr><td data-l="日付"><input class="in" type="date" data-wnew aria-label="営業日として扱う日"></td><td data-l="メモ"><input class="in" data-wnote placeholder="メモ（任意）" aria-label="営業日の指定のメモ"></td><td data-l=""><button class="btn" data-wadd>＋ 追加</button></td></tr></tbody></table></div>
    `, warnN("workdays"));

  const ruleRows = rules.map((r, i) => {
    const known = projects.some((p) => p.id === r.projectId);
    const unknown = known ? "" : `<option value="${esc(r.projectId)}" selected>（不明: ${esc(r.projectId)}）</option>`;
    const k = esc(r.keyword);
    return `<tr><td data-l="キーワード"><input class="in" data-rkw="${k}" data-ri="${i}" value="${k}" aria-label="キーワード ${k}"></td>
      <td data-l="プロジェクト"><select class="in" data-rpj="${k}" data-ri="${i}" aria-label="${k} のプロジェクト">${unknown}${options(r.projectId)}</select></td>
      <td class="mono" data-l="付いている会議" data-rcount>${counts[i]} 件</td>
      <td data-l=""><button class="btn" data-rmove="${k}|-1" aria-label="${k} を上へ"${i === 0 ? " disabled" : ""}>↑</button> <button class="btn" data-rmove="${k}|1" aria-label="${k} を下へ"${i === rules.length - 1 ? " disabled" : ""}>↓</button> <button class="btn" data-rdel="${k}" aria-label="${k} の規則を削除">削除</button></td></tr>`;
  }).join("");
  const empty = rules.length ? "" : `<tr><td colspan="4" class="muted">規則はありません。下の行から追加します。</td></tr>`;
  const addRow = `<tr><td data-l="キーワード"><input class="in" data-rnew placeholder="件名に含むキーワード" aria-label="追加するキーワード"></td>
      <td data-l="プロジェクト"><select class="in" data-rnewpj aria-label="追加する規則のプロジェクト">${options(projects[0]?.id)}</select></td>
      <td data-l=""></td><td data-l=""><button class="btn" data-radd ${projects.length ? "" : "disabled"}>＋ 追加</button></td></tr>`;

  const imports = data.settings?.wbsImports ?? {};
  const wbsRows = projects.map((p) => {
    const w = imports[p.id];
    return w
      ? `<tr><td data-l="プロジェクト">${esc(p.name)}</td><td data-l="ファイル">${w.file ? esc(w.file) : `<span class="muted">（不明）</span>`}</td><td class="mono" data-l="日付">${esc(w.at)}</td><td class="mono" data-l="追加">${w.added} 件</td><td class="mono" data-l="更新">${w.updated} 件</td></tr>`
      : `<tr><td data-l="プロジェクト">${esc(p.name)}</td><td colspan="4" class="muted" data-l="ファイル">記録なし</td></tr>`;
  }).join("");

  const days = fold("days", "panel fold", "h2", "休みと営業日", `
      <div class="subfolds">${nationalSec}${holidaySec}${workdaySec}</div>`, warnN("nationalHolidays", "holidays", "workdays"));
  const rulesSec = fold("rules", "panel fold", "h2", "キーワード規則（会議名）", `
      <p class="note" style="margin:0 0 10px">件名にキーワードを含む会議を、そのプロジェクトに付けます。上の規則が先に当たります。手動で付けた会議は、規則を変えても変わりません。変更はその場でファイルに保存されます。</p>
      ${opts.ruleError ? `<p class="note err" role="alert" style="margin:0 0 10px">${esc(opts.ruleError)}</p>` : ""}
      <div class="tscroll"><table class="tbl edit"><thead><tr><th>キーワード</th><th>プロジェクト</th><th>付いている会議</th><th></th></tr></thead><tbody>${ruleRows}${empty}${addRow}</tbody></table></div>`, opts.ruleError ? 1 : 0);
  const wbsSec = fold("wbs", "panel fold", "h2", "WBS の取り込み記録", `
      <p class="note" style="margin:0 0 10px">プロジェクトごとに、最後に取り込んだ WBS です（追加か更新があった取り込みを、Claude Code が自動で記録します。変更がなかった取り込みは記録しません）。</p>
      ${projects.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>プロジェクト</th><th>ファイル</th><th>日付</th><th>追加</th><th>更新</th></tr></thead><tbody>${wbsRows}</tbody></table></div>` : `<p class="muted" style="margin:0">プロジェクトがありません。</p>`}`);

  return `<div style="display:flex;flex-direction:column;gap:16px">${basic}${days}${rulesSec}${wbsSec}</div>`;
}
