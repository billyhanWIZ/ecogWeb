// 세척기 태블릿 화면 (웹 /t 와 안드로이드 앱 공용)
//  등록 → 세척기 연결 → 평소 화면 ⇄ 세척 중(영상) → +1
// 세척 규칙은 Unity 앱과 같다: A 로 시작, S 면 +1, F 면 세지 않음, A 뒤 7.5초 안에 S/F 가 없으면 +1 로 본다.
import { createAdapter } from './signal.js';
import { auth, api, AuthError, queue, flush, newId } from './store.js';
import { weatherNodes, weatherTitle } from '../wx.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ko-KR');
const VERSION = document.querySelector('meta[name="ecog-version"]')?.content || '';
const SIGNAL_TIMEOUT = 7500; // A 뒤 S/F 를 기다리는 시간
const DONE_MS = 3200; // +1 화면
const SILENCE_MS = 30_000; // 대기 신호(N)가 이만큼 없으면 다시 연결

let state = null; // 서버에서 받은 화면 정보
let phase = 'idle'; // idle | cleaning | done
let cur = null; // 진행 중인 세척
let held = false; // A 를 받고 아직 S/F 를 못 받음 (세척 중엔 송신부가 아무것도 안 보낸다)
let lastData = Date.now();
let everConnected = false;
let signalTimer = null;
const sig = createAdapter();

// ── 화면 전환 ─────────────────
const SCREENS = ['reg', 'main', 'conn', 'clean', 'done'];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id && !(id === 'conn' && s === 'main');
  $('conn').classList.toggle('over', id === 'conn');
}

// ── 등록 ─────────────────
function setupReg() {
  let code = '';
  const render = () => {
    $('code').textContent = code.padEnd(8, '·').replace(/(.{4})/, '$1 ');
    $('regBtn').disabled = code.length !== 8;
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '지움', '0', '←'];
  $('pad').replaceChildren(...keys.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k;
    b.addEventListener('click', () => {
      if (k === '지움') code = '';
      else if (k === '←') code = code.slice(0, -1);
      else if (code.length < 8) code += k;
      $('regErr').textContent = '';
      render();
    });
    return b;
  }));
  window.addEventListener('keydown', (e) => {
    if ($('reg').hidden) return;
    if (/^\d$/.test(e.key) && code.length < 8) code += e.key;
    else if (e.key === 'Backspace') code = code.slice(0, -1);
    else if (e.key === 'Enter' && code.length === 8) $('regBtn').click();
    render();
  });
  $('regBtn').addEventListener('click', async () => {
    $('regBtn').disabled = true;
    try {
      const r = await api('/api/tablet/activate', { method: 'POST', body: { code } });
      auth.save(r.deviceid, r.token);
      queue.clear(); // 다른 장비로 쌓인 기록이 섞이지 않게
      code = '';
      boot();
    } catch (e) {
      $('regErr').textContent = e.message;
      render();
    }
  });
  render();
}

// ── 서버 정보 ─────────────────
async function loadState() {
  try {
    state = await api('/api/tablet/state');
    state.totalsDay = ymd(new Date());
    renderState();
    if (state.hasLogo) loadLogo();
    loadBackground(state.bg);
    return true;
  } catch (e) {
    if (e instanceof AuthError) { unregister(e.message); return false; }
    return false;
  }
}

async function loadLogo() {
  try {
    const res = await fetch('/api/tablet/logo', { headers: { Authorization: `Bearer ${auth.token}` } });
    if (res.status !== 200) return;
    const url = URL.createObjectURL(await res.blob());
    $('custLogo').src = url;
    $('custLogo').hidden = false;
  } catch { /* 로고 없이 */ }
}

// 설치처 배경 사진: 바뀌었을 때만 다시 받는다. 없거나 못 받으면 기본 숲 사진
let bgKey;
let bgUrl = null;
async function loadBackground(key) {
  if (key === bgKey) return;
  bgKey = key;
  const set = (url) => {
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = url;
    if (url) $('main').style.setProperty('--bg', `url("${url}")`);
    else $('main').style.removeProperty('--bg');
  };
  if (!key) { set(null); return; }
  try {
    const res = await fetch('/api/tablet/background', { headers: { Authorization: `Bearer ${auth.token}` }, cache: 'no-store' });
    if (res.status !== 200) { set(null); return; }
    set(URL.createObjectURL(await res.blob()));
  } catch { bgKey = undefined; /* 다음 갱신 때 다시 */ }
}

function pending(today) {
  let all = 0;
  let td = 0;
  for (const e of queue.list()) {
    if (e.result === 'F') continue;
    all++;
    if (ymd(new Date(e.endedAt)) === today) td++;
  }
  return { all, td };
}

function renderState() {
  if (!state) return;
  $('name').textContent = state.name || '텀블러 세척기';
  $('site').textContent = state.site ? state.site.path : '설치처 배정 전';
  const p = pending(ymd(new Date()));
  const total = state.totals.total + p.all;
  const today = (state.totalsDay === ymd(new Date()) ? state.totals.today : 0) + p.td;
  $('total').textContent = nf.format(total);
  $('cups').textContent = nf.format(total);
  $('today').textContent = nf.format(today);
  const kg = (total * state.factors.co2PerUseG) / 1000;
  if (kg >= 1000) { $('co2').textContent = (kg / 1000).toFixed(2); $('co2u').textContent = '톤 CO₂'; }
  else { $('co2').textContent = kg >= 100 ? nf.format(Math.round(kg)) : kg.toFixed(1); $('co2u').textContent = 'kg CO₂'; }
  const trees = kg / state.factors.co2PerTreeKg;
  const whole = Math.floor(trees);
  const frac = trees - whole;
  $('trees').textContent = nf.format(whole);
  $('treeNext').textContent = `그루 · 다음 그루까지 ${Math.round(frac * 100)}%`;
  const c = 2 * Math.PI * 19;
  $('ring').style.strokeDasharray = `${c * frac} ${c}`;
  showWeather(state.weather);
}

function showWeather(w) {
  const box = $('wx');
  const nodes = weatherNodes(w);
  if (!nodes) { box.hidden = true; return; }
  box.replaceChildren(...nodes);
  box.title = weatherTitle(w);
  box.hidden = false;
}

function setTotals(t) {
  if (!t || !state) return;
  state.totals = t;
  state.totalsDay = ymd(new Date());
  renderState();
}

// ── 세척 ─────────────────
function onData(ch) {
  lastData = Date.now();
  if (ch === 'N') return;
  if (ch === 'A') {
    held = true;
    if (phase !== 'cleaning') startClean();
    return;
  }
  if (ch === 'S' || ch === 'F') {
    held = false;
    if (phase === 'cleaning') finish(ch);
  }
}

function startClean() {
  phase = 'cleaning';
  cur = { id: newId(), startedAt: Date.now() };
  show('clean');
  const v = $('video');
  v.currentTime = 0;
  v.muted = false;
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  clearTimeout(signalTimer);
  signalTimer = setTimeout(() => finish('T'), SIGNAL_TIMEOUT);
}

function finish(result) {
  clearTimeout(signalTimer);
  if (!cur) return;
  const ev = { ...cur, endedAt: Date.now(), result };
  ev.durationMs = ev.endedAt - ev.startedAt;
  cur = null;
  queue.push(ev);
  $('video').pause();
  const ok = result !== 'F';
  renderState();
  if (ok) {
    phase = 'done';
    $('plus').textContent = '+1';
    $('doneMsg').textContent = '깨끗해졌어요!';
    const g = state?.factors.co2PerUseG ?? 52;
    $('doneSub').textContent = `일회용컵 1개를 아껴 탄소 ${g}g을 줄였어요`;
    $('done').classList.remove('fail');
    try { $('ding').currentTime = 0; $('ding').play().catch(() => {}); } catch { /* 소리 없이 */ }
  } else {
    phase = 'done';
    $('plus').textContent = '';
    $('doneMsg').textContent = '세척이 중간에 끝났어요';
    $('doneSub').textContent = '텀블러를 다시 올려 주세요';
    $('done').classList.add('fail');
  }
  show('done');
  setTimeout(() => { if (phase === 'done') { phase = 'idle'; showIdle(); } }, ok ? DONE_MS : 2000);
  sync();
}

async function sync() {
  if (!queue.list().length) return;
  try {
    const t = await flush();
    setNet(true);
    setTotals(t);
  } catch (e) {
    if (e instanceof AuthError) unregister(e.message);
    else setNet(false);
  }
}

// ── 연결 상태 ─────────────────
function bleLabel(s) {
  return { connected: '연결됨', connecting: '연결 중', disconnected: '끊김', 'need-tap': '연결 필요', off: '블루투스 꺼짐', unsupported: '지원 안 됨' }[s] || s;
}

function onState({ state: s, message }) {
  $('chipBle').className = `chip ${s === 'connected' ? 'on' : s === 'connecting' ? 'wait' : 'off'}`;
  $('chipBle').textContent = `세척기 ${bleLabel(s)}`;
  if (s === 'connected') {
    everConnected = true;
    lastData = Date.now();
    $('banner').hidden = true;
  }
  if (phase !== 'idle') return; // 세척 화면은 그대로
  showIdle(message);
  heartbeat();
}

function showIdle(message = sig.message) {
  if (!auth.token) { show('reg'); return; }
  const s = sig.state;
  if (s === 'connected') { show('main'); return; }
  if (everConnected && (s === 'connecting' || s === 'disconnected')) {
    // 한 번 붙은 뒤 끊기면 평소 화면 위에 띠만 보인다 (세척 숫자는 계속 보이게)
    show('main');
    $('banner').hidden = false;
    $('banner').textContent = `세척기 연결이 끊겼습니다 · ${message || '다시 연결하는 중'}`;
    return;
  }
  show('conn');
  const title = {
    'need-tap': '세척기를 연결해 주세요',
    off: '블루투스를 켜 주세요',
    unsupported: '블루투스를 쓸 수 없는 브라우저입니다',
  }[s] || '세척기에 연결하는 중';
  $('connTitle').textContent = title;
  $('connMsg').textContent = message || (s === 'need-tap' ? '아래 버튼을 누르고 목록에서 ECOG 를 고르세요' : '세척기 전원이 켜져 있는지 확인하세요');
  $('connBtn').hidden = !(s === 'need-tap' || s === 'off' || (s === 'connecting' && sig.kind === 'web' && sig.attempt >= 3));
  $('connBtn').textContent = s === 'need-tap' ? '터치하여 세척기 연결' : '다시 시도';
}

function setNet(ok) {
  $('chipNet').className = `chip ${ok ? 'on' : 'off'}`;
  $('chipNet').textContent = ok ? '인터넷 정상' : '인터넷 끊김';
}

let hbTimer = null;
async function heartbeat() {
  if (!auth.token) return;
  const ble = { connected: 'connected', connecting: 'connecting', off: 'off', unsupported: 'off' }[sig.state] || 'disconnected';
  try {
    await api('/api/tablet/heartbeat', { method: 'POST', body: { ble, appKind: sig.kind === 'apk' ? 'apk' : 'web', appVersion: sig.kind === 'apk' ? `${sig.version}/${VERSION}` : VERSION } });
    setNet(true);
    if (queue.list().length) sync();
  } catch (e) {
    if (e instanceof AuthError) unregister(e.message);
    else setNet(false);
  }
}

// ── 시계 ─────────────────
const pad = (n) => String(n).padStart(2, '0');
function ymd(t) { return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; }
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
let lastDay = ymd(new Date());
function tick() {
  const t = new Date();
  const el = $('clock');
  el.dateTime = t.toISOString();
  const b = document.createElement('b');
  b.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  const s = document.createElement('small');
  s.textContent = `${t.getFullYear()}.${pad(t.getMonth() + 1)}.${pad(t.getDate())} (${DAYS[t.getDay()]})`;
  el.replaceChildren(b, s);
  if (ymd(t) !== lastDay) { lastDay = ymd(t); loadState(); }
  // 대기 신호가 끊기면 다시 연결 (세척 신호가 이어지는 동안은 송신부가 조용하므로 기다린다)
  if (sig.state === 'connected' && phase === 'idle' && !held && Date.now() - lastData > SILENCE_MS) {
    lastData = Date.now();
    sig.reconnect();
  }
  if (held && Date.now() - lastData > 10 * 60_000) held = false;
}

// ── 설정 ─────────────────
function setupSettings() {
  // 로고: 한 번 누르면 종료 확인, 3초 안에 5번 누르면 설정
  let taps = [];
  let tapTimer = null;
  $('brand').addEventListener('click', () => {
    const now = Date.now();
    taps = taps.filter((x) => now - x < 3000).concat(now);
    clearTimeout(tapTimer);
    if (taps.length >= 5) { taps = []; openSettings(); return; }
    tapTimer = setTimeout(() => { if (taps.length === 1) openExit(); taps = []; }, 700);
  });
  $('exitNo').addEventListener('click', () => $('exitDlg').close());
  $('exitYes').addEventListener('click', () => { $('exitDlg').close(); exitApp(); });
  $('sExit').addEventListener('click', () => { $('settings').close(); exitApp(); });
  $('sClose').addEventListener('click', () => $('settings').close());
  $('sReload').addEventListener('click', () => location.reload());
  $('sSystem').hidden = sig.kind !== 'apk';
  $('sSystem').addEventListener('click', () => { $('settings').close(); window.EcogNative?.openSystemSettings?.(); });
  $('sReconnect').addEventListener('click', () => { $('settings').close(); sig.reconnect(); });
  $('sChoose').addEventListener('click', () => {
    $('settings').close();
    everConnected = false;
    sig.forget(); // 기억한 세척기를 지우고
    if (sig.kind === 'web') sig.choose(); else sig.start(); // 앱은 가장 가까운 세척기를 다시 찾는다
  });
  let holdT = null;
  const start = () => { holdT = setTimeout(() => { $('settings').close(); unregister('등록을 해제했습니다'); }, 3000); $('sReset').classList.add('holding'); };
  const stop = () => { clearTimeout(holdT); $('sReset').classList.remove('holding'); };
  $('sReset').addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => $('sReset').addEventListener(e, stop));
}

let exitTimer = null;
function openExit() {
  if (phase !== 'idle' || $('settings').open) return;
  $('exitMsg').textContent = sig.kind === 'apk'
    ? '종료하면 세척 횟수를 세지 않습니다.'
    : '종료하면 세척 횟수를 세지 않습니다. 브라우저 탭도 닫아 주세요.';
  $('exitDlg').showModal();
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => { if ($('exitDlg').open) $('exitDlg').close(); }, 15_000); // 손님이 잘못 눌렀을 때
}

function exitApp() {
  const n = window.EcogNative;
  if (n && typeof n.exit === 'function') { n.exit(); return; } // 앱 1.0.4 이상: 앱을 닫는다
  if (n && typeof n.openSystemSettings === 'function') { n.openSystemSettings(); return; } // 예전 앱: 안드로이드 설정으로 나간다
  // 웹: 전체 화면을 풀고 창 닫기를 시도 (직접 연 탭은 브라우저가 막을 수 있다)
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* 무시 */ }
  window.close();
}

function openSettings() {
  const rows = [
    ['장비 ID', auth.deviceid || '–'],
    ['이름', state?.name || '–'],
    ['설치처', state?.site?.path || '배정 전'],
    ['세척기 연결', `${bleLabel(sig.state)}${sig.message ? ` · ${sig.message}` : ''}`],
    ['보내지 못한 기록', `${queue.list().length}건`],
    ['프로그램', sig.kind === 'apk' ? `안드로이드 앱 ${sig.version} · 화면 ${VERSION}` : `웹 ${VERSION}${sig.kind === 'sim' ? ' (시연)' : ''}`],
  ];
  $('info').replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    return [dt, dd];
  }));
  $('settings').showModal();
}

function unregister(msg) {
  auth.clear();
  state = null;
  $('regErr').textContent = msg || '';
  show('reg');
}

// ── 시작 ─────────────────
let started = false;
async function boot() {
  if (!auth.token) { show('reg'); return; }
  show('conn');
  $('connTitle').textContent = '불러오는 중';
  await loadState();
  if (!auth.token) return;
  if (!started) {
    started = true;
    sig.start();
    clearInterval(hbTimer);
    hbTimer = setInterval(heartbeat, 10_000);
    setInterval(loadState, 5 * 60_000);
    setInterval(sync, 30_000);
  }
  heartbeat();
  sync();
  showIdle();
}

sig.addEventListener('data', (e) => onData(e.detail));
sig.addEventListener('state', (e) => onState(e.detail));
$('connBtn').addEventListener('click', () => (sig.state === 'need-tap' ? sig.choose() : sig.reconnect()));
window.addEventListener('online', () => { heartbeat(); });
window.addEventListener('offline', () => setNet(false));

// 웹: 첫 터치 때 전체 화면 + 화면 꺼짐 막기 (앱은 앱이 처리)
if (sig.kind !== 'apk') {
  const wake = async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* 무시 */ }
    try { await navigator.wakeLock?.request('screen'); } catch { /* 무시 */ }
  };
  document.addEventListener('pointerdown', wake, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {}); });
}
if (sig.kind === 'sim') {
  const bar = $('simbar');
  bar.hidden = false;
  bar.replaceChildren(...['A', 'S', 'F'].map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = { A: 'A 시작', S: 'S 정상', F: 'F 실패' }[k];
    b.addEventListener('click', () => sig.emit(k));
    return b;
  }));
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/tablet-sw.js').catch(() => {});

setNet(navigator.onLine);
setupReg();
setupSettings();
tick();
setInterval(tick, 1000);
boot();
