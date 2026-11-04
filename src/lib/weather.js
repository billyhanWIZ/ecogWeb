// 사이니지용 현재 날씨 — 기상청 초단기실황·초단기예보 (공공데이터포털, 무료).
// 키는 .env 의 KMA_SERVICE_KEY. 없으면 날씨는 그냥 표시하지 않는다.
// 같은 격자(약 5km)는 10분에 한 번만 기상청에 묻는다. 실패하면 직전 값을 3시간까지 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { inherited, ancestors, userRoots } from './orgs.js';
import { normalizeSido } from './regions.js';

// 같은 서비스를 두 곳에서 준다: 기상청 API허브(authKey) 또는 공공데이터포털(serviceKey). 키를 넣은 쪽을 쓴다.
const HUB = 'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0';
const PORTAL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
const FRESH = 10 * 60_000;
const RETRY = 2 * 60_000;
const STALE = 3 * 3600_000;

let centers = null;
function regionCenters() {
  if (!centers) centers = JSON.parse(fs.readFileSync(path.join(config.root, 'src/data/regions-center.json'), 'utf8'));
  return centers;
}

/** 조직의 날씨 위치: 자기부터 위로 올라가며 처음 나오는 것 — 직접 넣은 위도·경도, 시군구 중심, 시도 중심. 모르면 null */
export function orgLocation(tree, sn) {
  const chain = ancestors(tree, sn);
  const c = regionCenters();
  for (let i = chain.length - 1; i >= 0; i--) {
    const o = chain[i];
    const sido = inherited(tree, o.sn, 'sido');
    if (o.lat != null && o.lng != null && Number(o.lat) && Number(o.lng)) return { lat: Number(o.lat), lng: Number(o.lng), label: nearestName(Number(o.lat), Number(o.lng)) };
    if (o.sigungu) {
      const name = String(o.sigungu).replace(/\s+/g, '');
      let hit = sido && c.sigungu[`${sido}|${name}`];
      if (!hit) {
        // 시도가 비었거나 안 맞으면 이름으로: 하나뿐일 때만 쓴다 (중구·동구처럼 겹치면 안 씀)
        const same = Object.keys(c.sigungu).filter((k) => k.endsWith(`|${name}`));
        if (same.length === 1) hit = c.sigungu[same[0]];
      }
      if (hit) return { lat: hit[0], lng: hit[1], label: o.sigungu };
    }
    if (o.sido && c.sido[o.sido]) return { lat: c.sido[o.sido][0], lng: c.sido[o.sido][1], label: o.sido };
  }
  return null;
}

/** 가장 가까운 시군구 이름 (위도·경도로 넣은 위치의 표시용) */
export function nearestName(lat, lng) {
  let best = null;
  let bd = Infinity;
  for (const [k, [a, b]] of Object.entries(regionCenters().sigungu)) {
    const d = (a - lat) ** 2 + ((b - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best ? best.split('|')[1].replace(/^(.+?시)(.+구)$/, '$1') : '';
}

/**
 * 관리자가 넣은 '날씨 위치' 글을 위도·경도로. "35.18, 128.10" 또는 "경상남도 진주시"·"진주시"·"서울 강남구".
 * 못 찾으면 null
 */
export function resolvePlace(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    let [lat, lng] = [Number(m[1]), Number(m[2])];
    if (lat > 100) [lat, lng] = [lng, lat]; // 경도·위도 순서로 넣은 경우
    if (lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132) return { lat, lng };
    return null;
  }
  const c = regionCenters();
  const words = t.split(/\s+/).filter(Boolean);
  const sido = normalizeSido(words[0]);
  const rest = (sido ? words.slice(1) : words).join('');
  if (!rest) return sido && c.sido[sido] ? { lat: c.sido[sido][0], lng: c.sido[sido][1] } : null;
  const keys = Object.keys(c.sigungu).filter((k) => (!sido || k.startsWith(`${sido}|`)) && k.split('|')[1] === rest);
  if (keys.length !== 1) return null;
  const [lat, lng] = c.sigungu[keys[0]];
  return { lat, lng };
}

/** 로그인한 사용자 화면의 날씨 위치: 사용자 최상위 조직(여럿이면 위치를 아는 첫 조직) */
export function userLocation(tree, user) {
  for (const sn of userRoots(tree, user)) {
    const loc = orgLocation(tree, sn);
    if (loc) return loc;
  }
  return null;
}

/** 위경도 → 기상청 격자 (LCC, 기상청 공개 변환식) */
export function toGrid(lat, lng) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180;
  const re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

// 발표 시각: 실황은 매시 정각(40분 이후 조회), 초단기예보는 매시 30분(45분 이후 조회)
function kstParts(ms) {
  const t = new Date(ms + 9 * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}`, hh: p(t.getUTCHours()), mm: t.getUTCMinutes() };
}
function baseNcst(now) {
  const k = kstParts(now);
  const b = k.mm < 40 ? kstParts(now - 3600_000) : k;
  return { base_date: b.date, base_time: `${b.hh}00` };
}
function baseFcst(now) {
  const k = kstParts(now);
  const b = k.mm < 45 ? kstParts(now - 3600_000) : k;
  return { base_date: b.date, base_time: `${b.hh}30` };
}

function provider() {
  const hub = (process.env.KMA_APIHUB_KEY || '').trim();
  if (hub) return { base: process.env.KMA_BASE_URL || HUB, param: 'authKey', key: hub };
  const k = (process.env.KMA_SERVICE_KEY || '').trim();
  if (!k) return null;
  // 포털의 '인코딩' 키를 넣어도 되게 한 번 풀어 둔다
  let key = k;
  try { if (k.includes('%')) key = decodeURIComponent(k); } catch { /* 그대로 */ }
  return { base: process.env.KMA_BASE_URL || PORTAL, param: 'serviceKey', key };
}
const serviceKey = () => provider()?.key || null;

async function call(op, grid, base) {
  const pv = provider();
  const qs = new URLSearchParams({ [pv.param]: pv.key, pageNo: '1', numOfRows: '100', dataType: 'JSON', ...base, nx: String(grid.nx), ny: String(grid.ny) });
  const res = await fetch(`${pv.base}/${op}?${qs}`, { signal: AbortSignal.timeout(6000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`기상청 응답 오류 (${res.status}): ${text.slice(0, 120).replace(/\s+/g, ' ')}`); }
  const head = body?.response?.header;
  if (head?.resultCode !== '00') throw new Error(`기상청 ${op}: ${head?.resultCode} ${head?.resultMsg}`);
  return body.response.body?.items?.item || [];
}

const PTY = { 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울·눈날림', 7: '눈날림' };
const SKY = { 1: '맑음', 3: '구름 많음', 4: '흐림' };

async function fetchWeather(grid) {
  const now = Date.now();
  const [ncst, fcst] = await Promise.allSettled([call('getUltraSrtNcst', grid, baseNcst(now)), call('getUltraSrtFcst', grid, baseFcst(now))]);
  if (ncst.status === 'rejected' && fcst.status === 'rejected') throw ncst.reason;
  const obs = {};
  for (const it of ncst.status === 'fulfilled' ? ncst.value : []) obs[it.category] = it.obsrValue;
  // 예보는 가장 가까운 시각 값만
  const fc = {};
  const items = fcst.status === 'fulfilled' ? fcst.value : [];
  const first = items.map((it) => `${it.fcstDate}${it.fcstTime}`).sort()[0];
  for (const it of items) if (`${it.fcstDate}${it.fcstTime}` === first) fc[it.category] = it.fcstValue;

  const num = (v) => (v == null || v === '' || Number(v) <= -900 || Number(v) >= 900 ? null : Number(v));
  const temp = num(obs.T1H) ?? num(fc.T1H);
  const pty = Number(obs.PTY ?? fc.PTY ?? 0) || 0;
  const sky = Number(fc.SKY) || null;
  if (temp == null && !sky && !pty) throw new Error('기상청 응답에 값이 없습니다');
  // 아이콘 종류: sun | partly | cloud | rain | snow | sleet
  const kind = pty ? ({ 3: 'snow', 7: 'snow', 2: 'sleet', 6: 'sleet' }[pty] || 'rain') : ({ 1: 'sun', 3: 'partly', 4: 'cloud' }[sky] || 'partly');
  return {
    temp: temp == null ? null : Math.round(temp),
    text: pty ? PTY[pty] || '비' : SKY[sky] || '',
    kind,
    humidity: num(obs.REH) ?? num(fc.REH),
  };
}

const cache = new Map(); // "nx,ny" → { at, okAt, data, job }

/** 조직 위치의 현재 날씨. 키가 없거나 위치를 모르거나 받아오지 못하면 null */
export async function weatherFor(loc) {
  if (!loc || !serviceKey()) return null;
  const grid = toGrid(loc.lat, loc.lng);
  const key = `${grid.nx},${grid.ny}`;
  let c = cache.get(key);
  const now = Date.now();
  if (c?.data && now - c.okAt < FRESH) return { ...c.data, place: loc.label };
  if (!c || (!c.job && now - c.at >= (c.data ? RETRY : RETRY / 2))) {
    c = c || {};
    c.at = now;
    c.job = fetchWeather(grid)
      .then((data) => { c.data = data; c.okAt = Date.now(); })
      .catch((e) => console.warn(`[weather] ${key} ${e.message}`))
      .finally(() => { c.job = null; });
    cache.set(key, c);
  }
  if (c.job && !c.data) await c.job; // 처음 한 번은 기다린다 (최대 6초)
  if (c.data && Date.now() - c.okAt < STALE) return { ...c.data, place: loc.label };
  return null;
}
