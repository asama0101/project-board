// 画面の表示の好み（今日の優先・ガントの実績・スケジュールの参加しない会議を出す／隠す）。データではないので、ブラウザ（localStorage）に保存する。
// localStorage が使えない・壊れているときは、既定のまま動く。

const KEY = "project-board.prefs";
export const DEFAULT_PREFS = { showPrio: true, showActual: true, showSkipped: false };

/** localStorage。サイトのデータが止められているなど、使えないときは null */
const browserStorage = () => {
  try { return window.localStorage; } catch { return null; }
};
/** 保存した JSON。無い・壊れている・storage が使えないときは null */
function readJson(storage, key) {
  try { return JSON.parse(storage?.getItem(key) ?? "null"); } catch { return null; }
}
/** 保存する。保存できない環境では、黙って諦める */
function write(storage, key, text) {
  try { storage?.setItem(key, text); } catch { /* 保存できない環境 */ }
}

/** 保存された好み（真偽値のキーだけ採用）。保存が無い・壊れている・storage が使えないときは既定 */
export function loadPrefs(storage = browserStorage()) {
  const v = readJson(storage, KEY), out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS)) if (typeof v?.[k] === "boolean") out[k] = v[k];
  return out;
}

export const savePrefs = (prefs, storage = browserStorage()) => write(storage, KEY, JSON.stringify(prefs));

// Claude Code への依頼の下書き。送るまで、入力の途中の文章を、このブラウザに覚える（閉じても残る）。
const DRAFT_KEY = "project-board.inboxDraft";

export function loadInboxDraft(storage = browserStorage()) {
  try { return storage?.getItem(DRAFT_KEY) ?? ""; } catch { return ""; }
}

export const saveInboxDraft = (text, storage = browserStorage()) => write(storage, DRAFT_KEY, text);

// 設定タブで閉じている節。次に開いたとき同じ開閉から始められるように覚える。保存が無いときはすべて開いている。
const FOLD_KEY = "project-board.settingsClosed";
export const SETTINGS_FOLDS = ["basic", "days", "nat", "hol", "wrk", "rules", "wbs"];

/** 閉じている節の ID の配列。節の ID 以外・形が違う値は捨てる */
export function loadSettingsClosed(storage = browserStorage()) {
  const v = readJson(storage, FOLD_KEY);
  return Array.isArray(v) ? SETTINGS_FOLDS.filter((id) => v.includes(id)) : [];
}

export const saveSettingsClosed = (ids, storage = browserStorage()) => write(storage, FOLD_KEY, JSON.stringify(ids));
