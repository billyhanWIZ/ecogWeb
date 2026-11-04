// 날짜는 모두 'YYYY-MM-DD' 문자열(한국 시간)로 다룬다.
const DAY = 86_400_000;

export function todayKST() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

const toMs = (d) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDays(d, n) {
  return fromMs(toMs(d) + n * DAY);
}

export function daysBetween(from, to) {
  return Math.round((toMs(to) - toMs(from)) / DAY) + 1;
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toMs(s));
}

/** ?from=&to= 검증. 기본값 = 올해 1월 1일 ~ 오늘 */
export function parsePeriod(query) {
  const today = todayKST();
  let from = isDate(query.from) ? query.from : `${today.slice(0, 4)}-01-01`;
  let to = isDate(query.to) ? query.to : today;
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 366 * 5) throw Object.assign(new Error('조회 기간은 5년 이내로 지정하세요'), { status: 400 });
  return { from, to, days: daysBetween(from, to) };
}

/** 같은 길이의 직전 기간 */
export function previousPeriod({ from, days }) {
  const to = addDays(from, -1);
  return { from: addDays(to, -(days - 1)), to, days };
}

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 월요일 기준 주 시작일 */
export function weekStart(d) {
  const wd = new Date(toMs(d)).getUTCDay(); // 0=일
  return addDays(d, -((wd + 6) % 7));
}

export function bucketOf(d, unit) {
  if (unit === 'month') return d.slice(0, 7);
  if (unit === 'week') return weekStart(d);
  return d;
}

export function buckets(from, to, unit) {
  const set = new Set(eachDay(from, to).map((d) => bucketOf(d, unit)));
  return [...set];
}

export function autoUnit(days) {
  if (days <= 62) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}

export function weekday(d) {
  return new Date(toMs(d)).getUTCDay();
}
