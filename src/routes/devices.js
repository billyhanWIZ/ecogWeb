import { Router } from 'express';
import { wrap, httpError } from '../lib/http.js';
import { requireAuth, requireRole, isAdmin } from '../lib/auth.js';
import { parsePeriod, todayKST, addDays, eachDay, weekday, isDate } from '../lib/dates.js';
import { loadOrgs, userScope, scopedSubtree, pathName, userRoots, ancestors } from '../lib/orgs.js';
import { dailyUsage, assignments, overlapDays } from '../lib/usage.js';
import { getSettings, impact } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { q, one, tx } from '../db.js';

const r = Router();

function statusOf(ago, s) {
  if (ago == null) return 'never';
  return ago <= s.offline_seconds ? 'online' : 'offline';
}

/** 장비 목록 (+ 최근 사용량, 상태) */
r.get('/devices', requireAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const s = await getSettings();
  const sites = scopedSubtree(tree, req.user, req.query.org || null);
  const viewRoot = userRoots(tree, req.user).length === 1 ? userRoots(tree, req.user)[0] : null;
  const today = todayKST();
  const yesterday = addDays(today, -1);
  const since = addDays(today, -30);

  const assigned = sites.length
    ? await q(
      `SELECT a.deviceid, a.site_sn, a.display_name, DATE_FORMAT(a.installed_on,'%Y-%m-%d') installed_on, a.location_note,
              i.devicename, DATE_FORMAT(i.lastsignaldt,'%Y-%m-%d %H:%i:%s') lastsignaldt,
              GREATEST(TIMESTAMPDIFF(SECOND, i.lastsignaldt, NOW()), 0) ago
       FROM eg_device_site a LEFT JOIN eg_deviceinfo i ON i.deviceid = a.deviceid
       WHERE a.removed_on IS NULL AND a.site_sn IN (?)`, [sites])
    : [];
  let unassigned = [];
  if (req.user.role === 'SYSADMIN' && !req.query.org) {
    unassigned = await q(
      `SELECT i.deviceid, NULL site_sn, NULL display_name, NULL installed_on, NULL location_note, i.devicename,
              DATE_FORMAT(i.lastsignaldt,'%Y-%m-%d %H:%i:%s') lastsignaldt, GREATEST(TIMESTAMPDIFF(SECOND, i.lastsignaldt, NOW()), 0) ago,
              DATE_FORMAT(h.hidden_at,'%Y-%m-%d %H:%i') hidden_at, h.reason hidden_reason,
              (h.deviceid IS NOT NULL AND i.lastsignaldt > h.hidden_at) signal_after_hide
       FROM eg_deviceinfo i
       LEFT JOIN eg_device_hidden h ON h.deviceid = i.deviceid
       WHERE NOT EXISTS (SELECT 1 FROM eg_device_site a WHERE a.deviceid = i.deviceid AND a.removed_on IS NULL)`);
  }
  const all = [...assigned, ...unassigned];
  const ids = all.map((d) => d.deviceid);
  const usage = ids.length
    ? await q(`SELECT deviceid, DATE_FORMAT(cleandate,'%Y-%m-%d') d, MAX(cleancount) cnt FROM eg_cleancount
               WHERE deviceid IN (?) AND cleandate >= ? GROUP BY deviceid, cleandate`, [ids, since])
    : [];
  const byDev = new Map();
  for (const u of usage) {
    if (!byDev.has(u.deviceid)) byDev.set(u.deviceid, new Map());
    byDev.get(u.deviceid).set(u.d, u.cnt);
  }
  const dropFrom = addDays(yesterday, -14);

  const list = all.map((d) => {
    const m = byDev.get(d.deviceid) || new Map();
    let last7 = 0;
    let last30 = 0;
    let prior14 = 0;
    for (const [day, c] of m) {
      if (day > addDays(today, -7)) last7 += c;
      last30 += c;
      if (day >= dropFrom && day < yesterday) prior14 += c;
    }
    const avg14 = prior14 / 14;
    const status = statusOf(d.ago, s);
    return {
      deviceid: d.deviceid,
      name: d.display_name || d.devicename || d.deviceid,
      siteSn: d.site_sn,
      sitePath: d.site_sn ? pathName(tree, d.site_sn, viewRoot) : null,
      installedOn: d.installed_on,
      locationNote: d.location_note,
      lastSignal: d.lastsignaldt,
      ago: d.ago,
      status,
      assigned: d.site_sn != null,
      today: m.get(today) || 0,
      yesterday: m.get(yesterday) || 0,
      last7,
      last30,
      avg14: Math.round(avg14 * 10) / 10,
      drop: (m.get(yesterday) || 0) === 0 && avg14 >= s.drop_min_avg,
      hidden: !!d.hidden_at,
      hiddenAt: d.hidden_at || null,
      hiddenReason: d.hidden_reason || null,
      signalAfterHide: !!Number(d.signal_after_hide || 0),
    };
  });

  const counts = {
    all: list.filter((d) => d.assigned).length,
    online: list.filter((d) => d.assigned && d.status === 'online').length,
    offline: list.filter((d) => d.assigned && d.status !== 'online').length,
    drop: list.filter((d) => d.assigned && d.drop).length,
    unassigned: list.filter((d) => !d.assigned && !d.hidden).length,
    hidden: list.filter((d) => d.hidden).length,
  };
  const st = req.query.status || 'all';
  const kw = String(req.query.q || '').trim().toLowerCase();
  const filtered = list.filter((d) => {
    if (st === 'hidden') { if (!d.hidden) return false; }
    else if (st === 'unassigned') { if (d.assigned || d.hidden) return false; }
    else {
      if (!d.assigned) return false;
      if (st === 'online' && d.status !== 'online') return false;
      if (st === 'offline' && d.status === 'online') return false;
      if (st === 'drop' && !d.drop) return false;
    }
    if (kw && !`${d.deviceid} ${d.name} ${d.sitePath || ''} ${d.locationNote || ''}`.toLowerCase().includes(kw)) return false;
    return true;
  }).sort((a, b) => {
    if (st === 'hidden') return String(b.hiddenAt).localeCompare(String(a.hiddenAt));
    if (st === 'unassigned' || st === 'offline') return (a.ago ?? 1e12) - (b.ago ?? 1e12);
    return b.last30 - a.last30;
  });

  res.json({ counts, devices: filtered, offlineSeconds: s.offline_seconds });
}));

/** 이 사용자가 이 장비를 볼 수 있는지 + 배정 이력 */
async function deviceAccess(req, deviceid) {
  const tree = await loadOrgs();
  const info = await one(
    `SELECT deviceid, devicename, DATE_FORMAT(lastsignaldt,'%Y-%m-%d %H:%i:%s') lastsignaldt,
            GREATEST(TIMESTAMPDIFF(SECOND, lastsignaldt, NOW()), 0) ago FROM eg_deviceinfo WHERE deviceid = ?`, [deviceid]);
  if (!info) throw httpError(404, '장비를 찾을 수 없습니다');
  const hist = await q(
    `SELECT sn, site_sn, display_name, DATE_FORMAT(installed_on,'%Y-%m-%d') installed_on,
            DATE_FORMAT(removed_on,'%Y-%m-%d') removed_on, location_note, memo
     FROM eg_device_site WHERE deviceid = ? ORDER BY installed_on DESC, sn DESC`, [deviceid]);
  const scope = userScope(tree, req.user);
  const visible = req.user.role === 'SYSADMIN' ? hist : hist.filter((h) => scope.has(h.site_sn));
  if (req.user.role !== 'SYSADMIN' && !visible.length) throw httpError(404, '장비를 찾을 수 없습니다');
  return { tree, info, hist: visible, scope };
}

r.get('/devices/:id', requireAuth, wrap(async (req, res) => {
  const { tree, info, hist, scope } = await deviceAccess(req, req.params.id);
  const s = await getSettings();
  const period = parsePeriod({ from: req.query.from || addDays(todayKST(), -29), to: req.query.to });
  const viewRoot = userRoots(tree, req.user).length === 1 ? userRoots(tree, req.user)[0] : null;

  let daily;
  if (req.user.role === 'SYSADMIN') {
    daily = await q(`SELECT DATE_FORMAT(cleandate,'%Y-%m-%d') d, MAX(cleancount) cnt FROM eg_cleancount
                     WHERE deviceid = ? AND cleandate BETWEEN ? AND ? GROUP BY cleandate`, [info.deviceid, period.from, period.to]);
  } else {
    daily = await dailyUsage([...scope], period.from, period.to, info.deviceid);
  }
  const m = new Map(daily.map((d) => [d.d, d.cnt]));
  const days = eachDay(period.from, period.to);
  const series = days.map((d) => ({ d, uses: m.get(d) || 0 }));
  const uses = series.reduce((x, y) => x + y.uses, 0);

  const wdSum = Array(7).fill(0);
  const wdCnt = Array(7).fill(0);
  for (const x of series) { wdSum[weekday(x.d)] += x.uses; wdCnt[weekday(x.d)]++; }

  // 같은 설치처 장비 평균 (장비·일 기준)
  const cur = hist.find((h) => !h.removed_on);
  let siteAvg = null;
  if (cur) {
    const assign = await assignments([cur.site_sn], period.from, period.to);
    const sd = await dailyUsage([cur.site_sn], period.from, period.to);
    const dd = assign.reduce((x, a) => x + overlapDays(a, period.from, period.to), 0);
    siteAvg = { devices: new Set(assign.map((a) => a.deviceid)).size, perDeviceDay: dd ? sd.reduce((x, y) => x + y.cnt, 0) / dd : 0 };
  }
  const total = await one('SELECT COALESCE(SUM(c),0) uses FROM (SELECT MAX(cleancount) c FROM eg_cleancount WHERE deviceid = ? GROUP BY cleandate) x', [info.deviceid]);
  const hidden = req.user.role === 'SYSADMIN'
    ? await one("SELECT DATE_FORMAT(hidden_at,'%Y-%m-%d %H:%i') hidden_at, reason FROM eg_device_hidden WHERE deviceid = ?", [info.deviceid])
    : null;

  res.json({
    device: {
      deviceid: info.deviceid,
      name: cur?.display_name || info.devicename || info.deviceid,
      deviceName: info.devicename,
      lastSignal: info.lastsignaldt,
      ago: info.ago,
      status: statusOf(info.ago, s),
      current: cur ? { ...cur, sitePath: pathName(tree, cur.site_sn, viewRoot) } : null,
      totalUses: Number(total.uses),
      hidden: hidden ? { at: hidden.hidden_at, reason: hidden.reason } : null,
    },
    history: hist.map((h) => ({ ...h, sitePath: tree.byId.has(h.site_sn) ? pathName(tree, h.site_sn, viewRoot) : `(삭제된 조직 ${h.site_sn})` })),
    period,
    uses,
    perDay: uses / period.days,
    impact: impact(uses, s),
    series,
    weekday: ['일', '월', '화', '수', '목', '금', '토'].map((n, i) => ({ day: n, avg: wdCnt[i] ? wdSum[i] / wdCnt[i] : 0 })),
    siteAvg,
    canEdit: isAdmin(req.user),
    canAssign: req.user.role === 'SYSADMIN',
  });
}));

/** 이름·위치 메모 수정 (현재 배정에) */
r.patch('/devices/:id', requireRole('SYSADMIN', 'CUSTADMIN'), wrap(async (req, res) => {
  const { hist } = await deviceAccess(req, req.params.id);
  const cur = hist.find((h) => !h.removed_on);
  if (!cur) throw httpError(400, '설치처에 배정된 장비만 수정할 수 있습니다');
  const { displayName, locationNote, memo } = req.body || {};
  await q('UPDATE eg_device_site SET display_name = ?, location_note = ?, memo = ? WHERE sn = ?',
    [displayName?.trim() || null, locationNote?.trim() || null, memo?.trim() || null, cur.sn]);
  await audit(req, 'device.update', 'device', req.params.id, { displayName, locationNote, memo });
  res.json({ ok: true });
}));

/** 구 화면이 계속 보도록 eg_deviceinfo.mangegroup 을 맞춘다 (장비는 이 컬럼을 쓰지 않음) */
async function syncLegacyGroup(run, tree, deviceid, siteSn) {
  let legacy = null;
  if (siteSn != null) {
    const chain = ancestors(tree, siteSn);
    for (let i = chain.length - 1; i >= 0; i--) if (chain[i].legacy_group_sn) { legacy = chain[i].legacy_group_sn; break; }
  }
  await run('UPDATE eg_deviceinfo SET mangegroup = ? WHERE deviceid = ?', [legacy, deviceid]);
}

/** 설치처 배정·이설 */
r.post('/devices/:id/assign', requireRole('SYSADMIN'), wrap(async (req, res) => {
  const deviceid = req.params.id;
  const { siteSn, installedOn, displayName, locationNote, memo } = req.body || {};
  const tree = await loadOrgs();
  if (!tree.byId.has(Number(siteSn))) throw httpError(400, '설치처를 선택하세요');
  const day = isDate(installedOn) ? installedOn : todayKST();
  const info = await one('SELECT deviceid, devicename FROM eg_deviceinfo WHERE deviceid = ?', [deviceid]);
  if (!info) throw httpError(404, '장비를 찾을 수 없습니다');

  await tx(async (run) => {
    const [cur] = await run('SELECT sn, site_sn, DATE_FORMAT(installed_on,"%Y-%m-%d") installed_on, display_name FROM eg_device_site WHERE deviceid = ? AND removed_on IS NULL FOR UPDATE', [deviceid]);
    if (cur) {
      if (day <= cur.installed_on) throw httpError(400, `새 설치일은 현재 설치일(${cur.installed_on})보다 뒤여야 합니다`);
      await run('UPDATE eg_device_site SET removed_on = ? WHERE sn = ?', [day, cur.sn]);
    }
    await run('INSERT INTO eg_device_site (deviceid, site_sn, display_name, installed_on, location_note, memo, created_by) VALUES (?,?,?,?,?,?,?)',
      [deviceid, Number(siteSn), displayName?.trim() || cur?.display_name || info.devicename || null, day, locationNote?.trim() || null, memo?.trim() || null, req.user.sn]);
    await syncLegacyGroup(run, tree, deviceid, Number(siteSn));
    await run('DELETE FROM eg_device_hidden WHERE deviceid = ?', [deviceid]); // 배정하면 숨김 해제
  });
  await audit(req, 'device.assign', 'device', deviceid, { siteSn, installedOn: day });
  res.json({ ok: true });
}));

/** 철거 (배정 해제) */
r.post('/devices/:id/unassign', requireRole('SYSADMIN'), wrap(async (req, res) => {
  const deviceid = req.params.id;
  const day = isDate(req.body?.removedOn) ? req.body.removedOn : todayKST();
  const tree = await loadOrgs();
  await tx(async (run) => {
    const [cur] = await run('SELECT sn, DATE_FORMAT(installed_on,"%Y-%m-%d") installed_on FROM eg_device_site WHERE deviceid = ? AND removed_on IS NULL FOR UPDATE', [deviceid]);
    if (!cur) throw httpError(400, '배정된 설치처가 없습니다');
    if (day <= cur.installed_on) throw httpError(400, '철거일은 설치일보다 뒤여야 합니다');
    await run('UPDATE eg_device_site SET removed_on = ? WHERE sn = ?', [day, cur.sn]);
    await syncLegacyGroup(run, tree, deviceid, null);
  });
  await audit(req, 'device.unassign', 'device', deviceid, { removedOn: day });
  res.json({ ok: true });
}));

/** 목록에서 숨기기 (여러 대). 설치처에 배정된 장비는 먼저 철거해야 한다. 장비 테이블은 건드리지 않는다 */
r.post('/devices/hide', requireRole('SYSADMIN'), wrap(async (req, res) => {
  const ids = [...new Set((req.body?.deviceids || []).map(String))].slice(0, 500);
  if (!ids.length) throw httpError(400, '숨길 장비를 고르세요');
  const reason = String(req.body?.reason || '').trim().slice(0, 200) || null;
  const assigned = await q('SELECT DISTINCT deviceid FROM eg_device_site WHERE removed_on IS NULL AND deviceid IN (?)', [ids]);
  if (assigned.length) throw httpError(400, `설치처에 배정된 장비는 먼저 철거하세요: ${assigned.map((a) => a.deviceid).join(', ')}`);
  const known = await q('SELECT deviceid FROM eg_deviceinfo WHERE deviceid IN (?)', [ids]);
  if (!known.length) throw httpError(404, '장비를 찾을 수 없습니다');
  await q(`INSERT INTO eg_device_hidden (deviceid, hidden_by, reason) VALUES ?
           ON DUPLICATE KEY UPDATE hidden_at = NOW(), hidden_by = VALUES(hidden_by), reason = VALUES(reason)`,
  [known.map((k) => [k.deviceid, req.user.sn, reason])]);
  await audit(req, 'device.hide', 'device', known.length === 1 ? known[0].deviceid : `${known.length}대`, { deviceids: known.map((k) => k.deviceid), reason });
  res.json({ ok: true, count: known.length });
}));

r.post('/devices/unhide', requireRole('SYSADMIN'), wrap(async (req, res) => {
  const ids = [...new Set((req.body?.deviceids || []).map(String))].slice(0, 500);
  if (!ids.length) throw httpError(400, '되살릴 장비를 고르세요');
  const out = await q('DELETE FROM eg_device_hidden WHERE deviceid IN (?)', [ids]);
  await audit(req, 'device.unhide', 'device', ids.length === 1 ? ids[0] : `${ids.length}대`, { deviceids: ids });
  res.json({ ok: true, count: out.affectedRows });
}));

export default r;
