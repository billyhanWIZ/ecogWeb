// 세척기 상세: 오른쪽 서랍
import { api, refreshBadge } from '../app.js';
import { h, fmt, drawer, chart, axisStyle, statusPill, modal, field, toast, today, shift } from '../ui.js';
import { pickOrg } from './org-picker.js';

/** 등록 코드 크게 보여 주기 (새 장비 추가 때도 씀) */
export function showCode(r, name) {
  modal('태블릿 등록 코드', [
    h('p', { style: { marginTop: 0 } }, `${name || r.deviceid} · ${r.deviceid}`),
    h('div', { style: { fontSize: '44px', fontWeight: 700, letterSpacing: '.18em', textAlign: 'center', padding: '10px 0' } }, `${r.code.slice(0, 4)} ${r.code.slice(4)}`),
    h('p', { class: 'muted' }, `${r.expires}까지 한 번 쓸 수 있습니다. 태블릿에서 https://ecog.jnwiz.com/t 를 열거나 eco.G 앱을 켜고 이 코드를 넣으세요.`),
  ], { submitLabel: '닫기', onSubmit: async () => {} });
}

export async function openDevice(deviceid, period, onChanged) {
  const dr = drawer('세척기', deviceid);
  let disposers = [];
  let from = period?.from && period.from !== period.to ? period.from : shift(today(), -29);
  let to = period?.to || today();

  async function load() {
    disposers.forEach((f) => f());
    disposers = [];
    dr.body.replaceChildren(h('div', { class: 'loading' }, '불러오는 중…'));
    const d = await api(`/api/devices/${encodeURIComponent(deviceid)}?from=${from}&to=${to}`);
    const dev = d.device;
    dr.setTitle(dev.name, dev.deviceid);

    const ranges = [['최근 30일', shift(today(), -29)], ['최근 90일', shift(today(), -89)], ['최근 1년', shift(today(), -364)]];
    const seg = h('div', { class: 'seg' }, ranges.map(([label, f]) => h('button', {
      type: 'button', 'aria-pressed': String(from === f && to === today()), onclick: () => { from = f; to = today(); load(); },
    }, label)));

    const info = h('section', { class: 'panel' }, h('div', { class: 'body', style: { paddingTop: '16px' } },
      h('dl', { class: 'kv' },
        h('dt', null, '상태'), h('dd', null, statusPill(dev.status, dev.ago), h('span', { class: 'faint' }, `  마지막 신호 ${dev.lastSignal || '–'}`)),
        h('dt', null, '설치처'), h('dd', null, dev.current ? dev.current.sitePath : h('span', { class: 'faint' }, '배정 안 됨')),
        h('dt', null, '설치일'), h('dd', null, dev.current ? fmt.date(dev.current.installed_on) : '–'),
        h('dt', null, '위치'), h('dd', null, dev.current?.location_note || '–'),
        h('dt', null, '장비 보고 이름'), h('dd', null, dev.deviceName || '–'),
        h('dt', null, '설치 후 누적'), h('dd', null, `${fmt.int(dev.totalUses)}회`)),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
        d.canEdit && dev.current ? h('button', { class: 'btn small', onclick: () => editInfo(dev) }, '이름·위치 수정') : null,
        d.canAssign ? h('button', { class: 'btn small primary', onclick: () => assign(dev) }, dev.current ? '설치처 변경(이설)' : '설치처 배정') : null,
        d.canAssign && dev.current ? h('button', { class: 'btn small danger', onclick: () => unassign(dev) }, '철거') : null,
        d.canAssign && !dev.current && !dev.hidden ? h('button', { class: 'btn small danger', onclick: () => hide(dev) }, '목록에서 숨기기') : null,
        d.canAssign && dev.hidden ? h('button', { class: 'btn small', onclick: () => unhide(dev) }, '다시 보이기') : null,
        d.canMarkTest ? h('button', { class: 'btn small', onclick: () => toggleTest(dev) }, dev.test ? '테스트 해제(운영 장비로)' : '테스트 장비로 지정') : null),
      dev.test ? h('p', { class: 'note', style: { marginBottom: 0 } }, `${dev.test.at}부터 테스트 장비입니다${dev.test.note ? ` (${dev.test.note})` : ''}. 대시보드·통계·리포트·사이니지 숫자에서 빠지고, '테스트 장비' 메뉴에서 따로 봅니다.`) : null,
      dev.hidden ? h('p', { class: 'note', style: { marginBottom: 0 } }, `${dev.hidden.at}에 숨긴 장비입니다${dev.hidden.reason ? ` (${dev.hidden.reason})` : ''}. 설치처에 배정하면 자동으로 다시 보입니다.`) : null));

    const tb = dev.tablet;
    const bleText = { connected: '세척기 연결됨', connecting: '세척기 연결 중', disconnected: '세척기 연결 끊김', off: '태블릿 블루투스 꺼짐' };
    const tabletPanel = tb || d.canAssign ? h('section', { class: 'panel' }, h('header', null, h('h2', null, '태블릿')),
      h('div', { class: 'body' },
        tb?.active ? h('dl', { class: 'kv' },
          h('dt', null, '세척기 연결'), h('dd', null, h('span', { class: `pill ${tb.ble === 'connected' ? 'on' : tb.ble ? 'off' : 'never'}` }, bleText[tb.ble] || '모름'),
            tb.bleChangedAt ? h('span', { class: 'faint' }, `  ${tb.bleChangedAt}부터`) : null),
          h('dt', null, '태블릿 신호'), h('dd', null, tb.lastSeen || '–'),
          h('dt', null, '등록일'), h('dd', null, tb.activatedAt || '–'),
          h('dt', null, '프로그램'), h('dd', null, tb.app || '–'))
          : h('p', { class: 'muted', style: { margin: 0 } }, '새 태블릿(웹·앱)이 아직 등록되지 않았습니다. 기존 유니티 태블릿은 여기 표시되지 않습니다.'),
        tb?.code ? h('div', { class: 'note', style: { marginTop: '12px' } }, '등록 코드 ', h('b', { style: { fontSize: '20px', letterSpacing: '.12em' } }, `${tb.code.slice(0, 4)} ${tb.code.slice(4)}`), `  (${tb.codeExpires}까지)`) : null,
        d.canAssign ? h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' } },
          h('button', { class: 'btn small primary', onclick: () => tabletCode(dev) }, tb?.code ? '등록 코드 다시 받기' : tb?.active ? '태블릿 바꾸기 (등록 코드 받기)' : '태블릿 등록 코드 받기'),
          h('span', { class: 'faint', style: { fontSize: '13px' } }, '태블릿에서 https://ecog.jnwiz.com/t 를 열거나 eco.G 앱을 켜고 코드를 넣으세요')) : null)) : null;

    const chartEl = h('div', { class: 'chart short' });
    const avgCmp = d.siteAvg ? h('p', { class: 'faint', style: { fontSize: '13px', margin: '6px 0 0' } },
      `이 장비 하루 평균 ${fmt.one(d.perDay)}회 · 같은 설치처 ${d.siteAvg.devices}대 평균 ${fmt.one(d.siteAvg.perDeviceDay)}회`) : null;
    const usage = h('section', { class: 'panel' },
      h('header', null, h('h2', null, `${fmt.int(d.uses)}회 사용`), seg),
      h('div', { class: 'body' }, h('p', { class: 'muted', style: { margin: '0 0 6px', fontSize: '13px' } },
        `${fmt.date(d.period.from)} ~ ${fmt.date(d.period.to)} · 탄소 ${fmt.co2(d.impact.co2Kg)} 저감`), chartEl, avgCmp));

    const wdEl = h('div', { class: 'chart short' });
    const wd = h('section', { class: 'panel' }, h('header', null, h('h2', null, '요일별 평균')), h('div', { class: 'body' }, wdEl));

    const hist = h('section', { class: 'panel' }, h('header', null, h('h2', null, '설치 이력')),
      h('div', { class: 'body tablewrap' }, d.history.length
        ? h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, '설치처'), h('th', null, '설치일'), h('th', null, '철거일'))),
          h('tbody', null, d.history.map((x) => h('tr', null, h('td', null, x.sitePath, x.location_note ? h('div', { class: 'faint' }, x.location_note) : null),
            h('td', null, fmt.date(x.installed_on)), h('td', null, x.removed_on ? fmt.date(x.removed_on) : h('span', { class: 'pill on' }, '현재'))))))
        : h('div', { class: 'empty' }, '아직 설치처에 배정한 적이 없습니다')));

    dr.body.replaceChildren(info, tabletPanel || '', usage, wd, hist);
    const c1 = await chart(chartEl, {
      grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: d.series.map((x) => `${Number(x.d.slice(5, 7))}/${Number(x.d.slice(8))}`), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle, minInterval: 1 },
      series: [{ type: 'bar', name: '사용 횟수', data: d.series.map((x) => x.uses), barMaxWidth: 14, itemStyle: { borderRadius: [2, 2, 0, 0] } }],
    });
    const c2 = await chart(wdEl, {
      grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: d.weekday.map((x) => x.day), ...axisStyle, splitLine: { show: false } },
      yAxis: { type: 'value', ...axisStyle },
      series: [{ type: 'bar', name: '평균 사용', data: d.weekday.map((x) => Math.round(x.avg * 10) / 10), barMaxWidth: 26, itemStyle: { color: '#2F8F5B', borderRadius: [2, 2, 0, 0] } }],
    });
    disposers.push(c1.dispose, c2.dispose);
  }

  const changed = async (msg) => { toast(msg); await load(); refreshBadge(); onChanged?.(); };

  function tabletCode(dev) {
    const run = async () => {
      const r = await api(`/api/devices/${encodeURIComponent(dev.deviceid)}/tablet-code`, { method: 'POST' });
      showCode(r, dev.name);
      await load();
    };
    if (dev.tablet?.active || dev.lastSignal) {
      modal('태블릿 바꾸기', [h('p', { style: { marginTop: 0 } },
        `새 태블릿이 이 장비 ID(${dev.deviceid})를 이어받습니다. 지금까지의 세척 기록은 그대로 이어서 쌓이고, 새 태블릿을 등록하면 이전 새 태블릿은 끊깁니다.`),
      h('p', { class: 'note' }, '기존 유니티 태블릿은 꼭 끄거나 앱을 지우세요. 두 대가 같은 ID 로 올리면 숫자가 섞입니다.')], {
        submitLabel: '등록 코드 받기', onSubmit: run,
      });
    } else run().catch((e) => toast(e.message));
  }

  function editInfo(dev) {
    const name = h('input', { value: dev.current.display_name || dev.name, maxlength: 100 });
    const loc = h('input', { value: dev.current.location_note || '', maxlength: 200, placeholder: '예: 3층 탕비실' });
    const memo = h('textarea', { rows: 3, maxlength: 500 }, dev.current.memo || '');
    modal('이름·위치 수정', [field('장비 이름', name), field('위치', loc), field('메모', memo)], {
      onSubmit: async () => {
        await api(`/api/devices/${encodeURIComponent(dev.deviceid)}`, { method: 'PATCH', body: { displayName: name.value, locationNote: loc.value, memo: memo.value } });
        await changed('저장했습니다');
      },
    });
  }

  function assign(dev) {
    let siteSn = null;
    const siteBtn = h('button', { class: 'btn', type: 'button', style: { width: '100%', justifyContent: 'flex-start' } }, '설치처 고르기');
    siteBtn.addEventListener('click', () => pickOrg((o) => { siteSn = o.sn; siteBtn.textContent = o.path; }, { selectedSn: siteSn || dev.current?.site_sn }));
    const date = h('input', { type: 'date', value: today(), max: today() });
    const name = h('input', { value: dev.current?.display_name || dev.deviceName || '', maxlength: 100 });
    const loc = h('input', { maxlength: 200, placeholder: '예: 3층 탕비실' });
    modal(dev.current ? '설치처 변경(이설)' : '설치처 배정', [
      dev.current ? h('p', { class: 'note' }, `지금 설치처(${dev.current.sitePath})의 기록은 그대로 남고, 설치일부터 새 설치처로 집계됩니다.`) : null,
      h('div', { class: 'field' }, h('label', null, '설치처'), siteBtn),
      field('설치일', date, '이 날부터 새 설치처로 집계합니다'),
      field('장비 이름', name),
      field('위치', loc),
    ], {
      submitLabel: dev.current ? '이설' : '배정',
      onSubmit: async () => {
        if (!siteSn) throw new Error('설치처를 고르세요');
        await api(`/api/devices/${encodeURIComponent(dev.deviceid)}/assign`, { method: 'POST', body: { siteSn, installedOn: date.value, displayName: name.value, locationNote: loc.value } });
        await changed(dev.current ? '이설했습니다' : '배정했습니다');
      },
    });
  }

  function unassign(dev) {
    const date = h('input', { type: 'date', value: today(), max: today() });
    modal('철거', [h('p', null, `${dev.name}을(를) ${dev.current.sitePath}에서 철거합니다. 지금까지의 사용 기록은 그대로 남습니다.`), field('철거일', date)], {
      submitLabel: '철거', danger: true,
      onSubmit: async () => {
        await api(`/api/devices/${encodeURIComponent(dev.deviceid)}/unassign`, { method: 'POST', body: { removedOn: date.value } });
        await changed('철거했습니다');
      },
    });
  }

  function hide(dev) {
    const reason = h('input', { maxlength: 200, placeholder: '예: 시험용 장비, 폐기' });
    modal('목록에서 숨기기', [h('p', { style: { marginTop: 0 } }, `${dev.name}을(를) 장비 목록에서 뺍니다. 세척 기록과 장비 등록 정보는 그대로 남고, 숨김 탭에서 되살릴 수 있습니다.`), field('사유', reason)], {
      submitLabel: '숨기기', danger: true,
      onSubmit: async () => {
        await api('/api/devices/hide', { method: 'POST', body: { deviceids: [dev.deviceid], reason: reason.value } });
        await changed('숨겼습니다');
      },
    });
  }

  function toggleTest(dev) {
    if (dev.test) {
      api('/api/devices/test', { method: 'POST', body: { deviceids: [dev.deviceid], test: false } })
        .then(() => changed('운영 장비로 돌렸습니다')).catch((e) => toast(e.message));
      return;
    }
    const note = h('input', { maxlength: 200, placeholder: '예: 사무실 시연용, 출고 전 점검' });
    modal('테스트 장비로 지정', [h('p', { style: { marginTop: 0 } }, `${dev.name}을(를) 테스트 장비로 지정합니다. 대시보드·통계·리포트·사이니지 숫자에서 빠지고(과거 기록 포함), '테스트 장비' 메뉴에서만 보입니다. 언제든 해제할 수 있습니다.`), field('메모', note)], {
      submitLabel: '지정',
      onSubmit: async () => {
        await api('/api/devices/test', { method: 'POST', body: { deviceids: [dev.deviceid], test: true, note: note.value } });
        await changed('테스트 장비로 지정했습니다');
      },
    });
  }

  async function unhide(dev) {
    try {
      await api('/api/devices/unhide', { method: 'POST', body: { deviceids: [dev.deviceid] } });
      await changed('다시 보이게 했습니다');
    } catch (e) { toast(e.message); }
  }

  try { await load(); } catch (e) { dr.body.replaceChildren(h('div', { class: 'err' }, e.message)); }
}
