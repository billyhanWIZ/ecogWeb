// 세척기 상세: 오른쪽 서랍
import { api, refreshBadge } from '../app.js';
import { h, fmt, drawer, chart, axisStyle, statusPill, modal, field, toast, today, shift } from '../ui.js';
import { pickOrg } from './org-picker.js';

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
        d.canAssign && dev.current ? h('button', { class: 'btn small danger', onclick: () => unassign(dev) }, '철거') : null)));

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

    dr.body.replaceChildren(info, usage, wd, hist);
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
    siteBtn.addEventListener('click', () => pickOrg((o) => { siteSn = o.sn; siteBtn.textContent = o.path; }));
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

  try { await load(); } catch (e) { dr.body.replaceChildren(h('div', { class: 'err' }, e.message)); }
}
