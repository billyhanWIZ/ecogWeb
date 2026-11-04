import { api, go, state } from '../app.js';
import { h, fmt, statusPill } from '../ui.js';
import { openDevice } from './device-drawer.js';

export default async function devices(view, { params }) {
  const status = params.status || 'all';
  const kw = params.q || '';
  const d = await api(`/api/devices?status=${status}&q=${encodeURIComponent(kw)}`);
  const isSys = state.me.user.role === 'SYSADMIN';
  const reload = () => go('devices', { status, q: kw }, { replace: true });

  const TABS = [
    ['all', '전체', d.counts.all],
    ['online', '정상', d.counts.online],
    ['offline', '무신호', d.counts.offline],
    ['drop', '사용 급감', d.counts.drop],
    ...(isSys ? [['unassigned', '미배정', d.counts.unassigned]] : []),
  ];
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label, n]) => h('button', {
    role: 'tab', 'aria-selected': String(status === k), onclick: () => go('devices', { status: k, q: kw }),
  }, label, h('span', null, fmt.int(n)))));

  const search = h('input', { class: 'input', style: { maxWidth: '280px' }, placeholder: '장비 이름, ID, 설치처로 찾기', value: kw, 'aria-label': '장비 검색' });
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => go('devices', { status, q: search.value.trim() }), 350); });

  const help = {
    all: '설치처에 배정된 장비입니다. 30일 사용량이 많은 순입니다.',
    online: `${d.offlineSeconds}초 안에 신호가 들어온 장비입니다.`,
    offline: '신호가 끊긴 장비입니다. 오래 끊긴 순으로, 현장 점검 목록으로 쓰세요.',
    drop: '최근 2주 평균은 꾸준한데 어제 한 번도 쓰이지 않은 장비입니다. 고장이나 위치 이동을 확인하세요.',
    unassigned: '전원을 켜면 스스로 등록되지만 아직 설치처가 없는 장비입니다. 눌러서 설치처를 배정하세요. 방금 켠 장비가 맨 위에 있습니다.',
  }[status];

  const rows = d.devices.map((x) => h('tr', {
    class: 'click', tabindex: '0',
    onclick: () => openDevice(x.deviceid, null, reload),
    onkeydown: (e) => { if (e.key === 'Enter') openDevice(x.deviceid, null, reload); },
  },
  h('td', null, h('b', { style: { fontWeight: 600 } }, x.name), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.deviceid)),
  h('td', null, x.sitePath || h('span', { class: 'faint' }, '미배정'), x.locationNote ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.locationNote) : null),
  h('td', null, statusPill(x.status, x.ago), x.drop ? h('span', { class: 'pill drop', style: { marginLeft: '4px' } }, '급감') : null),
  h('td', { class: 'r' }, fmt.int(x.today)),
  h('td', { class: 'r' }, fmt.int(x.yesterday)),
  h('td', { class: 'r' }, fmt.int(x.last7)),
  h('td', { class: 'r' }, fmt.int(x.last30)),
  h('td', { class: 'r faint' }, fmt.date(x.installedOn))));

  view.replaceChildren(
    h('div', { class: 'head' }, h('div', null, h('h1', null, '장비')), search),
    tabs,
    h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '14px' } }, help),
    h('section', { class: 'panel' }, h('div', { class: 'body tablewrap', style: { paddingTop: '10px' } }, d.devices.length
      ? h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, '장비'), h('th', null, '설치처'), h('th', null, '상태'),
          h('th', { class: 'r' }, '오늘'), h('th', { class: 'r' }, '어제'), h('th', { class: 'r' }, '7일'), h('th', { class: 'r' }, '30일'), h('th', { class: 'r' }, '설치일'))),
        h('tbody', null, rows))
      : h('div', { class: 'empty' }, kw ? `'${kw}'에 맞는 장비가 없습니다` : '해당하는 장비가 없습니다'))));

  if (params.open) openDevice(params.open, null, reload);
}
