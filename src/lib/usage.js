// 세척 데이터 조회의 핵심.
// - eg_cleancount 의 같은 장비·같은 날짜 중복 행은 MAX 로 하나만 센다 (그날 누적값이므로)
// - 세척일 당시 배정된 설치처 기준으로 묶는다 (이설해도 과거 사용량은 이전 설치처에 남음)
import { q } from '../db.js';
import { addDays, daysBetween } from './dates.js';

/**
 * 테스트 장비 조건 (eg_device_test). test = 'exclude'(기본, 운영 숫자) | 'only' | 'all'
 * 대시보드·통계·리포트·사이니지·장비 목록은 모두 'exclude' 로 테스트 장비를 뺀다.
 */
export function testCond(alias, test = 'exclude') {
  if (test === 'all') return '1=1';
  const ex = `EXISTS (SELECT 1 FROM eg_device_test tt WHERE tt.deviceid = ${alias}.deviceid)`;
  return test === 'only' ? ex : `NOT ${ex}`;
}

/** 기간과 겹치는 배정 (설치처가 sites 안에 있는 것) */
export async function assignments(siteSns, from, to, test = 'exclude') {
  if (!siteSns.length) return [];
  return q(
    `SELECT a.sn, a.deviceid, a.site_sn, a.display_name, a.installed_on, a.removed_on, a.location_note,
            i.devicename, i.lastsignaldt
     FROM eg_device_site a
     LEFT JOIN eg_deviceinfo i ON i.deviceid = a.deviceid
     WHERE a.site_sn IN (?) AND a.installed_on <= ? AND (a.removed_on IS NULL OR a.removed_on > ?) AND ${testCond('a', test)}`,
    [siteSns, to, from]);
}

/** 장비·일자별 사용 횟수 [{site_sn, deviceid, d, cnt}] */
export async function dailyUsage(siteSns, from, to, deviceid = null, test = deviceid ? 'all' : 'exclude') {
  if (!siteSns.length) return [];
  return q(
    `SELECT a.site_sn, x.deviceid, DATE_FORMAT(x.cleandate, '%Y-%m-%d') AS d, x.cnt
     FROM (
       SELECT deviceid, cleandate, MAX(cleancount) AS cnt
       FROM eg_cleancount
       WHERE cleandate BETWEEN ? AND ? ${deviceid ? 'AND deviceid = ?' : ''}
       GROUP BY deviceid, cleandate
     ) x
     JOIN eg_device_site a
       ON a.deviceid = x.deviceid
      AND x.cleandate >= a.installed_on
      AND (a.removed_on IS NULL OR x.cleandate < a.removed_on)
     WHERE a.site_sn IN (?) AND ${testCond('a', test)}`,
    deviceid ? [from, to, deviceid, siteSns] : [from, to, siteSns]);
}

/** 지금 배정된 장비 (테스트 장비 제외) */
export async function currentDevices(siteSns, test = 'exclude') {
  if (!siteSns.length) return [];
  return q(`SELECT a.deviceid FROM eg_device_site a WHERE a.removed_on IS NULL AND a.site_sn IN (?) AND ${testCond('a', test)}`, [siteSns]);
}

/** 설치 이후 누적 사용 횟수 (배정 기간 기준, 테스트 장비 제외) */
export async function cumulativeUses(siteSns, test = 'exclude') {
  if (!siteSns.length) return 0;
  const [row] = await q(
    `SELECT COALESCE(SUM(x.cnt), 0) AS uses FROM (
       SELECT deviceid, cleandate, MAX(cleancount) cnt FROM eg_cleancount GROUP BY deviceid, cleandate
     ) x JOIN eg_device_site a ON a.deviceid = x.deviceid AND x.cleandate >= a.installed_on
       AND (a.removed_on IS NULL OR x.cleandate < a.removed_on)
     WHERE a.site_sn IN (?) AND ${testCond('a', test)}`, [siteSns]);
  return Number(row.uses);
}

/** 배정이 기간 안에서 유효한 일수 */
export function overlapDays(a, from, to) {
  const s = a.installed_on > from ? a.installed_on : from;
  const lastDay = a.removed_on ? addDays(a.removed_on, -1) : to;
  const e = lastDay < to ? lastDay : to;
  return s > e ? 0 : daysBetween(s, e);
}

/** 현재 신호 상태. ago = 마지막 신호 후 초 */
export async function signalStatus(deviceIds) {
  if (!deviceIds.length) return new Map();
  const rows = await q(
    `SELECT deviceid, devicename, DATE_FORMAT(lastsignaldt, '%Y-%m-%d %H:%i:%s') AS lastsignaldt,
            GREATEST(TIMESTAMPDIFF(SECOND, lastsignaldt, NOW()), 0) AS ago
     FROM eg_deviceinfo WHERE deviceid IN (?)`, [deviceIds]);
  return new Map(rows.map((r) => [r.deviceid, r]));
}

export function sum(arr, f = (x) => x) {
  let s = 0;
  for (const x of arr) s += Number(f(x)) || 0;
  return s;
}
