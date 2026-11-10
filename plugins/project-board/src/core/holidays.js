// 営業日の計算に使う休みと営業日の指定（settings から取り出す）と、内閣府の祝日一覧（CSV）の解析。ネットワークには触れない。
import { isDate, isWeekend } from "./dates.js";

const datesOf = (list) => (Array.isArray(list) ? list.filter((x) => isDate(x?.date)).map((x) => x.date) : []);

/**
 * settings → dueAfter の cal。休み = 手動の休み + 日本の祝日、営業日 = 営業日の指定。形が違う値は無視する（validate が注意を出す）。
 * settings.countWeekendsAndHolidays が true のとき（土日祝を営業日に数える）は、休み = 手動の休みだけにして、countWeekends: true を足す
 */
export function calendarOf(settings) {
  const st = settings ?? {};
  if (st.countWeekendsAndHolidays === true) return { off: datesOf(st.holidays), on: datesOf(st.workdays), countWeekends: true };
  return { off: [...datesOf(st.holidays), ...datesOf(st.nationalHolidays?.dates)], on: datesOf(st.workdays) };
}

/** 休みの日か（土日・休み・日本の祝日。土日祝を営業日に数える設定のときは、手動の休みだけ）。営業日の指定の日は、それらでも休みでない。スケジュールで枠を置けない日の判定に使う */
export function offDayChecker(settings) {
  const { off, on, countWeekends } = calendarOf(settings);
  const offSet = new Set(off), onSet = new Set(on);
  return (date) => !onSet.has(date) && ((!countWeekends && isWeekend(date)) || offSet.has(date));
}

/** ガントの着色用: 土日・手動の休み・日本の祝日か。「土日祝を営業日に数える」設定に関わらず同じ。営業日の指定の日は false */
export const restDayChecker = (settings) => offDayChecker({ ...settings, countWeekendsAndHolidays: false });

/** 内閣府の祝日一覧（Shift_JIS）を文字列にする */
export const decodeHolidayCsv = (bytes) => new TextDecoder("shift_jis").decode(bytes);

/** 「2026/1/1,元日」の行を { date, name } にして昇順で返す。ヘッダ・空行・日付でない行は飛ばす。有効な行が無ければ例外 */
export function parseHolidayCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.*)$/.exec(line.trim());
    if (!m) continue;
    const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (isDate(date)) rows.push({ date, name: m[4].trim() });
  }
  if (!rows.length) throw new Error("祝日の一覧を読み取れませんでした");
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** today の年の前年以降だけ残す（過去の全期間は保存しない） */
export const pickRecent = (rows, today) => rows.filter((r) => r.date.slice(0, 4) >= String(Number(today.slice(0, 4)) - 1));
