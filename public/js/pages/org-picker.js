// 조직 트리 (+/- 로 펼치고 접기) 와 조직 고르기 모달
import { api } from '../app.js';
import { h, modal } from '../ui.js';

let cache = null;
export async function loadOrgTree(force = false) {
  if (!cache || force) cache = await api('/api/orgs');
  return cache;
}
export function invalidateOrgTree() { cache = null; }

/** 트리를 [{sn, name, path, depth, org}] 평면 목록으로 */
export function flatten(roots) {
  const out = [];
  const walk = (o, depth, parents) => {
    const path = [...parents, o.name];
    out.push({ sn: o.sn, name: o.name, path: path.join(' › '), depth, org: o });
    o.children.forEach((c) => walk(c, depth + 1, path));
  };
  roots.forEach((r) => walk(r, 0, []));
  return out;
}

/** sn 까지 가는 조상 sn 목록 */
function ancestorsOf(roots, sn) {
  const path = [];
  const walk = (o, trail) => {
    if (o.sn === sn) { path.push(...trail); return true; }
    return o.children.some((c) => walk(c, [...trail, o.sn]));
  };
  roots.some((r) => walk(r, []));
  return path;
}

const openState = new Set(); // 화면을 옮겨 다녀도 펼친 상태 유지
const TYPE = { HQ: '본사', BRANCH: '지역', SITE: '설치처' };

/**
 * 윈도우 탐색기처럼 +/- 로 펼치는 트리
 * opts: selectedSn, onSelect(o), exclude[], count(o) → 오른쪽 숫자, showType
 */
export function orgTree(roots, { selectedSn = null, onSelect, exclude = [], count = (o) => (o.devicesTotal ? `${o.devicesTotal}대` : ''), showType = false } = {}) {
  roots.forEach((r) => openState.add(r.sn));
  ancestorsOf(roots, selectedSn).forEach((sn) => openState.add(sn));
  const ex = new Set(exclude);

  const ul = h('ul', { class: 'tree', role: 'tree' });
  const node = (o, depth) => {
    if (ex.has(o.sn)) return null;
    const kids = o.children.filter((c) => !ex.has(c.sn));
    const isOpen = openState.has(o.sn);
    const toggle = kids.length
      ? h('button', {
        type: 'button', class: 'tw', 'aria-label': `${o.name} ${isOpen ? '접기' : '펼치기'}`,
        onclick: (e) => { e.stopPropagation(); if (openState.has(o.sn)) openState.delete(o.sn); else openState.add(o.sn); redraw(); },
      }, isOpen ? '−' : '+')
      : h('span', { class: 'tw empty', 'aria-hidden': 'true' });
    const row = h('div', {
      class: 'node', tabindex: '0', role: 'treeitem',
      'aria-selected': String(o.sn === selectedSn), 'aria-expanded': kids.length ? String(isOpen) : null,
      style: { paddingLeft: `${4 + depth * 18}px` },
      onclick: () => onSelect?.(o),
      onkeydown: (e) => {
        if (e.key === 'Enter') onSelect?.(o);
        if (e.key === 'ArrowRight' && kids.length && !openState.has(o.sn)) { openState.add(o.sn); redraw(o.sn); }
        if (e.key === 'ArrowLeft' && openState.has(o.sn)) { openState.delete(o.sn); redraw(o.sn); }
      },
      'data-sn': o.sn,
    }, toggle, showType ? h('span', { class: 'type' }, TYPE[o.org_type] || o.org_type) : null, h('span', { class: 'nm' }, o.name), h('span', { class: 'cnt' }, count(o)));
    return h('li', null, row, kids.length && isOpen ? h('ul', { role: 'group' }, kids.map((c) => node(c, depth + 1))) : null);
  };
  function redraw(focusSn) {
    ul.replaceChildren(...roots.map((r) => node(r, 0)).filter(Boolean));
    if (focusSn) ul.querySelector(`[data-sn="${focusSn}"]`)?.focus();
  }
  const bar = h('div', { class: 'tree-tools' },
    h('button', { type: 'button', class: 'btn small', onclick: () => { flatten(roots).forEach((x) => { if (x.org.children.length) openState.add(x.sn); }); redraw(); } }, '모두 펼치기'),
    h('button', { type: 'button', class: 'btn small', onclick: () => { openState.clear(); roots.forEach((r) => openState.add(r.sn)); redraw(); } }, '모두 접기'));
  redraw();
  return h('div', null, bar, ul);
}

export async function pickOrg(onPick, { exclude = [], title = '설치처 고르기', selectedSn = null } = {}) {
  const { roots } = await loadOrgTree();
  const all = flatten(roots).filter((x) => !exclude.includes(x.sn));
  const pathOf = new Map(all.map((x) => [x.sn, x.path]));
  const input = h('input', { class: 'input', placeholder: '이름으로 찾기', 'aria-label': '조직 검색' });
  const box = h('div', { style: { maxHeight: '55vh', overflowY: 'auto', marginTop: '10px' } });
  const m = modal(title, [input, box]);
  const choose = (o) => { onPick({ sn: o.sn, name: o.name, path: pathOf.get(o.sn) || o.name, org: o }); m.close(); };
  const draw = () => {
    const kw = input.value.trim();
    if (!kw) {
      box.replaceChildren(orgTree(roots, { selectedSn, onSelect: choose, exclude, count: (o) => (o.devices ? `${o.devices}대` : '') }));
      return;
    }
    const items = all.filter((x) => x.path.includes(kw));
    box.replaceChildren(items.length
      ? h('ul', { class: 'tree' }, items.map((x) => h('li', null, h('div', {
        class: 'node', tabindex: '0', role: 'button',
        onclick: () => choose(x.org), onkeydown: (e) => { if (e.key === 'Enter') choose(x.org); },
      }, h('span', { class: 'nm' }, x.path), h('span', { class: 'cnt' }, x.org.devices ? `${x.org.devices}대` : '')))))
      : h('p', { class: 'empty' }, '찾는 조직이 없습니다. 조직 화면에서 먼저 만드세요.'));
  };
  input.addEventListener('input', draw);
  draw();
}
