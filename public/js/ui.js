// 작은 DOM 도우미와 공통 부품 (프레임워크 없이)

export const $ = (sel, root = document) => root.querySelector(sel);

/** h('div', {class:'x', onclick}, child, ...) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // 신뢰하는 정적 문자열에만 사용
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const nf0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

export const fmt = {
  int: (n) => nf0.format(Math.round(n || 0)),
  one: (n) => nf1.format(n || 0),
  two: (n) => nf2.format(n || 0),
  pct: (n) => (n == null ? '–' : `${nf1.format(n * 100)}%`),
  /** 탄소: 1톤 넘으면 t, 아니면 kg */
  co2: (kg) => (kg >= 1000 ? `${nf2.format(kg / 1000)}t` : `${nf1.format(kg)}kg`),
  change(c) {
    if (c == null || !Number.isFinite(c)) return h('span', { class: 'faint' }, '–');
    const v = Math.round(c * 1000) / 10;
    return h('span', { class: v > 0 ? 'up' : v < 0 ? 'down' : 'faint' }, `${v > 0 ? '+' : ''}${nf1.format(v)}%`);
  },
  ago(sec) {
    if (sec == null) return '신호 없음';
    if (sec < 60) return `${sec}초 전`;
    if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
    return `${Math.floor(sec / 86400)}일 전`;
  },
  date: (d) => (d ? d.replaceAll('-', '.') : '–'),
};

export function statusPill(status, ago) {
  if (status === 'online') return h('span', { class: 'pill on', title: fmt.ago(ago) }, '정상');
  if (status === 'never') return h('span', { class: 'pill never' }, '신호 없음');
  return h('span', { class: 'pill off', title: `마지막 신호 ${fmt.ago(ago)}` }, `무신호 · ${fmt.ago(ago)}`);
}

// ── 날짜 / 기간 선택 ─────────────────
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function today() { return ymd(new Date()); }
export function shift(d, days) { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + days); return ymd(x); }

export const PRESETS = [
  ['today', '오늘', () => [today(), today()]],
  ['yesterday', '어제', () => [shift(today(), -1), shift(today(), -1)]],
  ['week', '최근 7일', () => [shift(today(), -6), today()]],
  ['month', '이번 달', () => [`${today().slice(0, 8)}01`, today()]],
  ['lastmonth', '지난달', () => { const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const b = new Date(d.getFullYear(), d.getMonth(), 0); return [ymd(a), ymd(b)]; }],
  ['year', '올해', () => [`${today().slice(0, 4)}-01-01`, today()]],
];

export function defaultPeriod(params) {
  if (params.from && params.to) return { from: params.from, to: params.to };
  const [from, to] = PRESETS.find((p) => p[0] === 'year')[2]();
  return { from, to };
}

/** 기간 선택: 바뀌면 onChange({from,to}) */
export function periodPicker({ from, to }, onChange) {
  const fi = h('input', { type: 'date', value: from, 'aria-label': '시작일', max: today() });
  const ti = h('input', { type: 'date', value: to, 'aria-label': '종료일', max: today() });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '빠른 기간' });
  for (const [key, label, fn] of PRESETS) {
    const [a, b] = fn();
    seg.append(h('button', {
      type: 'button',
      'aria-pressed': String(a === from && b === to),
      onclick: () => onChange({ from: a, to: b }),
      'data-k': key,
    }, label));
  }
  const apply = () => {
    if (!fi.value || !ti.value) return;
    const [a, b] = fi.value <= ti.value ? [fi.value, ti.value] : [ti.value, fi.value];
    onChange({ from: a, to: b });
  };
  fi.addEventListener('change', apply);
  ti.addEventListener('change', apply);
  return h('div', { class: 'period' }, seg, fi, h('span', { class: 'faint' }, '~'), ti);
}

// ── 오버레이 ─────────────────────────
export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export function drawer(title, sub) {
  const bg = h('div', { class: 'drawer-bg' });
  const body = h('div', { class: 'content' });
  const close = () => { bg.remove(); panel.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const titleEl = h('h2', null, title);
  const subEl = h('div', { class: 'faint', style: { fontSize: '13px' } }, sub || '');
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('div', null, titleEl, subEl), h('button', { class: 'close', 'aria-label': '닫기', onclick: close }, '×')),
    body);
  bg.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(bg, panel);
  panel.querySelector('.close').focus();
  return { body, close, setTitle: (t, s) => { titleEl.textContent = t; subEl.textContent = s || ''; } };
}

/** 폼 모달. onSubmit 이 에러를 던지면 모달 안에 표시 */
export function modal(title, content, { submitLabel = '저장', onSubmit, danger = false } = {}) {
  const err = h('p', { class: 'err hidden', role: 'alert' });
  const submit = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'submit' }, submitLabel);
  const form = h('form', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', null, h('h2', null, title), h('button', { class: 'close', type: 'button', 'aria-label': '닫기', onclick: () => close() }, '×')),
    h('div', { class: 'content' }, content, err),
    h('footer', null, h('button', { class: 'btn', type: 'button', onclick: () => close() }, '취소'), onSubmit ? submit : null));
  const bg = h('div', { class: 'modal-bg' }, form);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { bg.remove(); document.removeEventListener('keydown', onKey); }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    submit.disabled = true;
    try {
      const keep = await onSubmit(form);
      if (keep !== true) close();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  (form.querySelector('input,select,textarea') || submit).focus();
  return { form, close };
}

export function field(label, input, hint) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

// ── 차트 (ECharts) ───────────────────
export const COLORS = ['#1C7FA6', '#2F8F5B', '#B97A0F', '#7A5BA6', '#B9432F', '#3E9C9C', '#7D949B'];

export function waitECharts() {
  return new Promise((resolve) => {
    if (window.echarts) return resolve(window.echarts);
    const t = setInterval(() => { if (window.echarts) { clearInterval(t); resolve(window.echarts); } }, 30);
  });
}

/** 컨테이너에 차트를 그리고, 창 크기에 맞춰 다시 그린다. dispose 함수를 돌려준다 */
export async function chart(el, option) {
  const ec = await waitECharts();
  const c = ec.init(el, null, { renderer: 'svg' });
  c.setOption({
    color: COLORS,
    textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: '#4A6670' },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: '#0E2A33', borderWidth: 0, textStyle: { color: '#fff' } },
    ...option,
  });
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el);
  return { chart: c, dispose: () => { ro.disconnect(); c.dispose(); } };
}

export const axisStyle = {
  axisLine: { lineStyle: { color: '#D6E1E3' } },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: '#E8EFF0' } },
  axisLabel: { color: '#7D949B' },
};

let koreaMap = null;
export async function ensureKoreaMap() {
  const ec = await waitECharts();
  if (!koreaMap) {
    koreaMap = await (await fetch('/geo/korea-sido.json')).json();
    ec.registerMap('korea', koreaMap);
  }
  return ec;
}

/** 버킷 라벨: 2026-03 → 3월, 2026-03-02 → 3/2 */
export function bucketLabel(b, unit) {
  if (unit === 'month') return `${Number(b.slice(5, 7))}월`;
  if (unit === 'week') return `${Number(b.slice(5, 7))}/${Number(b.slice(8))}주`;
  return `${Number(b.slice(5, 7))}/${Number(b.slice(8))}`;
}

export function downloadUrl(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}
