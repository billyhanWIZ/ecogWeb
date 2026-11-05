import { api, go } from '../app.js';
import { h, fmt, statusPill, modal, field, toast } from '../ui.js';
import { openDevice } from './device-drawer.js';

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
    offline: '신호가 끊긴 장비입니다. 오래 끊긴 순으로, 현장 점검 목록으로 쓰세요.',
    drop: '최근 2주 평균은 꾸준한데 어제 한 번도 쓰이지 않은 장비입니다. 고장이나 위치 이동을 확인하세요.',
    unassigned: '전원을 켜면 스스로 등록되지만 아직 설치처가 없는 장비입니다. 눌러서 설치처를 배정하세요. 방금 켠 장비가 맨 위에 있습니다. 시험용·폐기 장비는 골라서 숨기세요.',
    hidden: '목록에서 숨긴 장비입니다. 장비 기록은 그대로 남아 있고, 숨긴 뒤 다시 신호가 들어오면 표시됩니다.',
    test: '테스트용으로 지정한 장비입니다. 대시보드·통계·리포트·사이니지 숫자에서 빠집니다. 사용량은 \'테스트 장비\' 메뉴에서 따로 봅니다.',
  }[status];

  // 미배정·숨김 탭: 여러 대 골라서 숨기기 / 되살리기
  const selectable = (isSys && (status === 'unassigned' || status === 'hidden')) || (d.canSeeTest && status === 'test');
  const picked = new Set();
  const countEl = h('span', { class: 'muted', style: { fontSize: '14px' } }, '');
  const actBtn = h('button', { class: `btn small ${status === 'unassigned' ? 'danger' : 'primary'}`, disabled: true, type: 'button' },
    status === 'hidden' ? '선택한 장비 다시 보이기' : status === 'test' ? '선택한 장비 테스트 해제' : '선택한 장비 숨기기');
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
    const reason = h('input', { maxlength: 200, placeholder: '예: 시험용 장비, 폐기' });
    modal(`장비 ${ids.length}대 숨기기`, [
      h('p', { style: { marginTop: 0 } }, '새 화면의 장비 목록에서만 빠집니다. 세척 기록과 장비 등록 정보는 그대로 남고, 숨김 탭에서 언제든 되살릴 수 있습니다.'),
      field('사유', reason),
    ], {
      submitLabel: '숨기기', danger: true,
      onSubmit: async () => {
        const r = await api('/api/devices/hide', { method: 'POST', body: { deviceids: ids, reason: reason.value } });
        toast(`${r.count}대를 숨겼습니다`);
        reload();
      },
    });
  });
  const bulkBar = selectable ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } },
    status === 'unassigned' ? h('button', { class: 'btn small', type: 'button', onclick: () => pickWhere((x) => x.last30 === 0 && (x.ago == null || x.ago > 30 * 86400)) }, '30일 넘게 신호·사용 없는 장비 고르기') : null,
    h('button', { class: 'btn small', type: 'button', onclick: () => pickWhere(() => true) }, '모두 고르기'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { picked.clear(); syncPicked(); } }, '선택 해제'),
    countEl, h('span', { style: { flex: 1 } }), testBtn, actBtn) : null;
  const checkCell = (x) => (selectable ? h('td', { onclick: (e) => e.stopPropagation(), style: { width: '28px' } },
    h('input', { type: 'checkbox', 'data-dev': x.deviceid, 'aria-label': `${x.name} 선택`, onchange: (e) => { if (e.target.checked) picked.add(x.deviceid); else picked.delete(x.deviceid); syncPicked(); } })) : null);

  const rows = d.devices.map((x) => h('tr', {
    class: 'click', tabindex: '0',
    onclick: () => openDevice(x.deviceid, null, reload),
    onkeydown: (e) => { if (e.key === 'Enter') openDevice(x.deviceid, null, reload); },
  },
  checkCell(x),
  h('td', null, h('b', { style: { fontWeight: 600 } }, x.name), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.deviceid)),
  h('td', null, x.sitePath || h('span', { class: 'faint' }, '미배정'), x.locationNote ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, x.locationNote) : null),
  h('td', null, statusPill(x.status, x.ago), x.test ? h('span', { class: 'pill never', style: { marginLeft: '4px' } }, '테스트') : null, x.drop ? h('span', { class: 'pill drop', style: { marginLeft: '4px' } }, '급감') : null,
    x.hidden ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, `${x.hiddenAt} 숨김${x.hiddenReason ? ` · ${x.hiddenReason}` : ''}`) : null,
    x.signalAfterHide ? h('div', { class: 'pill drop', style: { marginTop: '3px' } }, '숨긴 뒤 신호 들어옴') : null),
  h('td', { class: 'r' }, fmt.int(x.today)),
  h('td', { class: 'r' }, fmt.int(x.yesterday)),
  h('td', { class: 'r' }, fmt.int(x.last7)),
  h('td', { class: 'r' }, fmt.int(x.last30)),
  h('td', { class: 'r faint' }, fmt.date(x.installedOn))));

  view.replaceChildren(
    h('div', { class: 'head' }, h('div', null, h('h1', null, '장비')), search),
    tabs,
    h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '14px' } }, help),
    bulkBar || '',
    h('section', { class: 'panel' }, h('div', { class: 'body tablewrap', style: { paddingTop: '10px' } }, d.devices.length
      ? h('table', { class: 't' },
        h('thead', null, h('tr', null, selectable ? h('th') : null, h('th', null, '장비'), h('th', null, '설치처'), h('th', null, '상태'),
          h('th', { class: 'r' }, '오늘'), h('th', { class: 'r' }, '어제'), h('th', { class: 'r' }, '7일'), h('th', { class: 'r' }, '30일'), h('th', { class: 'r' }, '설치일'))),
        h('tbody', null, rows))
      : h('div', { class: 'empty' }, kw ? `'${kw}'에 맞는 장비가 없습니다` : '해당하는 장비가 없습니다'))));

  if (params.open) openDevice(params.open, null, reload);
}
