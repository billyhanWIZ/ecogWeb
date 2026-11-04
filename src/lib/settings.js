import { q, exec } from '../db.js';

const DEFAULTS = {
  co2_per_use_g: 52,
  co2_per_tree_kg: 6.6,
  offline_seconds: 60,
  drop_min_avg: 3,
};

let cache = null;
let loadedAt = 0;

export async function getSettings() {
  if (cache && Date.now() - loadedAt < 30_000) return cache;
  const rows = await q('SELECT skey, svalue, description FROM eg_setting');
  const out = { ...DEFAULTS };
  for (const r of rows) {
    const n = Number(r.svalue);
    out[r.skey] = Number.isFinite(n) ? n : r.svalue;
  }
  cache = out;
  loadedAt = Date.now();
  return out;
}

export async function listSettings() {
  return q('SELECT skey, svalue, description, updated_at FROM eg_setting ORDER BY skey');
}

export async function updateSetting(key, value) {
  if (!(key in DEFAULTS)) throw Object.assign(new Error('알 수 없는 설정입니다'), { status: 400 });
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error('0 이상의 숫자를 입력하세요'), { status: 400 });
  await exec('INSERT INTO eg_setting (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)', [key, String(n)]);
  cache = null;
}

/** 세척 횟수 → { co2Kg, trees } */
export function impact(uses, s) {
  const co2Kg = (uses * s.co2_per_use_g) / 1000;
  return { co2Kg, trees: co2Kg / s.co2_per_tree_kg };
}
