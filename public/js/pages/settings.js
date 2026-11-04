import { api, go } from '../app.js';
import { h, toast } from '../ui.js';

const LABEL = {
  co2_per_use_g: ['세척 1회당 탄소 저감(g)', '일회용 플라스틱컵(300mL) 1개 LCA 배출량, 기후변화행동연구소. 종이컵 기준이면 28'],
  co2_per_tree_kg: ['소나무 1그루 연간 흡수(kg)', '30년생 소나무, 국립산림과학원'],
  offline_seconds: ['무신호 기준(초)', '장비는 1초마다 신호를 보냅니다'],
  drop_min_avg: ['사용 급감 기준(회/일)', '최근 2주 하루 평균이 이 이상인데 어제 0회면 급감으로 표시'],
};
const ACTION = {
  login: '로그인', 'password.change': '비밀번호 변경', 'device.assign': '장비 배정·이설', 'device.unassign': '장비 철거', 'device.update': '장비 정보 수정',
  'org.create': '조직 추가', 'org.update': '조직 수정', 'org.move': '조직 이동', 'org.delete': '조직 삭제', 'org.logo': '로고 변경', 'org.logo.remove': '로고 삭제',
  'device.hide': '장비 숨김', 'device.unhide': '장비 숨김 해제', 'report.download': '리포트 받기', 'signage.issue': '사이니지 링크 발급', 'signage.revoke': '사이니지 링크 끄기',
  'user.create': '사용자 추가', 'user.update': '사용자 수정', 'user.reset_password': '비밀번호 초기화', 'settings.update': '설정 변경',
};

export default async function settings(view) {
  const [s, a] = await Promise.all([api('/api/settings'), api('/api/audit')]);
  const inputs = {};
  const form = h('form', null,
    s.settings.filter((x) => LABEL[x.skey]).map((x) => {
      const inp = h('input', { type: 'number', step: 'any', min: '0', value: x.svalue, required: true, id: `s-${x.skey}` });
      inputs[x.skey] = inp;
      return h('div', { class: 'field' }, h('label', { for: inp.id }, LABEL[x.skey][0]), inp, h('span', { class: 'hint' }, LABEL[x.skey][1]));
    }),
    h('button', { class: 'btn primary', type: 'submit' }, '저장'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value])) });
      toast('저장했습니다. 통계에 바로 반영됩니다');
      go('settings', {}, { replace: true });
    } catch (ex) { toast(ex.message); }
  });

  const logs = h('table', { class: 't' },
    h('thead', null, h('tr', null, h('th', null, '시각'), h('th', null, '누가'), h('th', null, '무엇을'), h('th', null, '대상'))),
    h('tbody', null, a.logs.map((l) => h('tr', null,
      h('td', { class: 'faint' }, l.created_at), h('td', null, l.name ? `${l.name}(${l.login_id})` : '–'),
      h('td', null, ACTION[l.action] || l.action), h('td', { class: 'faint', title: l.detail || '' }, l.target_id || '')))));

  view.replaceChildren(
    h('div', { class: 'head' }, h('h1', null, '설정')),
    h('div', { class: 'grid g-1-1', style: { alignItems: 'start' } },
      h('section', { class: 'panel' }, h('header', null, h('h2', null, '환산계수와 기준')), h('div', { class: 'body' }, form)),
      h('section', { class: 'panel' }, h('header', null, h('h2', null, '변경 이력'), h('p', null, '최근 300건')), h('div', { class: 'body tablewrap', style: { maxHeight: '70vh', overflowY: 'auto' } }, logs))));
}
