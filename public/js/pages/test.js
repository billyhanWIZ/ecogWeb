// 테스트 장비 모아 보기 (시스템 관리자·본사 관리자)
import { api, go } from '../app.js';
import { h, fmt, chart, axisStyle, statusPill, today, shift } from '../ui.js';
import { openDevice } from './device-drawer.js';

export default async function testPage(view, { params }) {
  const ranges = [['오늘', today(), today()], ['최근 7일', shift(today(), -6), today()], ['최근 30일', shift(today(), -29), today()], ['최근 90일', shift(today(), -89), today()]];
  const from = params.from || ranges[2][1];
  const to = params.to || today();
  const d = await api(`/api/test-devices?from=${from}&to=${to}`);
  const reload = () => go('test', { from, to }, { replace: true });

  const seg = h('div', { class: 'seg' }, ranges.map(([label, a, b]) => h('button', {
    type: 'button', 'aria-pressed': String(a === from && b === to), onclick: () => go('test', { from: a, to: b }),
  }, label)));

  const k = d.kpi;
  const kpis = h('div', { class: 'health', style: { gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '16px' } },
    h('a', { href: '#/devices?status=test' }, h('b', null, fmt.int(k.devices)), h('span', null, '테스트 장비')),
    h('a', { class: 'on', href: '#/devices?status=test' }, h('b', null, fmt.int(k.online)), h('span', null, '지금 신호 정상')),
    h('div', { style: { padding: '12px', border: '1px solid var(--line-2)', borderRadius: '6px' } }, h('b', { style: { fontSize: '26px', display: 'block', fontWeight: 650 } }, fmt.int(k.today)), h('span', { class: 'muted', style: { fontSize: '13px' } }, '오늘 사용')),
    h('div', { style: { padding: '12px', border: '1px solid var(--line-2)', borderRadius: '6px' } }, h('b', { style: { fontSize: '26px', display: 'block', fontWeight: 650 } }, fmt.int(k.uses)), h('span', { class: 'muted', style: { fontSize: '13px' } }, '기간 사용')));

  const chartEl = h('div', { class: 'chart short' });
  const rows = d.devices.map((x) => h('tr', { class: 'click', tabindex: '0', onclick: () => openDevice(x.deviceid, { from, to }, reload), onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
    h('td', null, h('b', { style: { fontWeight: 600 } }, x.name), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.deviceid)),
    h('td', null, x.sitePath || h('span', { class: 'faint' }, '미배정'), x.locationNote ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.locationNote) : null),
    h('td', null, statusPill(x.status, x.ago)),
    h('td', { class: 'r' }, fmt.int(x.today)),
    h('td', { class: 'r' }, h('b', null, fmt.int(x.uses))),
    h('td', null, fmt.date(x.markedAt), x.note ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.note) : null)));

  view.replaceChildren(
    h('div', { class: 'head' },
      h('div', null, h('h1', null, '테스트 장비'),
        h('p', { class: 'faint', style: { margin: '2px 0 0', fontSize: '13px' } }, '테스트로 지정한 장비만 모았습니다. 이 장비들은 대시보드·통계·리포트·사이니지 숫자에서 빠집니다.')),
      seg),
    kpis,
    h('section', { class: 'panel', style: { marginBottom: '16px' } },
      h('header', null, h('h2', null, '일별 사용 횟수'), h('p', null, `${fmt.date(d.period.from)} ~ ${fmt.date(d.period.to)}`)),
      h('div', { class: 'body' }, chartEl)),
    h('section', { class: 'panel' },
      h('header', null, h('h2', null, `장비 ${fmt.int(d.devices.length)}대`), h('p', null, '장비를 누르면 상세가 열리고, 거기서 테스트를 해제할 수 있습니다')),
      h('div', { class: 'body tablewrap' }, d.devices.length
        ? h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, '장비'), h('th', null, '설치처'), h('th', null, '상태'), h('th', { class: 'r' }, '오늘'), h('th', { class: 'r' }, '기간 사용'), h('th', null, '지정일·메모'))),
          h('tbody', null, rows))
        : h('div', { class: 'empty' }, '테스트 장비가 없습니다. 장비 상세에서 ‘테스트 장비로 지정’을 누르세요.'))));

  const c = await chart(chartEl, {
    grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
    xAxis: { type: 'category', data: d.trend.map((x) => `${Number(x.d.slice(5, 7))}/${Number(x.d.slice(8))}`), ...axisStyle, splitLine: { show: false } },
    yAxis: { type: 'value', ...axisStyle, minInterval: 1 },
    series: [{ type: 'bar', name: '사용 횟수', data: d.trend.map((x) => x.uses), barMaxWidth: 18, itemStyle: { color: '#7F9384', borderRadius: [2, 2, 0, 0] } }],
  });
  return () => c.dispose();
}
