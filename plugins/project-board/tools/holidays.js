// 使い方: node tools/holidays.js <update|status> <data.json>
// 日本の祝日（内閣府の祝日一覧 CSV）を取得して data.json の settings.nationalHolidays に書く。結果は JSON で標準出力へ。
// 取得するだけで、こちらのデータは何も送らない。失敗したら data.json は変えず、理由を標準エラーに出して終了コード 1。
// 取得先は、環境変数 PJ_LENS_HOLIDAYS_URL で変えられる（テスト用）。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { today, diffDays, isDate } from "../src/core/dates.js";
import { decodeHolidayCsv, parseHolidayCsv, pickRecent } from "../src/core/holidays.js";
import { readJson, out, save } from "./cli.js";

const DEFAULT_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const USAGE = `使い方: node tools/holidays.js <コマンド> <data.json>
  update  <data.json>   内閣府の祝日一覧を取得して、settings.nationalHolidays に書く
  ensure  <data.json>   未取得・取得から 30 日超・一覧の最終日が今日以前のときだけ、update と同じ取得をする
  status  <data.json>   取得の状況（取得日・件数・範囲・経過日数）`;

const range = (dates) => ({ count: dates.length, from: dates[0]?.date ?? null, to: dates.at(-1)?.date ?? null });

/** settings.nationalHolidays の取得状況（status コマンドの出力と同じ。propose も使う） */
export function holidayStatus(settings) {
  const nh = settings?.nationalHolidays;
  if (!isDate(nh?.fetchedAt) || !Array.isArray(nh.dates)) return { fetched: false };
  return { fetched: true, fetchedAt: nh.fetchedAt, ...range(nh.dates), ageDays: diffDays(today(), nh.fetchedAt) };
}

/**
 * 祝日の一覧を取り直す必要があるか。propose（営業日を使う提案）と ensure が、同じ判定を使う。
 * neededUntil: 提案が使う最も遅い日。一覧の最終日より後なら「範囲外」。今日取得したものは、取り直しても同じなので false。
 * 土日祝を営業日に数える設定（settings.countWeekendsAndHolidays が true）のときは、祝日を使わないので取らない
 */
export function needsHolidayUpdate(settings, neededUntil = null) {
  if (settings?.countWeekendsAndHolidays === true) return { need: false, reason: null };
  const st = holidayStatus(settings);
  if (!st.fetched) return { need: true, reason: "未取得" };
  if (st.ageDays > 30) return { need: true, reason: "30日超" };
  if (st.ageDays > 0) {
    if (!st.to || st.to <= today()) return { need: true, reason: "一覧の最終日が今日以前" };
    if (neededUntil && neededUntil > st.to) return { need: true, reason: "範囲外" };
  }
  return { need: false, reason: null };
}

/** 内閣府の一覧を取得して、settings.nationalHolidays に入れる値を返す。失敗は例外 */
export async function fetchHolidays() {
  const url = process.env.PJ_LENS_HOLIDAYS_URL || DEFAULT_URL;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch((e) => {
    throw new Error(e.name === "TimeoutError" ? "祝日の一覧の取得がタイムアウトしました（15 秒）" : `祝日の一覧に接続できませんでした（${e.cause?.code ?? e.message}）`);
  });
  if (!res.ok) throw new Error(`祝日の一覧を取得できませんでした（HTTP ${res.status}）`);
  const dates = pickRecent(parseHolidayCsv(decodeHolidayCsv(new Uint8Array(await res.arrayBuffer()))), today());
  return { fetchedAt: today(), source: url, dates };
}

async function fetchAndSave(path) {
  const nationalHolidays = await fetchHolidays();
  const data = readJson(path); // 取得の間に他が更新していても消さないよう、書く直前に読み直す
  data.settings = { ...data.settings, nationalHolidays };
  save(path, data);
  return range(nationalHolidays.dates);
}

async function update(path) {
  out({ ok: true, ...(await fetchAndSave(path)) });
}

async function ensure(path) {
  const { need, reason } = needsHolidayUpdate(readJson(path).settings);
  if (!need) return out({ fetched: false, reason: null });
  out({ fetched: true, reason, ...(await fetchAndSave(path)) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, path] = process.argv.slice(2);
  if (!["update", "ensure", "status"].includes(cmd) || !path) { console.error(USAGE); process.exit(2); }
  try {
    if (cmd === "update") await update(path); else if (cmd === "ensure") await ensure(path); else out(holidayStatus(readJson(path).settings));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
