import { h, modal, field, toast } from './ui.js';
import { api } from './app.js';

export function openPasswordModal(forced) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
  const again = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  modal(forced ? '비밀번호를 바꿔 주세요' : '비밀번호 변경', [
    forced ? h('p', { class: 'note' }, '임시 비밀번호로 로그인했습니다. 계속 쓰려면 새 비밀번호를 정하세요.') : null,
    field('현재 비밀번호', cur),
    field('새 비밀번호', nxt, '8자 이상'),
    field('새 비밀번호 확인', again),
  ], {
    submitLabel: '비밀번호 변경',
    onSubmit: async () => {
      if (nxt.value !== again.value) throw new Error('새 비밀번호가 서로 다릅니다');
      await api('/api/me/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
      toast('비밀번호를 변경했습니다');
    },
  });
}
