import { api, go, state } from '../app.js';
import { h, fmt, toast, today, shift } from '../ui.js';
import { pickOrg, loadOrgTree } from './org-picker.js';

const pad = (n) => String(n).padStart(2, '0');
function presets() {
  const t = today();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const lastMonthEnd = shift(`${t.slice(0, 8)}01`, -1);
  const q = Math.floor((m - 1) / 3); // 이번 분기 0~3
  const pq = q === 0 ? { y: y - 1, q: 3 } : { y, q: q - 1 };
  const qStart = `${pq.y}-${pad(pq.q * 3 + 1)}-01`;
  const qEnd = shift(pq.q === 3 ? `${pq.y + 1}-01-01` : `${pq.y}-${pad(pq.q * 3 + 4)}-01`, -1);
  return [
    ['지난달', `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
    ['지난 분기', qStart, qEnd],
    ['올해', `${y}-01-01`, t],
    ['작년', `${y - 1}-01-01`, `${y - 1}-12-31`],
  ];
}

export default async function reports(view, { params }) {
  const ps = presets();
  const from = params.from || ps[0][1];
  const to = params.to || ps[0][2];
  const tree = await loadOrgTree();
  const homeSn = state.me.org?.sn || tree.roots[0]?.sn;
  const orgSn = params.org ? Number(params.org) : homeSn;
  const sido = params.sido || '';
  const nav = (patch) => go('reports', { from, to, org: orgSn, sido, ...patch });

  const findPath = (sn) => {
    const walk = (o, parents) => {
      const path = [...parents, o.name];
      if (o.sn === sn) return path.join(' › ');
      for (const c of o.children) { const r = walk(c, path); if (r) return r; }
      return null;
    };
    for (const r of tree.roots) { const x = walk(r, []); if (x) return x; }
    return '선택 안 됨';
  };

  const orgBtn = h('button', { class: 'btn', type: 'button', style: { minWidth: '240px', justifyContent: 'flex-start' } }, findPath(orgSn));
  orgBtn.addEventListener('click', () => pickOrg((o) => nav({ org: o.sn }), { title: '리포트 대상 조직' }));
  const sidoSel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => nav({ sido: e.target.value }) },
    h('option', { value: '' }, '모든 지역'), tree.sidoList.map((s) => h('option', { value: s, selected: s === sido }, s)));

  const seg = h('div', { class: 'seg' }, ps.map(([label, a, b]) => h('button', {
    type: 'button', 'aria-pressed': String(a === from && b === to), onclick: () => nav({ from: a, to: b }),
  }, label)));
  const fi = h('input', { type: 'date', value: from, max: today(), class: 'input', style: { width: 'auto' } });
  const ti = h('input', { type: 'date', value: to, max: today(), class: 'input', style: { width: 'auto' } });
  const applyDates = () => { if (fi.value && ti.value) nav(fi.value <= ti.value ? { from: fi.value, to: ti.value } : { from: ti.value, to: fi.value }); };
  fi.addEventListener('change', applyDates);
  ti.addEventListener('change', applyDates);

  const qs = new URLSearchParams(Object.entries({ org: orgSn, sido, from, to }).filter(([, v]) => v)).toString();
  const dl = h('button', { class: 'btn primary', type: 'button' }, 'PDF 받기');
  dl.addEventListener('click', async () => {
    dl.disabled = true;
    dl.textContent = 'PDF 만드는 중…';
    try {
      const res = await fetch(`/api/reports/pdf?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PDF를 만들지 못했습니다');
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const name = decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(cd) || [])[1] || 'ecoG_리포트.pdf');
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      toast('PDF를 내려받았습니다');
      loadHistory();
    } catch (e) {
      toast(e.message);
    } finally {
      dl.disabled = false;
      dl.textContent = 'PDF 받기';
    }
  });
  const preview = h('a', { class: 'btn', href: `/api/reports/preview?${qs}`, target: '_blank', rel: 'noopener' }, '미리보기');

  const form = h('section', { class: 'panel', style: { marginBottom: '16px' } },
    h('header', null, h('h2', null, 'ESG 리포트 만들기'), h('p', null, '표지에는 대상 조직의 로고가 들어갑니다')),
    h('div', { class: 'body' },
      h('div', { class: 'field' }, h('label', null, '대상'), h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, orgBtn, sidoSel)),
      h('div', { class: 'field' }, h('label', null, '기간'), h('div', { class: 'period' }, seg, fi, h('span', { class: 'faint' }, '~'), ti)),
      h('p', { class: 'muted', style: { fontSize: '14px', margin: '0 0 14px' } },
        `${findPath(orgSn)}${sido ? ` · ${sido}` : ''}, ${fmt.date(from)} ~ ${fmt.date(to)}. 표지, 한눈에 보기, 추이, 많이 쓴 설치처, 조직별 현황, 산정 기준과 출처가 들어갑니다.`),
      h('div', { style: { display: 'flex', gap: '8px' } }, dl, preview)));

  const histBody = h('div', { class: 'body tablewrap' }, h('div', { class: 'loading' }, '불러오는 중…'));
  const hist = h('section', { class: 'panel' }, h('header', null, h('h2', null, '최근 받은 리포트')), histBody);

  async function loadHistory() {
    const d = await api('/api/reports/history');
    histBody.replaceChildren(d.reports.length
      ? h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, '대상'), h('th', null, '기간'), h('th', null, '받은 사람'), h('th', null, '받은 시각'), h('th'))),
        h('tbody', null, d.reports.map((x) => h('tr', null,
          h('td', null, x.scope_desc), h('td', null, `${fmt.date(x.date_from)} ~ ${fmt.date(x.date_to)}`),
          h('td', null, x.created_by || '–'), h('td', { class: 'faint' }, x.created_at),
          h('td', { class: 'r' }, x.org_sn ? h('button', { class: 'btn small', onclick: () => go('reports', { org: x.org_sn, from: x.date_from, to: x.date_to }) }, '같은 조건으로') : null)))))
      : h('div', { class: 'empty' }, '아직 받은 리포트가 없습니다'));
  }

  view.replaceChildren(h('div', { class: 'head' }, h('h1', null, '리포트')), form, hist);
  loadHistory().catch((e) => histBody.replaceChildren(h('div', { class: 'err' }, e.message)));
}
