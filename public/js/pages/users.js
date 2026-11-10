import { api, go, state } from '../app.js';
import { h, modal, field, toast } from '../ui.js';
import { pickOrg } from './org-picker.js';

export default async function users(view) {
  const d = await api('/api/users');
  const reload = () => go('users', {}, { replace: true });

  const meSn = state.me?.user?.sn;
  const off = d.users.filter((u) => u.active === 'N').length;
  // 여러 명 골라서 미사용 / 다시 사용 (자기 자신은 고를 수 없음)
  const picked = new Set();
  const countEl = h('span', { class: 'muted', style: { fontSize: '14px' } }, '');
  const offBtn = h('button', { class: 'btn small danger', type: 'button', disabled: true, onclick: () => bulk('N') }, '선택한 사용자 미사용 처리');
  const onBtn = h('button', { class: 'btn small primary', type: 'button', disabled: true, onclick: () => bulk('Y') }, '선택한 사용자 다시 사용');
  const pickedUsers = () => d.users.filter((u) => picked.has(u.sn));
  const syncPicked = () => {
    const list = pickedUsers();
    countEl.textContent = list.length ? `${list.length}명 선택` : '';
    offBtn.disabled = !list.some((u) => u.active === 'Y');
    onBtn.disabled = !list.some((u) => u.active === 'N');
    view.querySelectorAll('input[data-user]').forEach((c) => { c.checked = picked.has(Number(c.dataset.user)); });
    if (allBox) {
      const n = d.users.filter((u) => u.sn !== meSn).length;
      allBox.checked = n > 0 && list.length === n;
      allBox.indeterminate = list.length > 0 && list.length < n;
    }
  };
  const pickWhere = (fn) => { picked.clear(); d.users.filter((u) => u.sn !== meSn && fn(u)).forEach((u) => picked.add(u.sn)); syncPicked(); };
  const allBox = h('input', { type: 'checkbox', 'aria-label': '모두 고르기', onchange: (e) => (e.target.checked ? pickWhere(() => true) : pickWhere(() => false)) });
  const bulkBar = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } },
    h('button', { class: 'btn small', type: 'button', onclick: () => pickWhere((u) => u.active === 'Y' && !u.last_login_at) }, '로그인한 적 없는 사용자 고르기'),
    h('button', { class: 'btn small', type: 'button', onclick: () => pickWhere(() => false) }, '선택 해제'),
    countEl, h('span', { style: { flex: 1 } }), onBtn, offBtn);

  const rows = d.users.map((u) => h('tr', { class: u.active === 'N' ? 'inactive' : null },
    h('td', { style: { width: '28px' } }, u.sn === meSn ? null : h('input', {
      type: 'checkbox', 'data-user': u.sn, 'aria-label': `${u.name} 선택`,
      onchange: (e) => { if (e.target.checked) picked.add(u.sn); else picked.delete(u.sn); syncPicked(); },
    })),
    h('td', null, h('b', { style: { fontWeight: 600 } }, u.name), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, u.login_id)),
    h('td', null, u.roleLabel),
    h('td', null, u.role === 'SYSADMIN' ? h('span', { class: 'faint' }, '전체') : u.orgPath || '–'),
    h('td', null, u.last_login_at || h('span', { class: 'faint' }, '없음'), u.must_change_pw === 'Y' ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, '임시 비밀번호') : null),
    h('td', null, u.active === 'Y' ? h('span', { class: 'pill on' }, '사용') : h('span', { class: 'pill never' }, '미사용')),
    h('td', { class: 'r', style: { whiteSpace: 'nowrap' } },
      h('button', { class: 'btn small', onclick: () => edit(u) }, '수정'), ' ',
      h('button', { class: 'btn small', onclick: () => reset(u) }, '비밀번호 초기화'), ' ',
      u.sn === meSn ? null : u.active === 'Y'
        ? h('button', { class: 'btn small danger', onclick: () => setActive(u, 'N') }, '미사용 처리')
        : h('button', { class: 'btn small primary', onclick: () => setActive(u, 'Y') }, '다시 사용'))));

  view.replaceChildren(
    h('div', { class: 'head' }, h('div', null, h('h1', null, '사용자'),
      h('p', { class: 'faint', style: { margin: '2px 0 0', fontSize: '13px' } }, `사용자는 지정한 조직과 그 아래만 볼 수 있습니다. 미사용 사용자는 로그인할 수 없습니다.${off ? ` (미사용 ${off}명)` : ''}`)),
    h('button', { class: 'btn primary', onclick: () => edit(null) }, '사용자 추가')),
    bulkBar,
    h('section', { class: 'panel' }, h('div', { class: 'body tablewrap', style: { paddingTop: '10px' } },
      h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', { style: { width: '28px' } }, allBox), h('th', null, '이름'), h('th', null, '역할'), h('th', null, '볼 수 있는 조직'), h('th', null, '마지막 로그인'), h('th', null, '상태'), h('th'))),
        h('tbody', null, rows)))));

  function edit(u) {
    const isNew = !u;
    let orgSn = u?.org_sn || null;
    const loginId = h('input', { value: u?.login_id || '', required: true, disabled: !isNew, autocomplete: 'off' });
    const name = h('input', { value: u?.name || '', required: true });
    const email = h('input', { type: 'email', value: u?.email || '' });
    const role = h('select', null, d.roles.map((r) => h('option', { value: r.value, selected: (u?.role || 'VIEWER') === r.value }, r.label)));
    const orgBtn = h('button', { class: 'btn', type: 'button', style: { width: '100%', justifyContent: 'flex-start' } }, u?.orgPath || '조직 고르기');
    orgBtn.addEventListener('click', () => pickOrg((o) => { orgSn = o.sn; orgBtn.textContent = o.path; }, { title: '볼 수 있는 조직', selectedSn: orgSn }));
    const active = h('select', null, h('option', { value: 'Y', selected: u?.active !== 'N' }, '사용'), h('option', { value: 'N', selected: u?.active === 'N' }, '미사용'));
    const orgField = h('div', { class: 'field' }, h('label', null, '볼 수 있는 조직'), orgBtn, h('span', { class: 'hint' }, '이 조직과 그 아래 조직만 보입니다'));
    const syncRole = () => orgField.classList.toggle('hidden', role.value === 'SYSADMIN');
    role.addEventListener('change', syncRole);
    syncRole();
    modal(isNew ? '사용자 추가' : '사용자 수정', [
      h('div', { class: 'row' }, field('아이디', loginId), field('이름', name)),
      field('역할', role, '고객 관리자는 자기 조직의 조직·사용자를 관리할 수 있고, 조회자는 보기만 합니다'),
      orgField,
      field('이메일', email),
      isNew || u.sn === meSn ? null : field('상태', active, '미사용으로 바꾸면 바로 로그아웃되고, 로그인할 때 \'사용 권한이 만료된 사용자\'라고 나옵니다'),
    ], {
      submitLabel: isNew ? '추가' : '저장',
      onSubmit: async () => {
        if (role.value !== 'SYSADMIN' && !orgSn) throw new Error('볼 수 있는 조직을 고르세요');
        if (isNew) {
          const r = await api('/api/users', { method: 'POST', body: { loginId: loginId.value, name: name.value, email: email.value, role: role.value, orgSn } });
          showTemp(name.value, loginId.value, r.tempPassword);
        } else {
          await api(`/api/users/${u.sn}`, { method: 'PATCH', body: { name: name.value, email: email.value, role: role.value, orgSn, active: active.value } });
          toast('저장했습니다');
        }
        reload();
      },
    });
  }

  function setActive(u, value) {
    const save = async () => {
      await api(`/api/users/${u.sn}`, { method: 'PATCH', body: { active: value } });
      toast(value === 'N' ? `${u.name}님을 미사용으로 바꿨습니다` : `${u.name}님을 다시 사용하게 했습니다`);
      reload();
    };
    if (value === 'Y') { save().catch((e) => toast(e.message)); return; }
    modal('미사용 처리', h('p', null, `${u.name}(${u.login_id})을(를) 미사용으로 바꿉니다. 바로 로그아웃되고, 로그인하면 '사용 권한이 만료된 사용자'라고 나옵니다. 기록은 그대로 남고 '다시 사용'으로 되돌릴 수 있습니다.`), {
      submitLabel: '미사용 처리', danger: true, onSubmit: save,
    });
  }

  function bulk(value) {
    const list = pickedUsers().filter((u) => u.active !== value);
    if (!list.length) return;
    const names = list.slice(0, 5).map((u) => u.name).join(', ') + (list.length > 5 ? ` 외 ${list.length - 5}명` : '');
    const save = async () => {
      const r = await api('/api/users/active', { method: 'POST', body: { sns: list.map((u) => u.sn), active: value } });
      toast(value === 'N' ? `${r.count}명을 미사용으로 바꿨습니다` : `${r.count}명을 다시 사용하게 했습니다`);
      reload();
    };
    modal(value === 'N' ? `${list.length}명 미사용 처리` : `${list.length}명 다시 사용`, [
      h('p', { style: { marginTop: 0 } }, names),
      h('p', null, value === 'N'
        ? '바로 로그아웃되고, 로그인하면 \'사용 권한이 만료된 사용자\'라고 나옵니다. 기록은 그대로 남고 \'다시 사용\'으로 되돌릴 수 있습니다.'
        : '다시 로그인할 수 있게 됩니다.'),
    ], { submitLabel: value === 'N' ? '미사용 처리' : '다시 사용', danger: value === 'N', onSubmit: save });
  }

  function reset(u) {
    modal('비밀번호 초기화', h('p', null, `${u.name}(${u.login_id})의 비밀번호를 임시 비밀번호로 바꿉니다. 다음 로그인 때 새 비밀번호를 정하게 됩니다.`), {
      submitLabel: '초기화',
      onSubmit: async () => {
        const r = await api(`/api/users/${u.sn}/reset-password`, { method: 'POST' });
        showTemp(u.name, u.login_id, r.tempPassword);
      },
    });
  }

  function showTemp(name, id, pw) {
    if (!pw) return;
    modal('임시 비밀번호', [
      h('p', null, `${name}(${id})에게 아래 임시 비밀번호를 전달하세요. 이 창을 닫으면 다시 볼 수 없습니다.`),
      h('p', { style: { fontSize: '22px', fontWeight: 650, letterSpacing: '0.04em', background: 'var(--brand-soft)', padding: '10px 14px', borderRadius: '6px', userSelect: 'all' } }, pw),
    ]);
  }
  void state;
}
