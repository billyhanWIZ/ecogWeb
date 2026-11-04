import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { parsePeriod } from '../lib/dates.js';
import { loadOrgs } from '../lib/orgs.js';
import { buildStats, resolveSites, loadUsage } from '../lib/stats.js';
import { signalStatus, currentDevices, cumulativeUses } from '../lib/usage.js';
import { getSettings, impact } from '../lib/settings.js';
import { q, one } from '../db.js';
import { userLocation, weatherFor } from '../lib/weather.js';

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
  const current = await currentDevices(sites);
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
  const cum = { uses: await cumulativeUses(sites) };

  let unassigned = null;
  if (req.user.role === 'SYSADMIN') {
    const u = await one(`SELECT COUNT(*) n FROM eg_deviceinfo i
      WHERE NOT EXISTS (SELECT 1 FROM eg_device_site a WHERE a.deviceid = i.deviceid AND a.removed_on IS NULL)
        AND NOT EXISTS (SELECT 1 FROM eg_device_hidden h WHERE h.deviceid = i.deviceid)
        AND NOT EXISTS (SELECT 1 FROM eg_device_test t WHERE t.deviceid = i.deviceid)`);
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

// 대시보드 시계 옆 날씨 (10분마다 다시 부른다)
r.get('/weather', requireAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const w = await weatherFor(userLocation(tree, req.user)).catch(() => null);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ weather: w });
}));

export default r;
