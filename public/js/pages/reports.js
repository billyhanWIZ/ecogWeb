import { h } from '../ui.js';

export default async function reports(view) {
  view.replaceChildren(
    h('div', { class: 'head' }, h('h1', null, '리포트')),
    h('section', { class: 'panel' }, h('div', { class: 'body', style: { paddingTop: '18px' } },
      h('p', { style: { marginTop: 0 } }, 'PDF 리포트는 3단계에서 엽니다. 대상(조직·지역·설치처)과 기간을 고르면 표지에 고객 로고가 들어간 ESG 리포트를 내려받을 수 있게 됩니다.'),
      h('p', { class: 'muted', style: { marginBottom: 0 } }, '그동안은 통계 화면의 ‘엑셀로 받기’로 같은 숫자를 받을 수 있습니다.'),
      h('p', null, h('a', { href: '#/stats' }, '통계 화면으로 가기')))));
}
