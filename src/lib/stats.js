// 통계 집계: 세척기·설치처·조직·시도·시군구 어느 기준으로든 같은 방식으로 묶는다.
import { loadOrgs, scopedSubtree, userRoots, userScope, inherited, pathName, ancestors } from './orgs.js';
import { assignments, dailyUsage, overlapDays } from './usage.js';
import { previousPeriod, buckets, bucketOf, autoUnit } from './dates.js';
import { getSettings, impact } from './settings.js';

export const BY = ['org', 'sido', 'sigungu', 'site', 'device'];
const NONE = '미지정';

/** 요청 조건에 맞는 설치처 sn 목록 */
export function resolveSites(tree, user, p) {
  let sites = scopedSubtree(tree, user, p.site || p.org || null);
  if (p.sido) sites = sites.filter((sn) => (inherited(tree, sn, 'sido') || NONE) === p.sido);
  if (p.sigungu) sites = sites.filter((sn) => (inherited(tree, sn, 'sigungu') || NONE) === p.sigungu);
  return sites;
}

export async function loadUsage(sites, period, withPrev = true) {
  const prev = previousPeriod(period);
  const [assign, daily, prevDaily] = await Promise.all([
    assignments(sites, period.from, period.to),
    dailyUsage(sites, period.from, period.to),
    withPrev ? dailyUsage(sites, prev.from, prev.to) : Promise.resolve([]),
  ]);
  return { assign, daily, prevDaily, prev };
}

/** by 별로 (site_sn, deviceid) → {key, label} 을 정하는 함수와 기본 행 목록 */
function makeGrouper(tree, user, by, p, assign) {
  const viewRoot = userRoots(tree, user).length === 1 ? userRoots(tree, user)[0] : null;
  const devName = new Map(assign.map((a) => [a.deviceid, a.display_name || a.devicename || a.deviceid]));

  if (by === 'org') {
    const parentSn = p.org ? Number(p.org) : viewRoot;
    const parent = parentSn != null ? tree.byId.get(parentSn) : null;
    const children = parent ? parent.children : tree.roots;
    const childSet = new Set(children.map((c) => c.sn));
    const keyOf = (siteSn) => {
      if (parent && siteSn === parent.sn) return { key: parent.sn, label: `${parent.name} (직접 배정)` };
      const chain = ancestors(tree, siteSn);
      const hit = chain.find((o) => childSet.has(o.sn));
      return hit ? { key: hit.sn, label: hit.name } : null;
    };
    const drill = (key) => {
      const o = tree.byId.get(Number(key));
      if (!o) return null;
      if (parent && o.sn === parent.sn) return { by: 'device', site: o.sn };
      return o.children.length ? { by: 'org', org: o.sn } : { by: 'device', site: o.sn };
    };
    const base = children.map((c) => ({ key: c.sn, label: c.name }));
    const scope = userScope(tree, user);
    const crumbs = parent ? ancestors(tree, parent.sn).filter((o) => scope.has(o.sn)) : [];
    return { keyOf: (s) => keyOf(s), drill, base, crumbs: crumbs.map((o) => ({ sn: o.sn, name: o.name })) };
  }
  if (by === 'sido' || by === 'sigungu') {
    const keyOf = (siteSn) => {
      const v = inherited(tree, siteSn, by) || NONE;
      return { key: v, label: v };
    };
    const drill = (key) => (by === 'sido' ? { by: 'sigungu', sido: key } : { by: 'site', sido: p.sido, sigungu: key });
    return { keyOf, drill, base: [] };
  }
  if (by === 'site') {
    const keyOf = (siteSn) => ({ key: siteSn, label: pathName(tree, siteSn, viewRoot) });
    return { keyOf, drill: (key) => ({ by: 'device', site: key }), base: [] };
  }
  // device
  return {
    keyOf: (siteSn, deviceid) => ({ key: deviceid, label: devName.get(deviceid) || deviceid, sub: pathName(tree, siteSn, viewRoot) }),
    drill: (key) => ({ device: key }),
    base: [],
  };
}

export async function buildStats(user, p, period, preloaded = null) {
  const tree = await loadOrgs();
  const s = await getSettings();
  let by = BY.includes(p.by) ? p.by : 'org';
  const unit = ['day', 'week', 'month'].includes(p.unit) ? p.unit : autoUnit(period.days);
  // 하위 조직이 없는 조직(설치처)을 조직별로 보면 의미가 없으니 세척기별로 바꾼다
  if (by === 'org') {
    const roots = userRoots(tree, user);
    const parentSn = p.org ? Number(p.org) : roots.length === 1 ? roots[0] : null;
    const parent = parentSn != null ? tree.byId.get(parentSn) : null;
    if (parent && !parent.children.length) {
      by = 'device';
      p = { ...p, site: parent.sn, org: undefined };
    }
  }
  const sites = resolveSites(tree, user, p);
  const data = preloaded || (await loadUsage(sites, period));
  const g = makeGrouper(tree, user, by, p, data.assign);

  const rows = new Map();
  const ensure = (k) => {
    if (!rows.has(k.key)) rows.set(k.key, { key: k.key, label: k.label, sub: k.sub, devices: new Set(), deviceDays: 0, activeDays: 0, uses: 0, prevUses: 0, byBucket: new Map() });
    return rows.get(k.key);
  };
  for (const b of g.base) ensure(b);
  for (const a of data.assign) {
    const k = g.keyOf(a.site_sn, a.deviceid);
    if (!k) continue;
    const r = ensure(k);
    r.devices.add(a.deviceid);
    r.deviceDays += overlapDays(a, period.from, period.to);
  }
  for (const d of data.daily) {
    const k = g.keyOf(d.site_sn, d.deviceid);
    if (!k) continue;
    const r = ensure(k);
    r.uses += d.cnt;
    if (d.cnt > 0) r.activeDays++;
    const b = bucketOf(d.d, unit);
    r.byBucket.set(b, (r.byBucket.get(b) || 0) + d.cnt);
  }
  for (const d of data.prevDaily) {
    const k = g.keyOf(d.site_sn, d.deviceid);
    if (k && rows.has(k.key)) rows.get(k.key).prevUses += d.cnt;
  }

  const bks = buckets(period.from, period.to, unit);
  const list = [...rows.values()].map((r) => {
    const im = impact(r.uses, s);
    return {
      key: r.key,
      label: r.label,
      sub: r.sub,
      devices: r.devices.size,
      uses: r.uses,
      prevUses: r.prevUses,
      change: r.prevUses ? (r.uses - r.prevUses) / r.prevUses : null,
      perDeviceDay: r.deviceDays ? r.uses / r.deviceDays : 0,
      activeRate: r.deviceDays ? r.activeDays / r.deviceDays : 0,
      co2Kg: im.co2Kg,
      trees: im.trees,
      drill: g.drill(r.key),
      _series: bks.map((b) => r.byBucket.get(b) || 0),
    };
  }).sort((a, b) => b.uses - a.uses || b.devices - a.devices || String(a.label).localeCompare(String(b.label), 'ko'));

  const totalUses = list.reduce((x, r) => x + r.uses, 0);
  const totalPrev = list.reduce((x, r) => x + r.prevUses, 0);
  const deviceSet = new Set(data.assign.map((a) => a.deviceid));
  const totalDeviceDays = data.assign.reduce((x, a) => x + overlapDays(a, period.from, period.to), 0);
  const activeDays = data.daily.filter((d) => d.cnt > 0).length;

  const totalSeries = bks.map((_, i) => list.reduce((x, r) => x + r._series[i], 0));
  const lines = list.filter((r) => r.uses > 0).slice(0, 6).map((r) => ({ key: r.key, label: r.label, values: r._series }));
  for (const r of list) delete r._series;

  return {
    by,
    unit,
    period: { from: period.from, to: period.to, days: period.days },
    prevPeriod: { from: data.prev.from, to: data.prev.to },
    crumbs: g.crumbs || [],
    total: {
      devices: deviceSet.size,
      uses: totalUses,
      prevUses: totalPrev,
      change: totalPrev ? (totalUses - totalPrev) / totalPrev : null,
      perDeviceDay: totalDeviceDays ? totalUses / totalDeviceDays : 0,
      activeRate: totalDeviceDays ? activeDays / totalDeviceDays : 0,
      ...impact(totalUses, s),
    },
    rows: list,
    series: { buckets: bks, total: totalSeries, lines },
  };
}
