// 세척기 태블릿(웹 /t, 안드로이드 APK) 이 부르는 API. 로그인 대신 태블릿 토큰(Authorization: Bearer)을 쓴다.
// 기존 .do API(Unity 태블릿)는 그대로 두고, 같은 테이블 형식으로 쓴다.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { wrap, httpError } from '../lib/http.js';
import { activate, tabletByToken, saveEvents, deviceTotals } from '../lib/tablet.js';
import { loadOrgs, pathName, inherited, ancestors } from '../lib/orgs.js';
import { getSettings } from '../lib/settings.js';
import { orgLocation, weatherFor } from '../lib/weather.js';
import { todayKST } from '../lib/dates.js';
import { one, q } from '../db.js';
import { config } from '../config.js';

const r = Router();

// 등록 코드 맞히기 막기: IP 당 10분에 10번 틀리면 잠시 막는다
const fails = new Map();
function checkFails(ip) {
  const f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.at < 10 * 60_000) throw httpError(429, '여러 번 틀렸습니다. 10분 뒤 다시 시도하세요');
}
function addFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.at > 10 * 60_000) fails.set(ip, { n: 1, at: Date.now() });
  else f.n++;
  if (fails.size > 5000) fails.clear();
}

r.post('/tablet/activate', wrap(async (req, res) => {
  checkFails(req.ip);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (code.length !== 8) throw httpError(400, '등록 코드 8자리를 넣으세요');
  const out = await activate(code);
  if (!out) {
    addFail(req.ip);
    throw httpError(404, '맞지 않거나 시간이 지난 코드입니다. 관리자 화면에서 새 코드를 받으세요');
  }
  await q('INSERT INTO eg_audit_log (user_sn, action, target_type, target_id, detail) VALUES (NULL, ?, ?, ?, ?)',
    ['tablet.activate', 'device', out.deviceid, JSON.stringify({ ip: req.ip, ua: String(req.get('user-agent') || '').slice(0, 200) })]).catch(() => {});
  res.json(out);
}));

async function tabletAuth(req, _res, next) {
  try {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    const t = m ? await tabletByToken(m[1]) : null;
    if (!t) throw httpError(401, '등록이 풀린 태블릿입니다. 다시 등록하세요');
    req.tablet = t;
    next();
  } catch (e) {
    next(e);
  }
}

/** 화면에 필요한 것: 이름, 설치처, 누적·오늘 횟수, 환산계수, 날씨 */
r.get('/tablet/state', tabletAuth, wrap(async (req, res) => {
  const id = req.tablet.deviceid;
  const tree = await loadOrgs();
  const s = await getSettings();
  const info = await one('SELECT devicename FROM eg_deviceinfo WHERE deviceid = ?', [id]);
  const cur = await one('SELECT site_sn, display_name, location_note FROM eg_device_site WHERE deviceid = ? AND removed_on IS NULL', [id]);
  const site = cur && tree.byId.has(cur.site_sn) ? cur.site_sn : null;
  const chain = site ? ancestors(tree, site) : [];
  const totals = await deviceTotals(id, todayKST());
  const weather = site ? await weatherFor(orgLocation(tree, site)).catch(() => null) : null;
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    deviceid: id,
    name: cur?.display_name || info?.devicename || null,
    site: site ? { name: tree.byId.get(site).name, path: pathName(tree, site), top: chain[0]?.name || null, location: cur.location_note } : null,
    hasLogo: !!(site && inherited(tree, site, 'logo_path')),
    // 배경 사진이 바뀌면 태블릿이 다시 받도록 파일 이름(업로드 시각 포함)을 버전으로 준다
    bg: site ? inherited(tree, site, 'bg_path') || null : null,
    totals,
    factors: { co2PerUseG: s.co2_per_use_g, co2PerTreeKg: s.co2_per_tree_kg },
    weather,
    serverTime: Date.now(),
  });
}));

/** 설치처(위로 올라가며) 로고. 없으면 204 */
r.get('/tablet/logo', tabletAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const cur = await one('SELECT site_sn FROM eg_device_site WHERE deviceid = ? AND removed_on IS NULL', [req.tablet.deviceid]);
  const file = cur && tree.byId.has(cur.site_sn) ? inherited(tree, cur.site_sn, 'logo_path') : null;
  const full = file ? path.join(config.dataDir, 'logos', path.basename(file)) : null;
  if (!full || !fs.existsSync(full)) return res.status(204).end();
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.sendFile(full);
}));

/** 설치처(위로 올라가며) 태블릿 배경 사진. 없으면 204 (기본 숲 사진) */
r.get('/tablet/background', tabletAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const cur = await one('SELECT site_sn FROM eg_device_site WHERE deviceid = ? AND removed_on IS NULL', [req.tablet.deviceid]);
  const file = cur && tree.byId.has(cur.site_sn) ? inherited(tree, cur.site_sn, 'bg_path') : null;
  const full = file ? path.join(config.dataDir, 'backgrounds', path.basename(file)) : null;
  if (!full || !fs.existsSync(full)) return res.status(204).end();
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.sendFile(full);
}));

const BLE = new Set(['connected', 'connecting', 'disconnected', 'off']);
/** 10초마다. 태블릿이 살아 있음(eg_deviceinfo.lastsignaldt, 구 화면과 같은 의미) + 세척기 블루투스 연결 상태 */
r.post('/tablet/heartbeat', tabletAuth, wrap(async (req, res) => {
  const id = req.tablet.deviceid;
  const b = req.body || {};
  const ble = BLE.has(b.ble) ? b.ble : null;
  await q('UPDATE eg_deviceinfo SET lastsignaldt = NOW() WHERE deviceid = ?', [id]);
  await q(`UPDATE eg_tablet SET last_seen = NOW(),
             ble_changed_at = IF(ble_state <=> ?, ble_changed_at, NOW()), ble_state = ?,
             app_kind = ?, app_version = ?, user_agent = ?
           WHERE deviceid = ?`,
  [ble, ble, b.appKind === 'apk' ? 'apk' : 'web', String(b.appVersion || '').slice(0, 40) || null, String(req.get('user-agent') || '').slice(0, 200), id]);
  res.json({ ok: true, serverTime: Date.now(), version: req.app.locals.version });
}));

/** 세척 기록 묶음. 인터넷이 끊겼던 동안 쌓인 것도 한꺼번에 온다 */
r.post('/tablet/clean', tabletAuth, wrap(async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 500) : [];
  const done = events.length ? await saveEvents(req.tablet.deviceid, events) : [];
  const totals = await deviceTotals(req.tablet.deviceid, todayKST());
  res.json({ done, totals });
}));

export default r;
