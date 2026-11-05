// 태블릿 토큰·서버 호출·보내지 못한 세척 기록(인터넷이 끊겨도 잃지 않게 기기에 쌓아 둔다)
const K_TOKEN = 'ecog.tablet.token';
const K_DEVICE = 'ecog.tablet.deviceid';
const K_QUEUE = 'ecog.tablet.queue';
const MAX_QUEUE = 20_000;

export const auth = {
  get token() { return localStorage.getItem(K_TOKEN); },
  get deviceid() { return localStorage.getItem(K_DEVICE); },
  save(deviceid, token) { localStorage.setItem(K_DEVICE, deviceid); localStorage.setItem(K_TOKEN, token); },
  clear() { localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_DEVICE); },
};

export class AuthError extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let data = null;
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (res.status === 401) throw new AuthError(data?.error || '등록이 풀렸습니다');
  if (!res.ok) throw Object.assign(new Error(data?.error || `서버 오류 (${res.status})`), { status: res.status });
  return data;
}

// ── 보낼 세척 기록 ─────────────────
export const queue = {
  list() {
    try { return JSON.parse(localStorage.getItem(K_QUEUE) || '[]'); } catch { return []; }
  },
  save(list) {
    localStorage.setItem(K_QUEUE, JSON.stringify(list.slice(-MAX_QUEUE)));
  },
  push(ev) {
    const l = this.list();
    l.push(ev);
    this.save(l);
  },
  remove(ids) {
    const set = new Set(ids.map((x) => x.toLowerCase()));
    this.save(this.list().filter((e) => !set.has(e.id.toLowerCase())));
  },
  clear() { localStorage.removeItem(K_QUEUE); },
};

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
export const newId = uuid;

let flushing = null;
/** 쌓인 기록을 200건씩 보낸다. 성공하면 서버 합계를 돌려준다 */
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let totals = null;
    for (let i = 0; i < 100; i++) {
      const batch = queue.list().slice(0, 200);
      if (!batch.length) break;
      const r = await api('/api/tablet/clean', { method: 'POST', body: { events: batch } });
      totals = r.totals;
      // 응답에 없는 건(형식이 틀린 것)도 다시 보내지 않는다
      queue.remove(batch.map((e) => e.id));
    }
    return totals;
  })().finally(() => { flushing = null; });
  return flushing;
}
