import { api, go } from '../app.js';
import { h, fmt, periodPicker, defaultPeriod, chart, axisStyle, bucketLabel, downloadUrl } from '../ui.js';
import { openDevice } from './device-drawer.js';

const BY = [['org', '조직'], ['sido', '시도'], ['sigungu', '시군구'], ['site', '설치처'], ['device', '세척기']];
const UNITS = [['', '자동'], ['day', '일'], ['week', '주'], ['month', '월']];

export default async function stats(view, { params }) {
  const p = defaultPeriod(params);
  const q = { by: params.by || 'org', unit: params.unit || '', org: params.org, sido: params.sido, sigungu: params.sigungu, site: params.site, ...p };
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  const d = await api(`/api/stats?${qs}`);
  const nav = (patch) => go('stats', { ...q, ...patch });
  const disposers = [];
  const byLabel = Object.fromEntries(BY)[d.by];

  // 조건 표시 (드릴다운 경로)
  const crumbs = h('div', { class: 'crumbs' });
  if (d.crumbs.length) {
    d.crumbs.forEach((c, i) => {
      if (i) crumbs.append(' › ');
      crumbs.append(i === d.crumbs.length - 1 ? h('span', null, c.name) : h('a', { href: '#', onclick: (e) => { e.preventDefault(); nav({ by: 'org', org: c.sn, site: '' }); } }, c.name));
    });
  }
  const filters = [['sido', '시도'], ['sigungu', '시군구'], ['site', '설치처']].filter(([k]) => q[k]);
  for (const [k, label] of filters) {
    crumbs.append(h('span', { class: 'pill never', style: { marginRight: '6px' } }, `${label}: ${k === 'site' ? (d.rows[0]?.sub || q.site) : q[k]}`,
      h('button', { class: 'close', style: { fontSize: '14px', padding: '0 0 0 4px' }, 'aria-label': `${label} 조건 지우기`, onclick: () => nav({ [k]: '' }) }, '×')));
  }

  const head = h('div', { class: 'head' },
    h('div', null, crumbs, h('h1', null, `${byLabel}별 통계`)),
    periodPicker(p, (np) => nav(np)));

  const bySeg = h('div', { class: 'seg', role: 'group', 'aria-label': '묶는 기준' },
    BY.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(d.by === k), onclick: () => nav({ by: k, org: k === 'org' ? q.org : q.org }) }, label)));
  const unitSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '추이 단위' },
    UNITS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String((q.unit || '') === k), onclick: () => nav({ unit: k }) }, label)));
  const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => downloadUrl(`/api/stats/export?${qs}`) }, '엑셀로 받기');
  const tools = h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' } },
    h('span', { class: 'muted', style: { fontSize: '13px' } }, '묶는 기준'), bySeg,
    h('span', { class: 'muted', style: { fontSize: '13px', marginLeft: '8px' } }, '추이'), unitSeg,
    h('span', { style: { flex: 1 } }), exportBtn);

  const t = d.total;
  const summary = h('p', { class: 'muted', style: { margin: '0 0 14px' } },
    `장비 ${fmt.int(t.devices)}대, 사용 ${fmt.int(t.uses)}회 (직전 기간 ${fmt.int(t.prevUses)}회, `, fmt.change(t.change),
    `), 탄소 ${fmt.co2(t.co2Kg)} 저감, 소나무 ${fmt.int(t.trees)}그루 효과`);

  const chartEl = h('div', { class: 'chart' });
  const chartPanel = h('section', { class: 'panel', style: { marginBottom: '16px' } },
    h('header', null, h('h2', null, '사용 횟수 추이'), h('p', null, d.series.lines.length > 1 ? `막대는 전체, 선은 상위 ${d.series.lines.length}개 ${byLabel}` : '')),
    h('div', { class: 'body' }, chartEl));

  const drillHint = d.by === 'device' ? '행을 누르면 세척기 상세를 엽니다' : '행을 누르면 한 단계 아래로 내려갑니다';
  const rows = d.rows.map((r) => h('tr', {
    class: r.drill ? 'click' : '',
    tabindex: r.drill ? '0' : null,
    onclick: () => (r.drill?.device ? openDevice(r.drill.device, p) : r.drill && nav({ ...r.drill })),
    onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); },
  },
  h('td', null, r.label, r.sub ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, r.sub) : null),
  h('td', { class: 'r' }, fmt.int(r.devices)),
  h('td', { class: 'r' }, h('b', null, fmt.int(r.uses))),
  h('td', { class: 'r' }, fmt.change(r.change)),
  h('td', { class: 'r' }, fmt.one(r.perDeviceDay)),
  h('td', { class: 'r' }, fmt.pct(r.activeRate)),
  h('td', { class: 'r' }, fmt.co2(r.co2Kg)),
  h('td', { class: 'r' }, fmt.one(r.trees))));

  const table = h('section', { class: 'panel' },
    h('header', null, h('h2', null, `${byLabel} ${fmt.int(d.rows.length)}곳`), h('p', null, drillHint)),
    h('div', { class: 'body tablewrap' }, d.rows.length
      ? h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, byLabel), h('th', { class: 'r' }, '장비(대)'), h('th', { class: 'r' }, '사용(회)'),
          h('th', { class: 'r' }, '직전 대비'), h('th', { class: 'r', title: '장비 1대가 하루에 쓰인 평균 횟수' }, '장비당 일평균'),
          h('th', { class: 'r', title: '장비가 하루라도 쓰인 날의 비율' }, '가동일률'), h('th', { class: 'r' }, '탄소 저감'), h('th', { class: 'r' }, '소나무(그루)'))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', null, h('td', null, '합계'), h('td', { class: 'r' }, fmt.int(t.devices)), h('td', { class: 'r' }, fmt.int(t.uses)),
          h('td', { class: 'r' }, fmt.change(t.change)), h('td', { class: 'r' }, fmt.one(t.perDeviceDay)), h('td', { class: 'r' }, fmt.pct(t.activeRate)),
          h('td', { class: 'r' }, fmt.co2(t.co2Kg)), h('td', { class: 'r' }, fmt.one(t.trees)))))
      : h('div', { class: 'empty' }, '이 조건에 해당하는 장비가 없습니다. 기간이나 기준을 바꿔 보세요.')));

  view.replaceChildren(head, tools, summary, chartPanel, table);

  const labels = d.series.buckets.map((b) => bucketLabel(b, d.unit));
  const c = await chart(chartEl, {
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: '#4D6152' } },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: labels, ...axisStyle, splitLine: { show: false } },
    yAxis: { type: 'value', ...axisStyle, minInterval: 1 },
    series: [
      { type: 'bar', name: '전체', data: d.series.total, barMaxWidth: 26, itemStyle: { color: '#D9ECD9', borderRadius: [3, 3, 0, 0] } },
      ...(d.series.lines.length > 1 ? d.series.lines.map((l) => ({ type: 'line', name: l.label, data: l.values, symbol: 'none', smooth: false, lineStyle: { width: 2 } })) : []),
    ],
  });
  disposers.push(c.dispose);
  return () => disposers.forEach((f) => f());
}
