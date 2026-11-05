// 세척기 태블릿: 등록 코드·토큰, 세척 기록 저장.
// 태블릿 API 는 2.0 이 eg_cleancount·eg_deviceinfo 에 쓰는 유일한 곳이다 (CLAUDE.md 예외 참고).
import crypto from 'node:crypto';
import { one, q, pool } from '../db.js';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 한국 시각 Date 부품 (서버 시간대와 무관) */
function kstParts(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600_000);
  return {
    y: d.getUTCFullYear(), m: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()), M: pad(d.getUTCMinutes()), S: pad(d.getUTCSeconds()), ms: pad(d.getUTCMilliseconds(), 3),
  };
}
/** 'YYYY-MM-DD HH:MM:SS' (KST) */
export function kstDateTime(ms) {
  const p = kstParts(ms);
  return `${p.y}-${p.m}-${p.d} ${p.H}:${p.M}:${p.S}`;
}

/** 새 장비 ID. Unity 앱과 같은 형식(ECOGID_yyyyMMdd_HHmmss.fff) — 날짜 부분은 설치일 추정에 쓰인다 */
export async function newDeviceId() {
  for (let i = 0; i < 5; i++) {
    const p = kstParts(Date.now() + i * 7);
    const id = `ECOGID_${p.y}${p.m}${p.d}_${p.H}${p.M}${p.S}.${p.ms}`;
    if (!(await one('SELECT 1 x FROM eg_deviceinfo WHERE deviceid = ?', [id]))) return id;
  }
  throw new Error('장비 ID 를 만들지 못했습니다. 다시 시도하세요');
}

/** 8자리 숫자 등록 코드 (24시간 유효). 이미 있던 코드는 새 코드로 바뀐다 */
export async function issueCode(deviceid, userSn) {
  for (let i = 0; i < 10; i++) {
    const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
    if (await one('SELECT 1 x FROM eg_tablet WHERE reg_code = ?', [code])) continue;
    await q(`INSERT INTO eg_tablet (deviceid, reg_code, reg_code_expires, reg_code_by) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), ?)
             ON DUPLICATE KEY UPDATE reg_code = VALUES(reg_code), reg_code_expires = VALUES(reg_code_expires), reg_code_by = VALUES(reg_code_by)`,
    [deviceid, code, userSn]);
    const row = await one("SELECT DATE_FORMAT(reg_code_expires,'%Y-%m-%d %H:%i') expires FROM eg_tablet WHERE deviceid = ?", [deviceid]);
    return { code, expires: row.expires };
  }
  throw new Error('등록 코드를 만들지 못했습니다. 다시 시도하세요');
}

/** 등록 코드 → 새 토큰. 같은 장비의 이전 태블릿 토큰은 이때 끊긴다 */
export async function activate(code) {
  const row = await one('SELECT deviceid FROM eg_tablet WHERE reg_code = ? AND reg_code_expires > NOW()', [code]);
  if (!row) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const res = await q(`UPDATE eg_tablet SET token_hash = ?, activated_at = NOW(), reg_code = NULL, reg_code_expires = NULL, ble_state = NULL
                       WHERE deviceid = ? AND reg_code = ?`, [sha256(token), row.deviceid, code]);
  if (!res.affectedRows) return null;
  return { deviceid: row.deviceid, token };
}

export async function tabletByToken(token) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token || '')) return null;
  return one('SELECT deviceid FROM eg_tablet WHERE token_hash = ?', [sha256(token)]);
}

/** 장비의 오늘 횟수와 전체 누적 (같은 날 중복 행은 MAX) */
export async function deviceTotals(deviceid, today) {
  const row = await one(
    `SELECT COALESCE(SUM(c), 0) total, COALESCE(MAX(IF(d = ?, c, NULL)), 0) today
     FROM (SELECT DATE_FORMAT(cleandate,'%Y-%m-%d') d, MAX(cleancount) c FROM eg_cleancount WHERE deviceid = ? GROUP BY cleandate) x`,
    [today, deviceid]);
  return { total: Number(row.total), today: Number(row.today) };
}

export const RESULTS = new Set(['S', 'T', 'F']);
export const COUNTED = new Set(['S', 'T']);

/**
 * 세척 기록 저장. events = [{ id, startedAt, endedAt, result, durationMs }] (시각은 epoch ms)
 * - uuid 가 이미 있으면 건너뛴다(재전송). 새로 들어온 성공 건만 그날 eg_cleancount 에 더한다.
 * - eg_cleancount 는 (장비, 날짜) 의 MAX 를 읽어 더한 값으로 그날 행을 모두 맞춘다(구 데이터의 중복 행 포함).
 *   행이 없으면 하나 만든다. 장비 단위 잠금으로 동시 요청에도 중복 행이 생기지 않게 한다.
 * 돌려주는 값: 처리가 끝난(새로 저장했거나 이미 있던) id 목록
 */
export async function saveEvents(deviceid, events) {
  const now = Date.now();
  const rows = [];
  const done = [];
  for (const e of events) {
    const id = String(e?.id || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(id) || !RESULTS.has(e.result)) continue; // 형식이 틀리면 버린다 (태블릿은 응답에 없는 건을 지운다)
    let ended = Number(e.endedAt);
    if (!Number.isFinite(ended) || ended > now + 10 * 60_000) ended = now; // 태블릿 시계가 앞서면 받은 시각으로
    if (ended < now - 400 * 86400_000) { done.push(id); continue; } // 너무 오래된 건은 받기만 하고 버린다
    let started = Number(e.startedAt);
    if (!Number.isFinite(started) || started > ended || started < ended - 3600_000) started = null;
    const dur = Number.isFinite(Number(e.durationMs)) ? Math.max(0, Math.min(3_600_000, Math.round(Number(e.durationMs)))) : null;
    const endedStr = kstDateTime(ended);
    rows.push({ id, started: started ? kstDateTime(started) : null, ended: endedStr, date: endedStr.slice(0, 10), result: e.result, dur });
  }
  if (!rows.length) return done;

  const conn = await pool.getConnection();
  const lock = `ecog_cc:${deviceid}`;
  try {
    const [[got]] = await conn.query('SELECT GET_LOCK(?, 10) ok', [lock]);
    if (!got?.ok) throw Object.assign(new Error('잠시 뒤 다시 보내 주세요'), { status: 503 });
    try {
      await conn.beginTransaction();
      const add = new Map(); // date → 새로 센 건수
      for (const r of rows) {
        const counted = COUNTED.has(r.result) ? 1 : 0;
        const [res] = await conn.query(
          `INSERT IGNORE INTO eg_clean_event (deviceid, uuid, started_at, ended_at, cleandate, result, duration_ms, counted)
           VALUES (?,?,?,?,?,?,?,?)`, [deviceid, r.id.toLowerCase(), r.started, r.ended, r.date, r.result, r.dur, counted]);
        if (res.affectedRows && counted) add.set(r.date, (add.get(r.date) || 0) + 1);
        done.push(r.id);
      }
      for (const [date, n] of add) {
        const [[cur]] = await conn.query('SELECT MAX(cleancount) m, COUNT(*) k FROM eg_cleancount WHERE deviceid = ? AND cleandate = ?', [deviceid, date]);
        if (Number(cur.k)) {
          await conn.query('UPDATE eg_cleancount SET cleancount = ? WHERE deviceid = ? AND cleandate = ?', [Number(cur.m || 0) + n, deviceid, date]);
        } else {
          await conn.query('INSERT INTO eg_cleancount (deviceid, cleandate, cleancount) VALUES (?,?,?)', [deviceid, date, n]);
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [lock]);
    }
  } finally {
    conn.release();
  }
  return done;
}
