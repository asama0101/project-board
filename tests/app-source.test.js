import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../plugins/project-board/src/ui/app.js", import.meta.url), "utf8");
const stk = readFileSync(new URL("../plugins/project-board/src/ui/sticky.js", import.meta.url), "utf8"); // 固定表示（日付軸・列見出しの複製、横スクロールのそろえ）

// 編集は、いまのデータへの差分として書く。決まった結果を返す編集（() => data）は、保存の競合のとき、最新のファイルに当て直すと、
// 他（Claude Code など）の更新を消してしまう。
test("app.js: apply の編集は、必ず引数のデータを受け取る（決まった結果を返す編集を持たない）", () => {
  assert.doesNotMatch(src, /apply\(\(\) =>/);
  assert.doesNotMatch(src, /applyFixed/);
  assert.doesNotMatch(src, /next: \(\) =>/);
});

test("app.js: 状態の変更は changeStatus に集め、select とスケジュールのボタンが共用する。ボタンは data-pick より先に処理する", () => {
  assert.match(src, /function changeStatus\(/);
  const onChangeStatus = src.slice(src.indexOf('if (f === "status")'), src.indexOf('if (f === "party")'));
  assert.match(onChangeStatus, /changeStatus\(/);
  assert.ok(src.includes("[data-setstatus]"));
  assert.ok(src.indexOf('q("[data-setstatus]")') < src.indexOf('q("[data-pick]")'), "ボタンの分岐が data-pick より前");
  assert.match(src, /const scheduleOpts = \(\) => \(\{[^\n]*pendingDone: S\.pendingDone/);
});

test("app.js・index.html: 開始画面の案内、帯の対象の引き継ぎ、#toast の role", () => {
  assert.ok(!src.includes("data/sample.json"));
  assert.ok(src.includes("/project-board:init") && src.includes(".project-board/data.json"));
  assert.doesNotMatch(src, /pendingReplan|dueChange|replanAction/, "期限を変えたときの確認パネルは持たない（前後の確認は Claude Code に頼む）");
  const toggle = src.slice(src.indexOf('q("[data-ib-toggle]")'));
  assert.match(toggle.slice(0, 400), /!S\.ib\.projectId && S\.filter !== "all"[^\n]*S\.ib\.projectId = S\.filter/);
  const html = readFileSync(new URL("../plugins/project-board/src/ui/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="toast"[^>]*role="status"/);
});

test("app.js: 設定タブの data-set は updateSettings で保存し（勤務時間は開始・終了を組で）、data-rmove は moveProjectRule、focusSelector も data-set を扱う", () => {
  assert.match(src, /updateSettings\(/);
  const set = src.slice(src.indexOf("el.dataset.set"), src.indexOf("el.dataset.set") + 900);
  assert.match(set, /workday:\s*\{\s*start:\s*val\("workday-start"\),\s*end:\s*val\("workday-end"\)\s*\}/, "開始・終了を DOM から組で読む");
  assert.match(src, /moveProjectRule\(/);
  assert.match(src, /data-rmove/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 900);
  assert.match(fs, /d\.set/);
});

test("app.js: 休みの追加（期間を含む）・区分の変更・削除と、営業日の指定の追加・削除は edit.js の関数を通る。期間は除外した日数を通知し、Enter でも追加する。focusSelector も新しい入力を扱う", () => {
  for (const f of ["addHoliday(", "addHolidayRange(", "holidayRangeDays(", "removeHoliday(", "addWorkday(", "removeWorkday("]) assert.ok(src.includes(f), f);
  for (const a of ["[data-hadd]", "[data-hdel]", "dataset.hrowkind", "[data-wadd]", "[data-wdel]"]) assert.ok(src.includes(a), a);
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-hnew],[data-hto],[data-hnote]")'));
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-wnew],[data-wnote]")'));
  assert.match(src, /除外/);
  assert.match(src, /日本の祝日は未取得/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 1400);
  for (const k of ["hnew", "hto", "hnote", "wnew", "wnote"]) assert.ok(fs.includes(`"${k}"`), k);
});

test("schedule.js: カレンダー上部の確認（doneAsk）は無い（今日のタスクのパネルに移した）", () => {
  const sc = readFileSync(new URL("../plugins/project-board/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.doesNotMatch(sc, /doneAsk/);
  assert.doesNotMatch(sc, /statusButtons/);
});

test("app.js: 枠のドラッグ・下端ドラッグの間、ポインタの近くに時刻（開始–終了）を出し、終わり・描き直しで消す", () => {
  assert.match(src, /function showTip\(/);
  assert.match(src, /function hideTip\(/);
  const over = src.slice(src.indexOf('view.addEventListener("dragover"'), src.indexOf('view.addEventListener("drop"'));
  assert.match(over, /showTip\(/, "dragover で更新");
  const end = src.slice(src.indexOf('view.addEventListener("drop"'), src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"));
  assert.match(end, /hideTip\(\)[\s\S]*dragend|dragend[\s\S]*hideTip\(\)/);
  assert.equal((end.match(/hideTip\(\)/g) ?? []).length >= 2, true, "drop と dragend の両方");
  const rz = src.slice(src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"), src.indexOf("/* ---------- ガント上のドラッグ"));
  assert.match(rz, /const move = [\s\S]*showTip\(/, "長さ変更中の更新");
  assert.match(rz, /const up = [\s\S]*hideTip\(\)/, "離したら消す");
  assert.match(src, /function render\(\) \{[^\n]*\n\s*hideTip\(\)/, "描き直しで消す");
});

test("app.js: 画面（タブ）を切り替えるとき、未来の予定枠の確認待ち（pendingDone）を捨てる（出す場所が無い画面で残らない）", () => {
  const tab = src.slice(src.indexOf("S.screen = b.id.slice(4);"), src.indexOf("S.screen = b.id.slice(4);") + 200);
  assert.match(tab, /S\.pendingDone = null/);
});

test("app.js: 「今日の優先」の取っ手を押すとき、パネル内にしか出ない確認待ち（pendingDone）を捨てる。取っ手は view のクリックで扱い、上部のバー（filebar）には prio のボタンがない（actual は残る）", () => {
  const pf = src.slice(src.indexOf("function togglePref"), src.indexOf("function togglePref") + 400);
  assert.match(pf, /S\.pendingDone = null/);
  assert.match(src, /view\.addEventListener\("click"[\s\S]*data-pref/);
  assert.doesNotMatch(src, /data-pref="prio" aria-pressed/);
  assert.match(src, /data-pref="actual" aria-pressed/);
});

test("app.js: 「参加しない会議」のボタン（data-sskip）は showSkipped を反転し、scheduleOpts に渡す。data-pref は持たない（右の列の取っ手・ガント実績と干渉しない）", () => {
  assert.match(src, /q\("\[data-sskip\]"\)\) \{ togglePref\("showSkipped"\)/);
  assert.match(src, /const scheduleOpts = \(\) => \(\{[^\n]*showSkipped: S\.prefs\.showSkipped/);
  const sc = readFileSync(new URL("../plugins/project-board/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.doesNotMatch(sc, /data-sskip[^>]*data-pref|data-pref[^>]*data-sskip/);
});

test("schedule.js: ブロックの時刻は esc して出す（toMin が先に検証するが、描画側でも守る）", () => {
  const sc = readFileSync(new URL("../plugins/project-board/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.match(sc, /\$\{esc\(m\.start\)\}-\$\{esc\(m\.end\)\}/);
  assert.match(sc, /\$\{esc\(s\.start\)\}-\$\{esc\(s\.end\)\}/);
});

test("app.js: 営業日の指定の追加は、入力欄の値を先に取り出してから edit に入れる（保存の競合で当て直されても日付が空にならない）。終了日を入れたら同じ日でも期間として扱う", () => {
  const fn = src.slice(src.indexOf("function addWorkdayFromInput"), src.indexOf("function addWorkdayFromInput") + 600);
  assert.match(fn, /const date = view\.querySelector\("\[data-wnew\]"\)/);
  assert.match(fn, /const edit = \(d\) => addWorkday\(d, \{ date, note \}\)/);
  assert.match(src, /const range = to !== "";/);
});

test("app.js: 「解除して完了にする」を押したとき、確認を出した時点の枠のうち、いまもまだ開始していないものだけを解除する（確認から確定の間に始まった枠を消さない）", () => {
  const i = src.indexOf('const dk = q("[data-doneok]")');
  const ok = src.slice(i, i + 400);
  assert.match(ok, /pd\.future\.filter\(\(sid\) => futurePlanned\(S\.data, pd\.id, clock\(\)\)\.includes\(sid\)\)/);
});

test("app.js: 設定タブの入力の保存は、成功しても描き直さない（時刻は時・分を打つたびに change が起き、描き直すと入力の位置が「時」に戻って、続きが打てなくなる）。直した項目の古い注意だけ消す", () => {
  const fn = src.slice(src.indexOf("function changeSetting"), src.indexOf("function changeSetting") + 2000);
  assert.ok(fn.includes('apply(edit, "設定を保存しました", { quiet: true })'));
  assert.match(fn, /\.note\.err/);
});

test("app.js: 勤務時間の入力は、打っている途中の値（開始 > 終了など）で保存せず、打ち終わる（少し止まる）か入力欄を離れてから保存する", () => {
  assert.match(src, /function changeSettingSoon\(el\)/);
  const soon = src.slice(src.indexOf("function changeSettingSoon"), src.indexOf("function changeSettingSoon") + 700);
  assert.match(soon, /setTimeout\(/);
  assert.match(soon, /clearTimeout\(/);
  assert.match(src, /el\.dataset\.set\.startsWith\("workday-"\) \? changeSettingSoon\(el\) : changeSetting\(el\)/);
  const out = src.slice(src.indexOf('addEventListener("focusout"'), src.indexOf('addEventListener("focusout"') + 400);
  assert.match(out, /workday-/);
  assert.match(out, /changeSetting\(/);
});

test("app.js: render の先頭で、保存待ちの勤務時間のタイマーを止める（描き直しの途中で focusout が走り、入れ子の描き直しになるのを防ぐ）", () => {
  const head = src.slice(src.indexOf("function render() {"), src.indexOf("function render() {") + 200);
  assert.match(head, /clearTimeout\(settingTimer\); settingTimer = null;/);
});

test("app.js: 設定タブの入力の保存後、古い注意を消すのは勤務時間と待ち長期化の日数だけ（呼び名は片方だけ直しても、もう片方の注意を残す）。呼び名は保存された値（空なら既定）を入力欄に出す", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 1500);
  assert.match(fn, /k\.startsWith\("label-"\)/);
  assert.match(fn, /groupLabels\(S\.data\.settings\)/);
});

test("app.js: 設定タブの入力が不正なときは、描き直さず、入力欄を保存された値に戻す（描き直すとフォーカスが消える）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 2000);
  assert.match(fn, /try \{ edit\(S\.data\); \} catch \(e\) \{ toast\(e\.message\); restoreSettingInputs\(\); return; \}/);
  assert.match(src, /function restoreSettingInputs\(\)/);
  assert.match(src, /settingsInputValues\(S\.data\)/);
});

test("app.js: 状態を Done・Cancelled にしたとき、進行中の枠を残したことを知らせる", () => {
  const fn = src.slice(src.indexOf("function setStatus"), src.indexOf("function setStatus") + 1200);
  assert.match(fn, /runningPlanned\(S\.data, id, clock\(\)\)/);
  assert.ok(fn.includes("進行中の枠") && fn.includes("実績にする"));
});

test("app.js: 帯の対象は、利用者が選び直したあとは、画面の絞り込みで上書きしない（「すべて」を選んだのに戻される）", () => {
  assert.match(src, /e\.target\.matches\("\[data-ib-project\]"\)\) S\.ib\.projectTouched = true/);
  assert.ok(src.includes('!S.ib.projectTouched && !S.ib.projectId && S.filter !== "all"'));
});

test("app.js: 設定タブの保存の編集は updateSettings(d, patch)。不正な入力の復元は、不正になりうる勤務時間と待ち長期化の日数だけ（呼び名は不正にならない）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 2000);
  assert.ok(fn.includes("const edit = (d) => updateSettings(d, patch);"));
  const rs = src.slice(src.indexOf("function restoreSettingInputs()"), src.indexOf("function restoreSettingInputs()") + 600);
  assert.ok(rs.includes('set("workday-start"') && rs.includes('set("waitingLongDays"'));
  assert.ok(!rs.includes("label-"));
});

test("app.js: 「土日祝を営業日に数える」のスイッチは、チェックの状態で保存し、描き直す（祝日・休みの節の説明を切り替えるため。quiet にしない）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 700);
  assert.match(fn, /k === "countWeekendsAndHolidays"/);
  assert.match(fn, /updateSettings\(d, \{ countWeekendsAndHolidays: el\.checked \}\)/);
  const line = fn.split("\n").find((l) => l.includes("countWeekendsAndHolidays: el.checked"));
  assert.doesNotMatch(line, /quiet/);
});

test("app.js: 休みの期間登録の通知は、土日祝を営業日に数える設定のとき、「日本の祝日は未取得のため、土日だけを除きました」を付けない（何も除いていない）", () => {
  const i = src.indexOf("holidayRangeDays(S.data, from, to)");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 700), /countWeekendsAndHolidays/);
});

test("app.js: ガントのドラッグ中のバーの幅は、期限日のマスを含める（描画と同じ。ne - ns + 1 日）", () => {
  assert.match(src, /tg\.style\.left = pct\(ns\); tg\.style\.width = pct\(ne - ns \+ 1\);/);
});

test("index.html: タブは ガントチャート・リスト・スケジュール・稼働・設定 の順で、「プロジェクト」はない", () => {
  const html = readFileSync(new URL("../plugins/project-board/src/ui/index.html", import.meta.url), "utf8");
  const tabs = [...html.matchAll(/<button role="tab" id="tab-([a-z]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(tabs, ["gantt:ガントチャート", "list:リスト", "schedule:スケジュール", "workload:稼働", "settings:設定"]);
});

test("app.js: S.pview は廃止し、S.screen の初期値は gantt（リストへ移る操作は S.screen = \"list\"）", () => {
  assert.doesNotMatch(src, /pview/);
  assert.match(src, /screen: "gantt"/);
  assert.match(src, /S\.screen = "list"/);
});

test("app.js: 描き直しのあとに drawDeps を呼び、バーへの mouseover・mouseout で focusDeps を呼ぶ。ドラッグの開始で線を隠す", () => {
  assert.match(src, /syncSticky\(\);[\s\S]{0,200}drawAllDeps\(\)/);
  assert.match(src, /view\.addEventListener\("mouseover"[\s\S]{0,300}focusDeps\(/);
  assert.match(src, /view\.addEventListener\("mouseout"[\s\S]{0,300}focusDeps\(/);
  assert.match(src, /classList\.add\("dep-hide"\)/);
  assert.match(src, /window\.addEventListener\("resize"[\s\S]{0,120}drawAllDeps/);
});

test("app.js: resize は requestAnimationFrame で間引いて線を引き直す。取っ手は focusSelector で描き直しのあとも戻る。filebar は actual だけを扱う", () => {
  assert.match(src, /window\.addEventListener\("resize"[\s\S]{0,260}requestAnimationFrame/);
  assert.match(src, /function focusSelector[\s\S]*d\.pref[\s\S]*return `\[data-pref=/);
  assert.match(src, /if \(pf\) \{ togglePref\("showActual"\); return; \}/);
});

test("画面の文言: 「プロジェクト」タブはないので、稼働・ガントチャートの案内に「プロジェクト画面」「リスト表示で」を使わない", () => {
  const wl = readFileSync(new URL("../plugins/project-board/src/ui/views/workload.js", import.meta.url), "utf8");
  const gt = readFileSync(new URL("../plugins/project-board/src/ui/views/gantt.js", import.meta.url), "utf8");
  assert.doesNotMatch(wl, /プロジェクト画面から/);
  assert.doesNotMatch(gt, /リスト表示で追加/);
});

test("app.js: 右の列を開け閉めすると、ガントの幅が変わるので、横スクロールを今日の位置へ戻す（resetScroll）", () => {
  const f = src.slice(src.indexOf("function togglePref"), src.indexOf("function togglePref") + 500);
  assert.match(f, /key === "showPrio"[^\n]*S\.resetScroll = true/);
});

test("app.js: 設定タブの節の開閉は、toggle イベント（バブリングしないのでキャプチャ）で S.settingsClosed に記録して保存する。開閉では描き直さない", () => {
  assert.match(src, /settingsClosed: loadSettingsClosed\(\)/);
  assert.match(src, /renderSettings\(S\.data, today, \{ ruleError: S\.ruleError, closed: S\.settingsClosed \}\)/);
  const i = src.indexOf('view.addEventListener("toggle"');
  assert.ok(i > 0);
  const fn = src.slice(i, i + 450);
  assert.match(fn, /matches\("details\[data-fold\]"\)/);
  assert.match(fn, /saveSettingsClosed\(/);
  assert.doesNotMatch(fn, /render\(\)/);
  assert.match(fn, /\}, true\);/, "キャプチャ");
});

// ---- 固定表示（ガント）: 画面のスクロールに対して、CSS の sticky で付ける ----
const css = readFileSync(new URL("../plugins/project-board/src/ui/theme.css", import.meta.url), "utf8");

test("theme.css: ガントの固定表示の規則は #view の中だけ。見出し（.pgstick）は画面の縦スクロールに sticky、枠は横だけにスクロールする", () => {
  assert.match(css, /#view \.pgstick\{[^}]*position:sticky[^}]*top:calc\(var\(--hh,0px\) \+ var\(--th,0px\) \+ var\(--gh,0px\)\)/);
  assert.match(css, /#view \.gscroll\{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
  assert.doesNotMatch(css, /max-height:calc\(100vh - var\(--gsy/, "枠の高さを決める規則は持たない");
  assert.doesNotMatch(css, /--sbw|--gsy/, "枠の縦スクロールバーに合わせる変数は持たない");
  assert.match(css, /#view\{overflow-anchor:none\}/, "描き直しで縦の位置がずれないよう、スクロールアンカーを切る（実測: 切らないと 1 回の描き直しで +2px）");
});

test("app.js: pinTableHeads は日付軸（.g-head）をずらさない。syncSticky が --gh・--pgh を入れる（--ibh・--gt・--gsy・--sbw は使わない）", () => {
  const fn = stk.slice(stk.indexOf("function pinTableHeads"), stk.indexOf("let pinQueued"));
  assert.ok(fn.length > 50, "pinTableHeads を切り出せた");
  assert.doesNotMatch(fn, /g-head/);
  for (const v of ["--gh", "--pgh"]) assert.ok(stk.includes(`setProperty("${v}"`), `${v} を入れる`);
  for (const v of ["--gsy", "--sbw", "--ibh"]) assert.ok(!stk.includes(v), `${v} はもう使わない`);
});

test("app.js: 描き直しで、ガントの横のスクロール位置（scrollLeft）とページの縦の位置（scrollY）を保って戻す。全 .gscroll の横位置は alignGScrolls でそろえる", () => {
  const fn = src.slice(src.indexOf("function render()"), src.indexOf("function scrollToday"));
  assert.match(fn, /scrollLeft/);
  assert.match(fn, /window\.scrollY/);
  assert.match(fn, /window\.scrollTo\(0, /);
  assert.match(fn, /view\.style\.minHeight/, "描き直しの間、ページが縮んで scrollY が飛ばないようにする");
  assert.doesNotMatch(fn, /scrollTop/, "枠は縦にスクロールしない");
  const al = stk.slice(stk.indexOf("function alignGScrolls"), stk.indexOf("function alignGScrolls") + 600);
  assert.match(al, /scrollLeft - /, "差があるときだけ代入する（ループしない）");
  assert.match(stk, /classList\.contains\("gscroll"\)\) return;\s+if \(aligned\.get\(gs\) === gs\.scrollLeft\)/, "そろえたときに起きる scroll は、そろえ直さない（動いている枠を引き戻さない）");
  assert.match(stk, /aligned\.set\(gs, gs\.scrollLeft\)/);
  assert.match(stk, /\}, true\);/, "scroll はバブルしないので、キャプチャで受ける");
});

// ---- 固定表示（リスト）: 名前・状態の行の中の、列見出しの複製 ----
test("app.js: リストの列見出しは、表を包む枠（.twrap）の先頭の複製（.thstrip）で固定する。複製は aria-hidden、横スクロールは translateX でそろえる。出す・隠すの JS（thStripOn・updateThStrips）は持たない", () => {
  assert.ok(stk.includes('className = "thin"') && stk.includes('className = "thc"'), "複製の中身(列の並び)を作る。複製の入れ物(.thstrip)は、renderList が aria-hidden つきで出す");
  assert.match(stk, /translateX\(\$\{-box\.scrollLeft\}px\)/);
  assert.ok(!(src + stk).includes("thStripOn") && !(src + stk).includes("updateThStrips"), "固定していないときは本物の thead に重なるので、出し分けは要らない");
  assert.ok(!stk.includes("is-scroll") && !stk.includes("--pst"), "表を横スクロールの枠にする案の名残がない");
  const pin = stk.slice(stk.indexOf("function pinTableHeads"), stk.indexOf("let pinQueued"));
  assert.match(pin, /classList\.contains\("tlist"\)\) continue/, "リストの表は pinTableHeads の対象外");
});

test("theme.css: 列見出しの複製の規則は #view の中だけ。複製は表の枠（.twrap）の中の sticky で、--ph（固定の行の高さ）の下に付く。リストの表を sticky・横スクロールの枠にする規則は持たない", () => {
  for (const rule of ["#view .pstick{position:sticky;top:calc(var(--hh,0px) + var(--th,0px))", "#view .pstick .prow{display:flex", "#view .pstick .phead{margin:", "#view .thstrip{position:sticky;top:calc(var(--hh,0px) + var(--th,0px) + var(--ph,0px))", "#view .twrap{padding-bottom:calc(var(--sh,0px) + var(--sb,0px))}", "#view .twrap > .tscroll{margin-bottom:calc(-1 * (var(--sh,0px) + var(--sb,0px)))}", "#view .thstrip .thin{display:flex"]) assert.ok(css.includes(rule), rule);
  assert.ok(!css.includes("#view .thstrip.on") && !css.includes("position:absolute;top:100%"), "出し分け（.on）と絶対配置は持たない");
  assert.ok(!css.includes("is-scroll") && !css.includes(".tscroll.tlist"), "表を枠にする規則の名残がない");
});

// ---- 固定表示の見直し（ブランチ全体のレビューの指摘） ----
test("app.js: --gt は使わない（ガントの枠の高さを決める変数は、もう持たない）", () => {
  assert.ok(!stk.includes('setProperty("--gt"'), "--gt はもう使わない");
  assert.doesNotMatch(css, /--gt/);
});

test("app.js: 下の帯の高さ（syncIbh・--ibh）は、ガントの枠の高さを決めなくなったので持たない", () => {
  assert.ok(!src.includes("syncIbh") && !src.includes("--ibh"));
  assert.doesNotMatch(css, /--ibh/);
});

test("app.js: 複製は .twrap の子で、syncThStrips が --ph（固定の行の高さ）と --sh（複製の高さ）を入れる", () => {
  assert.ok(stk.includes('wrap?.querySelector(":scope > .thstrip")'),"複製は .twrap の先頭の子（sticky の基準）");
  const start = stk.indexOf("function syncThStrips");
  const fn = stk.slice(start, stk.indexOf("\n}\n", start));
  assert.match(fn, /setProperty\("--ph"/);
  assert.match(fn, /setProperty\("--sh"/);
  assert.doesNotMatch(fn, /appendChild\(strip\)/, "固定の行の子にしない");
});


// ---- ページの先頭でも、固定の行が、固定したときと同じ位置にある（スクロールの始めに、固定の行が動かない） ----
test("theme.css: ガント・リスト（.ptool がある画面）では、上部の余白を詰めて、先頭の位置が固定したときの位置と同じになる。規則は、その画面とアプリだけに効く（ほかの画面は変えない）", () => {
  for (const rule of [
    "body:has(.ptool){padding-block-start:8px}",
    ".wrap:has(.ptool){gap:0}",
    "#banner:not(:empty){margin-block:8px}",
    "#view section.panel:has(> .gtop),#view section.panel:has(> .pstick){padding-top:0}",
    "#view section.panel > .pstick{padding-top:20px}",
    "#view section.panel > .gtop{padding-top:22px}",
    "#view .cols>.side,#view .side-toggle{margin-top:8px}",
  ]) assert.ok(css.includes(rule), rule);
  const section = css.slice(css.indexOf("/* ページの先頭でも"));
  assert.ok(section.length > 100, "節がある");
  assert.ok(!section.includes("border-top-width:0") && !section.includes("border-top-left-radius:0"), "カードの上端の線と角丸は消さない");
  for (const line of section.split(/\r?\n/).filter((l) => l.includes("{") && !l.startsWith("/*"))) assert.match(line, /^(body:has\(\.ptool\)|\.wrap:has\(\.ptool\)|#banner|#view)/, line);
});

// ---- 固定表示（ガント）: 日付軸の複製（.gstrip）----
test("app.js: 日付軸の複製（.gstrip）を syncSticky が作り直し、alignGScrolls が複製の横位置（translateX）を更新する", () => {
  assert.ok(stk.includes("function syncGStrips") && stk.includes("function updateGStrip"));
  const sync = stk.slice(stk.indexOf("function syncSticky"), stk.indexOf("function syncThStrips"));
  assert.match(sync, /syncGStrips\(\)/);
  const upd = stk.slice(stk.indexOf("function updateGStrip"), stk.indexOf("function updateGStrip") + 500);
  assert.match(upd, /translateX\(\$\{-gs\.scrollLeft\}px\)/);
  const al = stk.slice(stk.indexOf("function alignGScrolls"), stk.indexOf("const aligned = new WeakMap"));
  assert.match(al, /updateGStrip\(/, "そろえた枠の複製も動かす");
  assert.ok(stk.includes('className = "gsl"') && stk.includes('className = "gsv"'), "複製は、左の空き(.gsl)と窓(.gsv)の 2 つ");
  assert.match(stk, /\.g-head \.g-lane/, "本物の日付軸の行を写す");
  assert.match(stk, /removeAttribute\("id"\)/, "複製の中の id は外す（重複を避ける）");
});

test("theme.css: .gstrip は sticky で、top に --pgh を含み、複製の窓は本物の幅で隠す", () => {
  assert.match(css, /#view \.gstrip\{[^}]*position:sticky[^}]*top:calc\(var\(--hh,0px\) \+ var\(--th,0px\) \+ var\(--gh,0px\) \+ var\(--pgh,0px\)\)[^}]*display:flex/);
  assert.match(css, /#view \.gstrip \.gsl\{[^}]*width:var\(--lw\)/);
  assert.ok(css.includes("#view .gwrap{padding-bottom:calc(var(--sh,0px) + var(--sb,0px))}") && css.includes("#view .gwrap > .gscroll{margin-bottom:calc(-1 * (var(--sh,0px) + var(--sb,0px)))}"), "横スクロールバーの高さ(--sb)も、sticky の範囲から除く（複製が表・枠のスクロールバーに重ならない）");
  assert.ok(stk.includes('setProperty("--sb"'), "syncGStrips・syncThStrips が --sb を入れる");
  assert.match(css, /#view \.gstrip \.gsv\{[^}]*overflow:hidden/);
});

// ---- 絞り込みチップ: 1 行に収めて、横にスクロールする ----
test("theme.css: チップの行は折り返さず横にスクロールし、プロジェクト名のプルダウン・追加ボタンは固定のまま", () => {
  assert.match(css, /#view \.ptool\{[^}]*display:flex[^}]*flex-wrap:nowrap/);
  assert.match(css, /#view \.ptool \.chips-row\{[^}]*display:flex[^}]*flex-wrap:nowrap[^}]*overflow-x:auto[^}]*min-width:0/);
  assert.match(css, /#view \.ptool \.chips-row \.chip-btn\{[^}]*flex:none/);
  assert.match(css, /#view \.ptool \.ptool-end\{[^}]*flex:none/);
});

test("app.js: 描き直しで、チップの行の横位置を保ち、選択中のチップが見えなければ行の中だけを動かす（scrollIntoView は使わない: ページの縦が動くため）", () => {
  const fn = src.slice(src.indexOf("function render()"), src.indexOf("function focusSelector"));
  assert.match(fn, /\.chips-row/);
  assert.match(fn, /chipsLeft/);
  assert.doesNotMatch(fn, /scrollIntoView\(\{ block: "nearest"/, "ページの縦を動かす scrollIntoView を、チップに使わない");
  assert.match(fn, /aria-pressed="true"/);
});

test("チップの行はスクロールバーを出さず（高さが 5 件のときと同じ）、縦のホイールで横に動く", () => {
  assert.match(css, /#view \.ptool \.chips-row\{[^}]*scrollbar-width:none/);
  assert.match(css, /#view \.ptool \.chips-row::-webkit-scrollbar\{display:none\}/);
  const w = src.slice(src.indexOf('closest(".chips-row")') - 200, src.indexOf('closest(".chips-row")') + 500);
  assert.match(w, /addEventListener\("wheel"/);
  assert.match(w, /row\.scrollLeft \+= e\.deltaY/);
  assert.match(w, /passive: false/);
});

test("theme.css: 日付軸の複製（.gstrip、z-index:6）は、本物の日付軸（.g-head、z-index:5）より上に描く（同じ値だと、境目で本物が複製の上に描かれ、目盛りが見出しの下へ滑り込む。実測）", () => {
  assert.match(css, /#view \.g-head\{[^}]*z-index:5/);
  assert.match(css, /#view \.gstrip\{[^}]*z-index:6/);
});

test("app.js: alignGScrolls は、代入で値が変わったときだけ aligned に記録する（右端で丸められて変わらないとき、古い値が残って、あとの本物のスクロールを飲み込まない）", () => {
  const al = stk.slice(stk.indexOf("function alignGScrolls"), stk.indexOf("const aligned = new WeakMap"));
  assert.match(al, /const before = gs\.scrollLeft/);
  assert.match(al, /if \(gs\.scrollLeft !== before\) aligned\.set\(gs, gs\.scrollLeft\)/);
});

test("app.js: チップの行のホイールは、行の端に着いていたら素通しにする（ページが動かなくなる罠にしない）", () => {
  const w = src.slice(src.indexOf('closest(".chips-row")') - 100, src.indexOf('closest(".chips-row")') + 700);
  assert.match(w, /scrollWidth - row\.clientWidth/);
  assert.match(w, /row\.scrollLeft <= 0/);
});

test("app.js: プロジェクト名のプルダウン（data-projectpick）で絞り込む。大項目の絞り込み（S.group・data-groupfilter）はもう持たない", () => {
  assert.match(src, /el\.dataset\.projectpick !== undefined\) \{ S\.filter = el\.value; S\.resetScroll = true; render\(\); return; \}/);
  assert.ok(!src.includes("S.group") && !src.includes("groupfilter") && !src.includes("group: \"all\""), "大項目の絞り込みの状態を持たない");
});

// チェックリストの編集欄のイベントは、Task 6 の属性（data-ck*）を読んで、edit.js の関数に載せる（動作は実ブラウザで確認する）
test("app.js: チェックリストの編集欄のイベントをつなぐ（開閉・チェック・文言・削除・追加・並び替え）。変換確定の Enter では追加しない", () => {
  for (const a of ["[data-cktoggle]", "dataset.ckdone", "dataset.cktext", "[data-ckdel]", "[data-ckadd]", "[data-ckmv]"]) assert.ok(src.includes(a), a);
  for (const f of ["addChecklistItem", "updateChecklistItem", "removeChecklistItem", "moveChecklistItem"]) assert.ok(src.includes(f), f);
  assert.match(src, /e\.isComposing/);
  assert.match(src, /checkOpen: S\.checkOpen/, "リストの展開の状態を描画に渡す");
  assert.match(src, /S\.checkOpen = new Set\(\)/);
});

// ---- 全体レビューの修正（M1・M3・M4） ----

test("focusSelector: チェックリストのチェック・削除・展開ボタンも、描き直しのあとにフォーカスを戻せる（キーボードで操作しても位置を見失わない）", () => {
  const fn = src.slice(src.indexOf("function focusSelector("), src.indexOf("function focusSelector(") + 1600);
  for (const k of ["d.ckdone", "d.ckdel", "d.cktoggle"]) assert.ok(fn.includes(k), k);
});

test("theme.css: 画面のガントのラベル（⠿・ID・名前・×の 4 列）では、チェックリストの線を名前の列（3 列目）に置く", () => {
  assert.match(css, /\.g-label\[data-mvrow\] \.ck-meter\{grid-column:3\/-1\}/);
});

test("theme.css: 幅 860px 以下で、リストのチェックリストの展開行（.ck-tr）は全幅にする", () => {
  assert.match(css, /\.tbl\.edit tr\.ck-tr>td\{grid-column:1\/-1;padding-left:0\}/);
});
