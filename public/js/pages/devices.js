import { api, go } from '../app.js';
import { h, fmt, statusPill, modal, field, toast, today } from '../ui.js';
import { openDevice, showCode } from './device-drawer.js';

// 헤더 정렬 상태 (탭마다 따로 기억, 페이지를 새로 열면 기본 순서)
const sortBy = {};
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const STATUS_RANK = { online: 0, offline: 1, never: 2 };
// [키, 머리글, 오른쪽 정렬, 처음 누를 때 방향, 값 비교]
const COLS = [
  ['name', '장비', false, 1, (a, b) => collator.compare(a.name || '', b.name || '') || collator.compare(a.deviceid, b.deviceid)],
  ['site', '설치처', false, 1, (a, b) => (!a.sitePath - !b.sitePath) || collator.compare(a.sitePath || '', b.sitePath || '')],
  ['status', '상태', false, 1, (a, b) => (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1) || (a.ago ?? Infinity) - (b.ago ?? Infinity)],
  ['today', '오늘', true, -1, (a, b) => (a.today || 0) - (b.today || 0)],
  ['yesterday', '어제', true, -1, (a, b) => (a.yesterday || 0) - (b.yesterday || 0)],
  ['last7', '7일', true, -1, (a, b) => (a.last7 || 0) - (b.last7 || 0)],
  ['last30', '30일', true, -1, (a, b) => (a.last30 || 0) - (b.last30 || 0)],
  ['installed', '설치일', true, -1, (a, b) => collator.compare(a.installedOn || '', b.installedOn || '')],
];

export default async function devices(view, { params }) {
  const status = params.status || 'all';
  const kw = params.q || '';
  const d = await api(`/api/devices?status=${status}&q=${encodeURIComponent(kw)}`);
  const isSys = !!d.canManage; // 시스템 관리자 또는 본사 관리자
  const reload = () => go('devices', { status, q: kw }, { replace: true });
  void field;

  const TABS = [
    ['all', '전체', d.counts.all],
    ['online', '정상', d.counts.online],
    ['offline', '무신호', d.counts.offline],
    ['drop', '사용 급감', d.counts.drop],
    ...(isSys ? [['unassigned', '미배정', d.counts.unassigned], ['hidden', '숨김', d.counts.hidden]] : []),
    ...(d.canSeeTest ? [['test', '테스트', d.counts.test]] : []),
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
    offline: `신호가 끊긴 장비입니다. 오래 끊긴 순으로, 현장 점검 목록으로 쓰세요.${isSys ? ' 더 이상 쓰지 않는 장비는 골라서 철거하고 숨기세요.' : ''}`,
    drop: '최근 2주 평균은 꾸준한데 어제 한 번도 쓰이지 않은 장비입니다. 고장이나 위치 이동을 확인하세요.',
    unassigned: '전원을 켜면 스스로 등록되지만 아직 설치처가 없는 장비입니다. 눌러서 설치처를 배정하세요. 방금 켠 장비가 맨 위에 있습니다. 시험용·폐기 장비는 골라서 숨기세요.',
    hidden: '목록에서 숨긴 장비입니다. 장비 기록은 그대로 남아 있고, 숨긴 뒤 다시 신호가 들어오면 표시됩니다.',
    test: '테스트용으로 지정한 장비입니다. 대시보드·통계·리포트·사이니지 숫자에서 빠집니다. 사용량은 \'테스트 장비\' 메뉴에서 따로 봅니다.',
  }[status];

  // 미배정·무신호·숨김 탭: 여러 대 골라서 숨기기 / 되살리기 (무신호는 철거하고 숨김)
  const selectable = (isSys && (status === 'unassigned' || status === 'offline' || status === 'hidden')) || (d.canSeeTest && status === 'test');
  const picked = new Set();
  const countEl = h('span', { class: 'muted', style: { fontSize: '14px' } }, '');
  const actBtn = h('button', { class: `btn small ${status === 'unassigned' || status === 'offline' ? 'danger' : 'primary'}`, disabled: true, type: 'button' },
    status === 'hidden' ? '선택한 장비 다시 보이기' : status === 'test' ? '선택한 장비 테스트 해제' : status === 'offline' ? '선택한 장비 철거하고 숨기기' : '선택한 장비 숨기기');
  const testBtn = status === 'unassigned' ? h('button', { class: 'btn small', disabled: true, type: 'button' }, '선택한 장비 테스트로 지정') : null;
  const syncPicked = () => {
    countEl.textContent = picked.size ? `${picked.size}대 선택` : '';
    actBtn.disabled = !picked.size;
    if (testBtn) testBtn.disabled = !picked.size;
    view.querySelectorAll('input[data-dev]').forEach((c) => { c.checked = picked.has(c.dataset.dev); });
  };
  const pickWhere = (fn) => { d.devices.filter(fn).forEach((x) => picked.add(x.deviceid)); syncPicked(); };
  testBtn?.addEventListener('click', () => {
    api('/api/devices/test', { method: 'POST', body: { deviceids: [...picked], test: true } })
      .then((r) => { toast(`${r.count}대를 테스트 장비로 지정했습니다`); reload(); }).catch((e) => toast(e.message));
  });
  actBtn.addEventListener('click', () => {
    const ids = [...picked];
    if (status === 'test') {
      api('/api/devices/test', { method: 'POST', body: { deviceids: ids, test: false } })
        .then((r) => { toast(`${r.count}대를 운영 장비로 돌렸습니다`); reload(); }).catch((e) => toast(e.message));
      return;
    }
    if (status === 'hidden') {
      api('/api/devices/unhide', { method: 'POST', body: { deviceids: ids } })
        .then((r) => { toast(`${r.count}대를 다시 보이게 했습니다`); reload(); }).catch((e) => toast(e.message));
      return;
    }
    const reason = h('input', { maxlength: 200, placeholder: status === 'offline' ? '예: 철거, 고장 폐기' : '예: 시험용 장비, 폐기' });
    const off = status === 'offline';
    const date = off ? h('input', { type: 'date', value: today(), max: today() }) : null;
    modal(off ? `장비 ${ids.length}대 철거하고 숨기기` : `장비 ${ids.length}대 숨기기`, [
      off
        ? h('p', { style: { marginTop: 0 } }, '설치처에서 철거한 뒤 목록에서 숨깁니다. 철거일까지의 사용 기록은 원래 설치처에 그대로 남고, 대시보드·조직의 장비 수와 무신호 수에서 빠집니다. 숨김 탭에서 되살릴 수 있고, 다시 쓰려면 설치처를 배정하세요.')
        : h('p', { style: { marginTop: 0 } }, '새 화면의 장비 목록에서만 빠집니다. 세척 기록과 장비 등록 정보는 그대로 남고, 숨김 탭에서 언제든 되살릴 수 있습니다.'),
      off ? field('철거일', date) : null,
      field('사유', reason),
    ], {
      submitLabel: off ? '철거하고 숨기기' : '숨기기', danger: true,
      onSubmit: async () => {
        const r = await api('/api/devices/hide', { method: 'POST', body: { deviceids: ids, reason: reason.value, ...(off ? { removeOn: date.value } : {}) } });
        toast(r.removed ? `${r.removed}대를 철거하고 숨겼습니다` : `${r.count}대를 숨겼습니다`);
        reload();
      },
    });
  });
  const bulkBar = selectable ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } },
    status === 'unassigned' || status === 'offline' ? h('button', { class: 'btn small', type: 'button', onclick: () => pickWhere((x) => x.last30 === 0 && (x.ago == null || x.ago > 30 * 86400)) }, '30일 넘게 신호·사용 없는 장비 고르기') : null,
    h('button', { class: 'btn small', type: 'button', onclick: () => pickWhere(() => true) }, '모두 고르기'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { picked.clear(); syncPicked(); } }, '선택 해제'),
    countEl, h('span', { style: { flex: 1 } }), testBtn, actBtn) : null;
  const checkCell = (x) => (selectable ? h('td', { onclick: (e) => e.stopPropagation(), style: { width: '28px' } },
    h('input', { type: 'checkbox', 'data-dev': x.deviceid, 'aria-label': `${x.name} 선택`, onchange: (e) => { if (e.target.checked) picked.add(x.deviceid); else picked.delete(x.deviceid); syncPicked(); } })) : null);

  const rowOf = new Map();
  d.devices.forEach((x) => rowOf.set(x, h('tr', {
    class: 'click', tabindex: '0',
    onclick: () => openDevice(x.deviceid, null, reload),
    onkeydown: (e) => { if (e.key === 'Enter') openDevice(x.deviceid, null, reload); },
  },
  checkCell(x),
  h('td', null, h('b', { style: { fontWeight: 600 } }, x.name), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.deviceid)),
  h('td', null, x.sitePath || h('span', { class: 'faint' }, '미배정'), x.locationNote ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.locationNote) : null),
  h('td', null, statusPill(x.status, x.ago), x.test ? h('span', { class: 'pill never', style: { marginLeft: '4px' } }, '테스트') : null, x.drop ? h('span', { class: 'pill drop', style: { marginLeft: '4px' } }, '급감') : null,
    x.ble && x.ble !== 'connected' && x.status === 'online' ? h('div', { class: 'pill off', style: { marginTop: '3px' } }, x.ble === 'off' ? '태블릿 블루투스 꺼짐' : '세척기 연결 끊김') : null,
    x.hidden ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, `${x.hiddenAt} 숨김${x.hiddenReason ? ` · ${x.hiddenReason}` : ''}`) : null,
    x.signalAfterHide ? h('div', { class: 'pill drop', style: { marginTop: '3px' } }, '숨긴 뒤 신호 들어옴') : null),
  h('td', { class: 'r' }, fmt.int(x.today)),
  h('td', { class: 'r' }, fmt.int(x.yesterday)),
  h('td', { class: 'r' }, fmt.int(x.last7)),
  h('td', { class: 'r' }, fmt.int(x.last30)),
  h('td', { class: 'r faint' }, fmt.date(x.installedOn)))));

  // 머리글을 누르면 정렬: 한 번 → 처음 방향, 두 번 → 반대, 세 번 → 기본 순서
  const tbody = h('tbody');
  const ths = COLS.map(([key, label, right, first]) => {
    const th = h('th', { class: `sort${right ? ' r' : ''}`, tabindex: '0', role: 'columnheader', title: '눌러서 정렬' }, label, h('span', { class: 'arr', 'aria-hidden': 'true' }));
    const toggle = () => {
      const cur = sortBy[status];
      if (!cur || cur.key !== key) sortBy[status] = { key, dir: first };
      else if (cur.dir === first) sortBy[status] = { key, dir: -first };
      else delete sortBy[status];
      applySort();
    };
    th.addEventListener('click', toggle);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    th.dataset.key = key;
    return th;
  });
  const applySort = () => {
    const cur = sortBy[status];
    const list = [...d.devices]; // 서버가 준 순서가 기본
    if (cur) {
      const cmp = COLS.find((c) => c[0] === cur.key)[4];
      list.sort((a, b) => cmp(a, b) * cur.dir);
    }
    tbody.replaceChildren(...list.map((x) => rowOf.get(x)));
    ths.forEach((th) => {
      const on = cur && th.dataset.key === cur.key;
      th.setAttribute('aria-sort', on ? (cur.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.arr').textContent = on ? (cur.dir > 0 ? '▲' : '▼') : '';
    });
  };
  applySort();

  const addBtn = isSys ? h('button', { class: 'btn primary', type: 'button', onclick: () => {
    const name = h('input', { maxlength: 100, placeholder: '예: 경상국립대 1호기' });
    modal('새 장비 추가', [
      h('p', { style: { marginTop: 0 } }, '새 태블릿(웹·앱)을 붙일 세척기를 추가합니다. 장비 ID 와 태블릿 등록 코드를 만들어 드립니다. 추가한 장비는 미배정 탭에 있고, 설치처는 따로 배정하세요.'),
      h('p', { class: 'note' }, '세척기(태블릿)를 바꾸는 경우에는 새로 추가하지 말고, 기존 장비 상세에서 \'태블릿 바꾸기\'를 누르세요. 세척 기록을 이어받습니다.'),
      field('장비 이름', name),
    ], {
      submitLabel: '추가',
      onSubmit: async () => {
        const r = await api('/api/devices/new', { method: 'POST', body: { name: name.value } });
        go('devices', { status: 'unassigned', q: '', open: r.deviceid });
        setTimeout(() => showCode(r, name.value), 600); // 화면 이동이 끝난 뒤 (이동하면 열린 창이 닫힘)
      },
    });
  } }, '새 장비 추가') : null;

  view.replaceChildren(
    h('div', { class: 'head' }, h('div', null, h('h1', null, '장비')), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, search, addBtn)),
    tabs,
    h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '14px' } }, help),
    bulkBar || '',
    h('section', { class: 'panel' }, h('div', { class: 'body tablewrap', style: { paddingTop: '10px' } }, d.devices.length
      ? h('table', { class: 't' },
        h('thead', null, h('tr', null, selectable ? h('th') : null, ths)),
        tbody)
      : h('div', { class: 'empty' }, kw ? `'${kw}'에 맞는 장비가 없습니다` : '해당하는 장비가 없습니다'))));

  if (params.open) openDevice(params.open, null, reload);
}
