// 앱 뼈대: 해시 라우터, API 호출, 공통 부품
import { h, $, fmt } from './ui.js';
import { openPasswordModal } from './account.js';

export const state = { me: null };

export async function api(path, opts = {}) {
  const init = { headers: {}, ...opts };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('로그인이 필요합니다');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청에 실패했습니다 (${res.status})`);
  return data;
}

/** #/stats?by=org&from=... → { page:'stats', parts:[], params } */
export function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0] || 'dashboard', parts: parts.slice(1), params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function go(page, params = {}, { replace = false } = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const qs = new URLSearchParams(clean).toString();
  const url = `#/${page}${qs ? `?${qs}` : ''}`;
  if (replace) history.replaceState(null, '', url);
  else location.hash = url;
  if (replace) render();
}

const pages = {
  dashboard: () => import('./pages/dashboard.js'),
  stats: () => import('./pages/stats.js'),
  devices: () => import('./pages/devices.js'),
  reports: () => import('./pages/reports.js'),
  orgs: () => import('./pages/orgs.js'),
  users: () => import('./pages/users.js'),
  settings: () => import('./pages/settings.js'),
  test: () => import('./pages/test.js'),
};

let renderSeq = 0;
let cleanup = null;
async function render() {
  const seq = ++renderSeq;
  const r = route();
  const view = $('#view');
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.page === r.page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const load = pages[r.page];
  if (!load) return go('dashboard', {}, { replace: true });
  try {
    const mod = await load();
    if (seq !== renderSeq) return;
    if (cleanup) { try { cleanup(); } catch { /* 무시 */ } cleanup = null; }
    view.replaceChildren(h('div', { class: 'loading' }, '불러오는 중…'));
    cleanup = (await mod.default(view, r)) || null;
  } catch (e) {
    if (seq !== renderSeq) return;
    view.replaceChildren(h('div', { class: 'err' }, e.message));
  }
}

async function boot() {
  state.me = await api('/api/me');
  const { user } = state.me;
  $('#me-name').textContent = user.name;
  $('#me-role').textContent = `${user.roleLabel}${state.me.org ? ` · ${state.me.org.name}` : ''}`;
  $('#logo').src = state.me.logo;
  $('#logo').classList.toggle('custom', !!state.me.logoCustom);
  const side = $('.side');
  const menuBtn = $('#menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = side.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  $('#nav').addEventListener('click', (e) => {
    if (e.target.closest('a')) { side.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  });
  const admin = user.role === 'SYSADMIN' || user.role === 'CUSTADMIN';
  document.querySelectorAll('[data-admin]').forEach((el) => el.classList.toggle('hidden', !admin));
  document.querySelectorAll('[data-sys]').forEach((el) => el.classList.toggle('hidden', user.role !== 'SYSADMIN'));
  document.querySelectorAll('[data-testmenu]').forEach((el) => el.classList.toggle('hidden', !user.canSeeTest));
  $('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });
  $('#btn-pw').addEventListener('click', () => openPasswordModal(false));
  window.addEventListener('hashchange', render);
  await render();
  if (user.mustChangePassword) openPasswordModal(true);
  refreshBadge();
  setInterval(refreshBadge, 5 * 60_000);
}

/** 메뉴의 '장비' 옆에 무신호 장비 수 */
export async function refreshBadge() {
  try {
    const d = await api('/api/devices?status=offline');
    const b = $('#badge-off');
    b.textContent = fmt.int(d.counts.offline);
    b.title = `신호가 끊긴 장비 ${d.counts.offline}대`;
    b.classList.toggle('hidden', !d.counts.offline);
  } catch { /* 배지는 실패해도 그만 */ }
}

boot().catch((e) => {
  $('#view').replaceChildren(h('div', { class: 'err' }, e.message));
});
