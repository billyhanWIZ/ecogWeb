import { api, go, state } from '../app.js';
import { weatherNodes, weatherTitle } from '../wx.js';
import { h, fmt, periodPicker, defaultPeriod, chart, axisStyle, bucketLabel, ensureKoreaMap } from '../ui.js';

const UNIT = { day: '일별', week: '주별', month: '월별' };

// 머리말 오른쪽 사진 속 세척기 몸통 위 시계·날씨 (TV 화면과 같은 모양)
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
function liveClock(disposers) {
  const time = h('b');
  const date = h('small');
  const wx = h('div', { class: 'wx', hidden: true });
  const box = h('div', { class: 'dash-clock' }, h('time', null, time, date), wx);
  const tick = () => {
    const t = new Date();
    time.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    date.textContent = `${t.getFullYear()}.${pad(t.getMonth() + 1)}.${pad(t.getDate())} (${DAYS[t.getDay()]})`;
  };
  const loadWx = async () => {
    try {
      const { weather } = await api('/api/weather');
      const nodes = weatherNodes(weather);
      if (!nodes) { wx.hidden = true; return; }
      wx.replaceChildren(...nodes);
      wx.title = weatherTitle(weather);
      wx.hidden = false;
    } catch { /* 날씨는 없어도 된다 */ }
  };
  tick();
  loadWx();
  const t1 = setInterval(tick, 1000);
  const t2 = setInterval(loadWx, 10 * 60_000);
  disposers.push(() => { clearInterval(t1); clearInterval(t2); });
  return box;
}

export default async function dashboard(view, { params }) {
  const p = defaultPeriod(params);
  const [d, dv] = await Promise.all([api(`/api/dashboard?from=${p.from}&to=${p.to}`), api('/api/devices?status=drop')]);
  const k = d.kpi;
  const disposers = [];
  const isSys = d.health?.unassigned != null; // 미배정 장비를 다루는 사용자(시스템·본사 관리자)

  const head = h('div', { class: 'head' },
    h('div', null, h('h1', null, '대시보드'), h('div', { class: 'faint', style: { fontSize: '13px', marginTop: '2px' } },
      `${fmt.date(d.period.from)} ~ ${fmt.date(d.period.to)} · 비교 기간 ${fmt.date(d.prevPeriod.from)} ~ ${fmt.date(d.prevPeriod.to)}`)),
    periodPicker(p, (np) => go('dashboard', np)));

  // 머리말: 사용 횟수를 문장으로
  const chg = (c) => (c == null ? null : h('span', { class: `chg ${c >= 0 ? 'up' : 'down'}` }, `${c >= 0 ? '+' : ''}${fmt.one(c * 100)}%`));
  const clock = liveClock(disposers);
  const impact = h('section', { class: 'impact with-photo', 'aria-label': '기간 요약' },
    h('div', { class: 'photo', role: 'img', 'aria-label': 'eco.G 텀블러 세척기' }),
    clock,
    h('p', { class: 'lead' }, `${state.me.org?.name || '전체'} 텀블러 세척기는 이 기간에`),
    h('p', { class: 'big' }, `${fmt.int(k.uses)}번 씻었습니다`),
    h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('b', null, fmt.co2(k.co2Kg), chg(k.change)), h('span', null, '탄소 저감, 직전 기간 대비')),
      h('div', { class: 'fact' }, h('b', null, `${fmt.int(k.trees)}그루`), h('span', null, '30년생 소나무 1년 흡수량으로 환산')),
      h('div', { class: 'fact' }, h('b', null, `${fmt.int(k.devicesUsed)} / ${fmt.int(k.devicesInstalled)}대`), h('span', null, '이 기간 한 번이라도 쓰인 장비')),
      h('div', { class: 'fact' }, h('b', null, `${fmt.int(k.cumulativeUses)}회`), h('span', null, `설치 이후 누적 · 탄소 ${fmt.co2(k.cumulative.co2Kg)}`))));

  // 추이
  const trendEl = h('div', { class: 'chart' });
  const trend = h('section', { class: 'panel' },
    h('header', null, h('h2', null, `${UNIT[d.unit]} 사용 횟수`), h('p', null, `가동일률 ${fmt.pct(k.activeRate)} (장비가 하루라도 쓰인 날의 비율)`)),
    h('div', { class: 'body' }, trendEl));

  // 장비 상태
  const hl = d.health;
  const total = hl.online + hl.offline + hl.never || 1;
  const health = h('section', { class: 'panel' },
    h('header', null, h('h2', null, '지금 장비 상태'), h('p', null, `${fmt.int(hl.online + hl.offline + hl.never)}대 배정`)),
    h('div', { class: 'body' },
      h('div', { class: 'bar', role: 'img', 'aria-label': `정상 ${hl.online}대, 무신호 ${hl.offline + hl.never}대` },
        h('i', { style: { width: `${(hl.online / total) * 100}%`, background: 'var(--leaf)' } }),
        h('i', { style: { width: `${((hl.offline + hl.never) / total) * 100}%`, background: 'var(--amber)' } })),
      h('div', { class: 'health', style: { marginTop: '12px' } },
        h('a', { class: 'on', href: '#/devices?status=online' }, h('b', null, fmt.int(hl.online)), h('span', null, '정상')),
        h('a', { class: 'off', href: '#/devices?status=offline' }, h('b', null, fmt.int(hl.offline + hl.never)), h('span', null, '무신호')),
        isSys
          ? h('a', { class: 'un', href: '#/devices?status=unassigned' }, h('b', null, fmt.int(hl.unassigned)), h('span', null, '미배정'))
          : h('a', { class: 'off', href: '#/devices?status=drop' }, h('b', null, fmt.int(dv.counts.drop)), h('span', null, '사용 급감'))),
      h('p', { class: 'faint', style: { fontSize: '13px', margin: '12px 0 0' } },
        `장비는 1초마다 신호를 보냅니다. ${state.me.settings.offlineSeconds}초 넘게 끊기면 무신호로 봅니다.`)));

  // 지도 + 순위
  const mapEl = h('div', { class: 'chart tall' });
  const map = h('section', { class: 'panel' },
    h('header', null, h('h2', null, '시도별 사용 횟수'), h('a', { href: `#/stats?by=sido&from=${p.from}&to=${p.to}` }, '시도별 통계 보기')),
    h('div', { class: 'body' }, mapEl));
  const maxUse = Math.max(1, ...d.topSites.map((s) => s.uses));
  const top = h('section', { class: 'panel' },
    h('header', null, h('h2', null, '많이 쓴 설치처'), h('a', { href: `#/stats?by=site&from=${p.from}&to=${p.to}` }, '전체 보기')),
    h('div', { class: 'body' }, d.topSites.length
      ? h('ol', { class: 'rank' }, d.topSites.map((s) => h('li', null,
        h('a', { href: `#/stats?by=device&site=${s.key}&from=${p.from}&to=${p.to}`, style: { color: 'var(--ink)' } }, s.label),
        h('span', { class: 'num' }, `${fmt.int(s.uses)}회 `, fmt.change(s.change)),
        h('div', { class: 'meter' }, h('i', { style: { width: `${(s.uses / maxUse) * 100}%` } })))))
      : h('div', { class: 'empty' }, '이 기간에 사용 기록이 없습니다')));

  view.replaceChildren(head, impact,
    h('div', { class: 'grid g-2-1', style: { marginBottom: '16px' } }, trend, health),
    h('div', { class: 'grid g-1-1' }, map, top));

  const t = await chart(trendEl, {
    xAxis: { type: 'category', data: d.trend.map((x) => bucketLabel(x.bucket, d.unit)), ...axisStyle, splitLine: { show: false } },
    yAxis: { type: 'value', ...axisStyle, minInterval: 1 },
    series: [{ type: 'bar', name: '사용 횟수', data: d.trend.map((x) => x.uses), barMaxWidth: 28, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  });
  disposers.push(t.dispose);

  const ec = await ensureKoreaMap();
  if (!view.isConnected) return () => disposers.forEach((f) => f());
  const sido = d.bySido.filter((s) => s.key !== '미지정');
  const m = await chart(mapEl, {
    tooltip: {
      trigger: 'item', backgroundColor: '#134226', borderWidth: 0, textStyle: { color: '#fff' },
      formatter: (x) => `${x.name}<br>${x.value ? `${fmt.int(x.value)}회` : '기록 없음'}`,
    },
    visualMap: {
      min: 0, max: Math.max(1, ...sido.map((s) => s.uses)), left: 8, bottom: 8, itemHeight: 90, calculable: false,
      inRange: { color: ['#E6F2E9', '#1F7A45', '#134226'] }, text: ['많음', '적음'], textStyle: { color: '#7F9384' },
    },
    series: [{
      type: 'map', map: 'korea', roam: false, layoutCenter: ['55%', '52%'], layoutSize: '95%',
      itemStyle: { areaColor: '#F0F4EF', borderColor: '#fff' },
      emphasis: { label: { show: false }, itemStyle: { areaColor: '#A8D46F' } },
      select: { disabled: true },
      data: sido.map((s) => ({ name: s.key, value: s.uses })),
    }],
  });
  m.chart.on('click', (e) => { if (e.value) go('stats', { by: 'sigungu', sido: e.name, from: p.from, to: p.to }); });
  disposers.push(m.dispose);
  void ec;
  return () => disposers.forEach((f) => f());
}
