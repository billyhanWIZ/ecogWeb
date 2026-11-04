import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { parsePeriod } from '../lib/dates.js';
import { loadOrgs } from '../lib/orgs.js';
import { buildStats, resolveSites, loadUsage } from '../lib/stats.js';
import { signalStatus } from '../lib/usage.js';
import { getSettings, impact } from '../lib/settings.js';
import { q, one } from '../db.js';

const r = Router();

r.get('/dashboard', requireAuth, wrap(async (req, res) => {
  const period = parsePeriod(req.query);
  const tree = await loadOrgs();
  const s = await getSettings();
  const sites = resolveSites(tree, req.user, {});
  const data = await loadUsage(sites, period);

  const [bySite, bySido] = await Promise.all([
    buildStats(req.user, { by: 'site' }, period, data),
    buildStats(req.user, { by: 'sido' }, period, data),
  ]);

  // 지금 배정된 장비의 신호 상태
  const current = sites.length
    ? await q('SELECT deviceid FROM eg_device_site WHERE removed_on IS NULL AND site_sn IN (?)', [sites])
    : [];
  const sig = await signalStatus(current.map((c) => c.deviceid));
  let online = 0;
  let offline = 0;
  let never = 0;
  for (const c of current) {
    const x = sig.get(c.deviceid);
    if (!x || x.ago == null) never++;
    else if (x.ago <= s.offline_seconds) online++;
    else offline++;
  }

  // 누적 (전체 기간)
  const cum = sites.length
    ? await one(
      `SELECT COALESCE(SUM(x.cnt), 0) AS uses FROM (
         SELECT deviceid, cleandate, MAX(cleancount) cnt FROM eg_cleancount GROUP BY deviceid, cleandate
       ) x JOIN eg_device_site a ON a.deviceid = x.deviceid AND x.cleandate >= a.installed_on
         AND (a.removed_on IS NULL OR x.cleandate < a.removed_on)
       WHERE a.site_sn IN (?)`, [sites])
    : { uses: 0 };

  let unassigned = null;
  if (req.user.role === 'SYSADMIN') {
    const u = await one(`SELECT COUNT(*) n FROM eg_deviceinfo i
      WHERE NOT EXISTS (SELECT 1 FROM eg_device_site a WHERE a.deviceid = i.deviceid AND a.removed_on IS NULL)`);
    unassigned = u.n;
  }

  const t = bySite.total;
  res.json({
    period: bySite.period,
    prevPeriod: bySite.prevPeriod,
    unit: bySite.unit,
    kpi: {
      uses: t.uses,
      prevUses: t.prevUses,
      change: t.change,
      co2Kg: t.co2Kg,
      trees: t.trees,
      prevCo2Kg: impact(t.prevUses, s).co2Kg,
      devicesInstalled: current.length,
      devicesOnline: online,
      devicesUsed: new Set(data.daily.filter((d) => d.cnt > 0).map((d) => d.deviceid)).size,
      activeRate: t.activeRate,
      cumulativeUses: Number(cum.uses),
      cumulative: impact(Number(cum.uses), s),
    },
    health: { online, offline, never, unassigned },
    trend: bySite.series.buckets.map((b, i) => ({ bucket: b, uses: bySite.series.total[i] })),
    topSites: bySite.rows.filter((x) => x.uses > 0).slice(0, 10)
      .map(({ key, label, devices, uses, change }) => ({ key, label, devices, uses, change })),
    bySido: bySido.rows.map(({ key, label, devices, uses, co2Kg }) => ({ key, label, devices, uses, co2Kg })),
  });
}));

export default r;
