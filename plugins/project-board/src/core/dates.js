// 日付(YYYY-MM-DD)・時刻(HH:MM)の文字列演算。Date の UTC 変換によるずれを避けるため、数値分解で計算する。

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// 暦日 → 1970-01-01 からの通算日数（グレゴリオ暦、proleptic）
function toDays(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** 実在する YYYY-MM-DD か */
export function isDate(s) {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const [y2, m2, d2] = fromDays(toDays(y, mo, d));
  return y === y2 && mo === m2 && d === d2;
}

/** HH:MM（00:00〜23:59）か */
export function isTime(s) {
  return typeof s === "string" && TIME_RE.test(s);
}

function parse(s) {
  if (!isDate(s)) throw new Error(`日付の形式が不正です: ${s}`);
  const m = DATE_RE.exec(s);
  return toDays(+m[1], +m[2], +m[3]);
}

export function addDays(date, n) {
  const [y, m, d] = fromDays(parse(date) + n);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

const MAX_BUSINESS_DAYS = 3650;

/**
 * baseDate の businessDays 営業日後。businessDays は 0 以上の整数で、0 なら baseDate のまま。
 * cal.on（営業日の指定）の日は営業日。それ以外は、cal.off（休み）と土日を飛ばす。cal.countWeekends が true なら、土日は飛ばさない。
 */
export function dueAfter(baseDate, businessDays, cal = {}) {
  if (!Number.isInteger(businessDays) || businessDays < 0) throw new Error(`営業日は 0 以上の整数にしてください: ${businessDays}`);
  if (businessDays > MAX_BUSINESS_DAYS) throw new Error(`営業日は ${MAX_BUSINESS_DAYS} 日（約 10 年）以下にしてください: ${businessDays}`); // 1 日ずつ数えるので、打ち間違いで止まらないようにする
  const off = new Set(cal.off ?? []), on = new Set(cal.on ?? []), countWeekends = cal.countWeekends === true;
  let d = baseDate;
  parse(d);
  for (let n = 0; n < businessDays;) {
    d = addDays(d, 1);
    if (on.has(d) || !(off.has(d) || (!countWeekends && isWeekend(d)))) n++;
  }
  return d;
}

/** a - b（日数） */
export function diffDays(a, b) {
  return parse(a) - parse(b);
}

/** 曜日（0=日 … 6=土） */
export function weekday(date) {
  return (((parse(date) + 4) % 7) + 7) % 7;
}

export const isWeekend = (date) => [0, 6].includes(weekday(date));

export function toMin(hhmm) {
  if (!isTime(hhmm) && hhmm !== "24:00") throw new Error(`時刻の形式が不正です: ${hhmm}`);
  const [h, m] = hhmm.split(":");
  return +h * 60 + +m;
}

export function toHHMM(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** 実行環境のローカル日付 */
export function today() {
  const n = new Date();
  return `${pad(n.getFullYear(), 4)}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** 実行環境のローカル現在時刻 */
export function nowLocal() {
  const n = new Date();
  return { date: today(), time: `${pad(n.getHours())}:${pad(n.getMinutes())}` };
}
