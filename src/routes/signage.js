// 사이니지: 설치처 로비 TV·QR 로 여는 로그인 없는 화면. 토큰을 아는 사람만, 합계 숫자만 보여준다.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { wrap, httpError } from '../lib/http.js';
import { loadOrgs, descendants, inherited } from '../lib/orgs.js';
import { dailyUsage, signalStatus, currentDevices, cumulativeUses } from '../lib/usage.js';
import { getSettings, impact } from '../lib/settings.js';
import { todayKST, addDays, eachDay } from '../lib/dates.js';
import { q, one } from '../db.js';
import { config } from '../config.js';

const r = Router();
const cache = new Map(); // token → { at, data }
const cumCache = new Map(); // 설치처 목록 → { at, row }

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
  if (hit && Date.now() - hit.at < 15_000) return res.json(await hit.data); // 같은 링크를 여러 TV 가 열어도 15초에 한 번만 DB 조회
  const job = compute(req.params.token);
  cache.set(req.params.token, { at: Date.now(), data: job });
  try {
    const data = await job;
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    cache.delete(req.params.token);
    throw e;
  }
}));

async function compute(token) {
  const { tree, org } = await orgByToken(token);
  const s = await getSettings();
  const sites = descendants(tree, org.sn);
  const today = todayKST();
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  const from14 = addDays(today, -13);
  const daily = await dailyUsage(sites, from14 < yearFrom ? from14 : yearFrom, today);
  const sumWhere = (f) => daily.filter(f).reduce((x, d) => x + d.cnt, 0);
  // 전체 누적은 테이블 전체를 훑으니 1분에 한 번만 계산
  const cumKey = sites.join(',');
  let cumHit = cumCache.get(cumKey);
  if (!cumHit || Date.now() - cumHit.at > 60_000) {
    cumHit = { at: Date.now(), uses: await cumulativeUses(sites) };
    cumCache.set(cumKey, cumHit);
  }
  const current = await currentDevices(sites);
  const sig = await signalStatus(current.map((c) => c.deviceid));
  const online = current.filter((c) => (sig.get(c.deviceid)?.ago ?? Infinity) <= s.offline_seconds).length;
  const byDay = new Map();
  for (const d of daily) byDay.set(d.d, (byDay.get(d.d) || 0) + d.cnt);

  const cumUses = cumHit.uses;
  const data = {
    name: org.name,
    logo: inherited(tree, org.sn, 'logo_path') ? `/api/signage/${token}/logo` : '/img/ecog-logo-white.png',
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
  return data;
}

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
  cumCache.clear();
}

export default r;
