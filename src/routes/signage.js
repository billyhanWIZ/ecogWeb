// 사이니지: 설치처 로비 TV·QR 로 여는 로그인 없는 화면. 토큰을 아는 사람만, 합계 숫자만 보여준다.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { wrap, httpError } from '../lib/http.js';
import { loadOrgs, descendants, inherited } from '../lib/orgs.js';
import { dailyUsage, signalStatus } from '../lib/usage.js';
import { getSettings, impact } from '../lib/settings.js';
import { todayKST, addDays, eachDay } from '../lib/dates.js';
import { q, one } from '../db.js';
import { config } from '../config.js';

const r = Router();
const cache = new Map(); // token → { at, data }

async function orgByToken(token) {
  if (!/^[A-Za-z0-9_-]{16,60}$/.test(token || '')) throw httpError(404, '없는 화면입니다');
  const row = await one("SELECT sn FROM eg_org WHERE signage_token = ? AND use_yn = 'Y'", [token]);
  if (!row) throw httpError(404, '없는 화면입니다');
  const tree = await loadOrgs();
  const org = tree.byId.get(row.sn);
  if (!org) throw httpError(404, '없는 화면입니다');
  return { tree, org };
}

r.get('/signage/:token', wrap(async (req, res) => {
  const hit = cache.get(req.params.token);
  if (hit && Date.now() - hit.at < 30_000) return res.json(hit.data);
  const { tree, org } = await orgByToken(req.params.token);
  const s = await getSettings();
  const sites = descendants(tree, org.sn);
  const today = todayKST();
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  const from14 = addDays(today, -13);
  const daily = await dailyUsage(sites, from14 < yearFrom ? from14 : yearFrom, today);
  const sumWhere = (f) => daily.filter(f).reduce((x, d) => x + d.cnt, 0);
  const cum = await one(
    `SELECT COALESCE(SUM(x.cnt), 0) AS uses FROM (
       SELECT deviceid, cleandate, MAX(cleancount) cnt FROM eg_cleancount GROUP BY deviceid, cleandate
     ) x JOIN eg_device_site a ON a.deviceid = x.deviceid AND x.cleandate >= a.installed_on
       AND (a.removed_on IS NULL OR x.cleandate < a.removed_on)
     WHERE a.site_sn IN (?)`, [sites]);
  const current = await q('SELECT deviceid FROM eg_device_site WHERE removed_on IS NULL AND site_sn IN (?)', [sites]);
  const sig = await signalStatus(current.map((c) => c.deviceid));
  const online = current.filter((c) => (sig.get(c.deviceid)?.ago ?? Infinity) <= s.offline_seconds).length;
  const byDay = new Map();
  for (const d of daily) byDay.set(d.d, (byDay.get(d.d) || 0) + d.cnt);

  const cumUses = Number(cum.uses);
  const data = {
    name: org.name,
    logo: inherited(tree, org.sn, 'logo_path') ? `/api/signage/${req.params.token}/logo` : '/img/ecog-logo-white.png',
    logoCustom: !!inherited(tree, org.sn, 'logo_path'),
    today: sumWhere((d) => d.d === today),
    month: sumWhere((d) => d.d.slice(0, 7) === today.slice(0, 7)),
    year: sumWhere((d) => d.d >= yearFrom),
    cumulative: cumUses,
    cumulativeImpact: impact(cumUses, s),
    yearImpact: impact(sumWhere((d) => d.d >= yearFrom), s),
    devices: current.length,
    online,
    last14: eachDay(from14, today).map((d) => ({ d, uses: byDay.get(d) || 0 })),
    updatedAt: new Date(Date.now() + 9 * 3600_000).toISOString().slice(11, 16),
  };
  cache.set(req.params.token, { at: Date.now(), data });
  res.setHeader('Cache-Control', 'no-store');
  res.json(data);
}));

r.get('/signage/:token/logo', wrap(async (req, res) => {
  const { tree, org } = await orgByToken(req.params.token);
  const file = inherited(tree, org.sn, 'logo_path');
  const full = file ? path.join(config.dataDir, 'logos', path.basename(file)) : null;
  if (!full || !fs.existsSync(full)) return res.redirect('/img/ecog-logo-white.png');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.sendFile(full);
}));

export function clearSignageCache() {
  cache.clear();
}

export default r;
