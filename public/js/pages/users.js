import { api, go, state } from '../app.js';
import { h, modal, field, toast } from '../ui.js';
import { pickOrg } from './org-picker.js';

export default async function users(view) {
  const d = await api('/api/users');
  const reload = () => go('users', {}, { replace: true });

  const rows = d.users.map((u) => h('tr', { style: u.active === 'N' ? { opacity: 0.5 } : null },
    h('td', null, h('b', { style: { fontWeight: 600 } }, u.name), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, u.login_id)),
    h('td', null, u.roleLabel),
    h('td', null, u.role === 'SYSADMIN' ? h('span', { class: 'faint' }, '전체') : u.orgPath || '–'),
    h('td', null, u.last_login_at || h('span', { class: 'faint' }, '없음'), u.must_change_pw === 'Y' ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, '임시 비밀번호') : null),
    h('td', null, u.active === 'Y' ? '사용' : '중지'),
    h('td', { class: 'r' },
      h('button', { class: 'btn small', onclick: () => edit(u) }, '수정'), ' ',
      h('button', { class: 'btn small', onclick: () => reset(u) }, '비밀번호 초기화'))));

  view.replaceChildren(
    h('div', { class: 'head' }, h('div', null, h('h1', null, '사용자'),
      h('p', { class: 'faint', style: { margin: '2px 0 0', fontSize: '13px' } }, '사용자는 지정한 조직과 그 아래만 볼 수 있습니다.')),
    h('button', { class: 'btn primary', onclick: () => edit(null) }, '사용자 추가')),
    h('section', { class: 'panel' }, h('div', { class: 'body tablewrap', style: { paddingTop: '10px' } },
      h('table', { class: 't' },
        h('thead', null, h('tr', null, h('th', null, '이름'), h('th', null, '역할'), h('th', null, '볼 수 있는 조직'), h('th', null, '마지막 로그인'), h('th', null, '상태'), h('th'))),
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
    const active = h('select', null, h('option', { value: 'Y', selected: u?.active !== 'N' }, '사용'), h('option', { value: 'N', selected: u?.active === 'N' }, '중지'));
    const orgField = h('div', { class: 'field' }, h('label', null, '볼 수 있는 조직'), orgBtn, h('span', { class: 'hint' }, '이 조직과 그 아래 조직만 보입니다'));
    const syncRole = () => orgField.classList.toggle('hidden', role.value === 'SYSADMIN');
    role.addEventListener('change', syncRole);
    syncRole();
    modal(isNew ? '사용자 추가' : '사용자 수정', [
      h('div', { class: 'row' }, field('아이디', loginId), field('이름', name)),
      field('역할', role, '고객 관리자는 자기 조직의 조직·사용자를 관리할 수 있고, 조회자는 보기만 합니다'),
      orgField,
      field('이메일', email),
      isNew ? null : field('상태', active),
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
