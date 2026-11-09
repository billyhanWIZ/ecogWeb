import { api, go } from '../app.js';
import { h, fmt, modal, field, toast } from '../ui.js';
import { loadOrgTree, invalidateOrgTree, pickOrg, flatten, orgTree } from './org-picker.js';

const TYPE = { HQ: '본사', BRANCH: '지역·지사', SITE: '설치처' };

export default async function orgs(view, { params }) {
  const data = await loadOrgTree(true);
  const all = flatten(data.roots);
  const selected = all.find((x) => x.sn === Number(params.sn)) || all[0];
  const reload = (sn) => { invalidateOrgTree(); go('orgs', { sn }, { replace: true }); };

  const tree = orgTree(data.roots, { selectedSn: selected?.sn, onSelect: (o) => go('orgs', { sn: o.sn }), showType: true });

  const left = h('section', { class: 'panel' },
    h('header', null, h('h2', null, '조직'), data.canEdit && selected ? h('button', { class: 'btn small primary', onclick: () => addChild(selected.org) }, '하위 조직 추가') : null),
    h('div', { class: 'body' }, all.length ? tree : h('div', { class: 'empty' }, '조직이 없습니다')));

  const right = selected ? detail(selected.org) : h('div');
  view.replaceChildren(
    h('div', { class: 'head' }, h('div', null, h('h1', null, '조직'),
      h('p', { class: 'faint', style: { margin: '2px 0 0', fontSize: '13px' } }, '본사 → 지역 → 설치처 순으로 묶습니다. +/− 로 펼치고 접을 수 있고, 장비는 설치처에 배정합니다.'))),
    h('div', { class: 'grid g-tree', style: { gridTemplateColumns: 'minmax(280px, 1fr) 1.4fr', alignItems: 'start' } }, left, right));

  function detail(o) {
    const editable = data.canEdit;
    const name = h('input', { value: o.name, required: true, disabled: !editable });
    const type = h('select', { disabled: !editable }, Object.entries(TYPE).map(([k, v]) => h('option', { value: k, selected: o.org_type === k }, v)));
    const sido = h('select', { disabled: !editable },
      h('option', { value: '' }, o.sidoInherited && !o.sido ? `상위 조직 따름 (${o.sidoInherited})` : '지정 안 함'),
      data.sidoList.map((s) => h('option', { value: s, selected: o.sido === s }, s)));
    const sigungu = h('input', { value: o.sigungu || '', placeholder: o.sigunguInherited && !o.sigungu ? `상위 조직 따름 (${o.sigunguInherited})` : '예: 창원시', disabled: !editable });
    const address = h('input', { value: o.address || '', disabled: !editable });
    const wxInit = o.weatherSet || '';
    const wx = h('input', { value: wxInit, placeholder: o.weatherAuto ? `비우면 ${o.weatherAuto} (시군구·시도 기준)` : '예: 진주시, 서울 강남구, 35.18, 128.10', disabled: !editable });
    const mgr = h('input', { value: o.manager_name || '', disabled: !editable });
    const phone = h('input', { value: o.manager_phone || '', disabled: !editable });

    const save = async (e) => {
      e.preventDefault();
      await api(`/api/orgs/${o.sn}`, { method: 'PATCH', body: { name: name.value, orgType: type.value, sido: sido.value, sigungu: sigungu.value, address: address.value, managerName: mgr.value, managerPhone: phone.value, ...(wx.value.trim() !== wxInit ? { weatherPlace: wx.value } : {}) } });
      toast('저장했습니다');
      reload(o.sn);
    };
    const err = h('p', { class: 'err hidden' });
    const form = h('form', { onsubmit: (e) => save(e).catch((ex) => { err.textContent = ex.message; err.classList.remove('hidden'); }) },
      h('div', { class: 'row' }, field('이름', name), field('유형', type)),
      h('div', { class: 'row' }, field('시도', sido, '지역 통계와 지도에 쓰입니다'), field('시군구', sigungu)),
      field('주소', address),
      field('날씨 위치', wx, '대시보드·TV 화면 시계 옆 날씨. 시군구 이름이나 위도, 경도를 넣으세요. 비우면 시군구(없으면 시도) 중심'),
      h('div', { class: 'row' }, field('담당자', mgr), field('연락처', phone)),
      err,
      editable ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', type: 'submit' }, '저장'),
        h('button', { class: 'btn', type: 'button', onclick: () => move(o) }, '다른 조직 아래로 옮기기'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => remove(o) }, '삭제')) : null);

    // 로고
    const file = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.svg,.webp', class: 'hidden' });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      const fd = new FormData();
      fd.append('logo', file.files[0]);
      try {
        await api(`/api/orgs/${o.sn}/logo`, { method: 'POST', body: fd });
        toast('로고를 바꿨습니다');
        reload(o.sn);
      } catch (ex) { toast(ex.message); }
    });
    const logo = h('section', { class: 'panel' },
      h('header', null, h('h2', null, '로고'), h('p', null, '비워 두면 상위 조직 로고를 씁니다. 화면 왼쪽 위와 PDF 표지에 들어갑니다.')),
      h('div', { class: 'body', style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' } },
        h('img', { src: o.logoUrl || '/img/ecog-logo.png', alt: `${o.name} 로고`, style: { height: '44px', maxWidth: '200px', objectFit: 'contain', border: '1px solid var(--line)', borderRadius: '6px', padding: '4px 8px', background: '#fff' } }),
        editable ? h('button', { class: 'btn small', type: 'button', onclick: () => file.click() }, '로고 올리기') : null,
        editable && o.logo_path ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api(`/api/orgs/${o.sn}/logo`, { method: 'DELETE' }); reload(o.sn); } }, '이 조직 로고 지우기') : null,
        h('span', { class: 'faint', style: { fontSize: '12.5px' } }, 'PNG·JPG·SVG, 1MB 이하'), file));

    // 태블릿 배경 사진
    const bgFile = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp', class: 'hidden' });
    bgFile.addEventListener('change', async () => {
      if (!bgFile.files[0]) return;
      const fd = new FormData();
      fd.append('background', bgFile.files[0]);
      try {
        await api(`/api/orgs/${o.sn}/background`, { method: 'POST', body: fd });
        toast('태블릿 배경을 바꿨습니다. 태블릿에는 5분 안에 반영됩니다');
        reload(o.sn);
      } catch (ex) { toast(ex.message); }
    });
    const bg = h('section', { class: 'panel' },
      h('header', null, h('h2', null, '태블릿 배경'), h('p', null, '세척기 태블릿 평소 화면의 배경 사진입니다. 비워 두면 상위 조직 사진을, 아무도 없으면 기본 숲 사진을 씁니다.')),
      h('div', { class: 'body', style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' } },
        h('img', { src: o.bgUrl || '/tablet/forest.jpg', alt: `${o.name} 태블릿 배경`, style: { width: '192px', height: '120px', objectFit: 'cover', border: '1px solid var(--line)', borderRadius: '6px' } }),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('span', { class: 'faint', style: { fontSize: '12.5px' } },
            o.bg_path ? '이 조직의 사진' : o.bgInherited ? '상위 조직 사진을 쓰는 중' : '기본 숲 사진을 쓰는 중'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            editable ? h('button', { class: 'btn small', type: 'button', onclick: () => bgFile.click() }, '배경 사진 올리기') : null,
            editable && o.bg_path ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api(`/api/orgs/${o.sn}/background`, { method: 'DELETE' }); reload(o.sn); } }, '이 조직 배경 지우기') : null),
          h('span', { class: 'faint', style: { fontSize: '12.5px' } }, 'JPG·PNG·WEBP, 5MB 이하. 가로 사진(1920×1200 정도)이 좋고, 왼쪽에 글자가 얹히니 어둡거나 단순한 사진이 잘 보입니다')),
        bgFile));

    const devs = h('section', { class: 'panel' },
      h('header', null, h('h2', null, `장비 ${fmt.int(o.devicesTotal)}대`), h('a', { href: `#/stats?by=${o.children.length ? 'org' : 'device'}&${o.children.length ? 'org' : 'site'}=${o.sn}` }, '이 조직 통계 보기')),
      h('div', { class: 'body' }, h('p', { class: 'muted', style: { margin: 0, fontSize: '14px' } },
        o.devices ? `이 조직에 바로 배정된 장비 ${o.devices}대, 하위 조직 포함 ${o.devicesTotal}대입니다.` : `하위 조직 포함 ${o.devicesTotal}대입니다. 장비 배정은 장비 화면에서 합니다.`)));

    // 사이니지 (로비 TV·QR 용 로그인 없는 화면)
    const url = o.signage_token ? `${location.origin}/s/${o.signage_token}` : null;
    const issue = async () => {
      try { await api(`/api/orgs/${o.sn}/signage`, { method: 'POST' }); toast(url ? '새 링크를 만들었습니다. 이전 링크는 더 이상 열리지 않습니다' : '사이니지 링크를 만들었습니다'); reload(o.sn); } catch (ex) { toast(ex.message); }
    };
    const revoke = async () => {
      try { await api(`/api/orgs/${o.sn}/signage`, { method: 'DELETE' }); toast('사이니지 링크를 껐습니다'); reload(o.sn); } catch (ex) { toast(ex.message); }
    };
    const signage = h('section', { class: 'panel' },
      h('header', null, h('h2', null, '사이니지 화면'), h('p', null, '로비 TV나 QR로 여는 화면입니다. 로그인 없이 이 조직의 합계 숫자만 보입니다.')),
      h('div', { class: 'body' }, url
        ? [h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { class: 'input', value: url, readonly: true, style: { flex: '1 1 260px' }, onfocus: (e) => e.target.select() }),
          h('button', { class: 'btn small', type: 'button', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('링크를 복사했습니다')) }, '복사'),
          h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, '열기')),
        editable ? h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          h('button', { class: 'btn small', type: 'button', onclick: issue }, '새 링크로 바꾸기'),
          h('button', { class: 'btn small danger', type: 'button', onclick: revoke }, '끄기')) : null]
        : editable ? h('button', { class: 'btn small primary', type: 'button', onclick: issue }, '사이니지 링크 만들기') : h('p', { class: 'muted' }, '아직 링크가 없습니다')));

    return h('div', { class: 'grid' },
      h('section', { class: 'panel' }, h('header', null, h('h2', null, selected.path)), h('div', { class: 'body' }, form)),
      logo, bg, devs, signage);
  }

  function addChild(parent) {
    const name = h('input', { required: true, maxlength: 100 });
    const type = h('select', null, Object.entries(TYPE).map(([k, v]) => h('option', { value: k, selected: k === (parent.org_type === 'HQ' ? 'BRANCH' : 'SITE') }, v)));
    const sido = h('select', null, h('option', { value: '' }, parent.sidoInherited ? `상위 조직 따름 (${parent.sidoInherited})` : '지정 안 함'), data.sidoList.map((s) => h('option', { value: s }, s)));
    modal(`${parent.name} 아래에 추가`, [field('이름', name), field('유형', type), field('시도', sido)], {
      submitLabel: '추가',
      onSubmit: async () => {
        const r = await api('/api/orgs', { method: 'POST', body: { parentSn: parent.sn, name: name.value, orgType: type.value, sido: sido.value } });
        toast('추가했습니다');
        reload(r.sn);
      },
    });
  }

  function move(o) {
    const excl = flatten([o]).map((x) => x.sn);
    pickOrg(async (target) => {
      try {
        await api(`/api/orgs/${o.sn}`, { method: 'PATCH', body: { parentSn: target.sn } });
        toast(`${target.name} 아래로 옮겼습니다`);
        reload(o.sn);
      } catch (ex) { toast(ex.message); }
    }, { exclude: excl, title: `${o.name}을(를) 어디로 옮길까요` });
  }

  function remove(o) {
    modal('조직 삭제', h('p', null, `${o.name}을(를) 삭제합니다. 하위 조직·배정 장비·사용자가 없어야 삭제할 수 있습니다. 과거 통계는 남습니다.`), {
      submitLabel: '삭제', danger: true,
      onSubmit: async () => {
        await api(`/api/orgs/${o.sn}`, { method: 'DELETE' });
        toast('삭제했습니다');
        reload(o.parent_sn || '');
      },
    });
  }
}
