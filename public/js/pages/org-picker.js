// 조직 고르기 모달 (검색 + 트리)
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

export async function pickOrg(onPick, { exclude = [], title = '설치처 고르기' } = {}) {
  const { roots } = await loadOrgTree();
  const all = flatten(roots).filter((x) => !exclude.includes(x.sn));
  const input = h('input', { class: 'input', placeholder: '이름으로 찾기', 'aria-label': '조직 검색' });
  const list = h('ul', { class: 'tree', style: { maxHeight: '50vh', overflowY: 'auto', marginTop: '10px' } });
  const m = modal(title, [input, list]);
  const draw = () => {
    const kw = input.value.trim();
    const items = kw ? all.filter((x) => x.path.includes(kw)) : all;
    list.replaceChildren(...items.map((x) => h('li', null, h('div', {
      class: 'node', tabindex: '0', role: 'button',
      style: { paddingLeft: `${8 + (kw ? 0 : x.depth * 16)}px` },
      onclick: () => { onPick(x); m.close(); },
      onkeydown: (e) => { if (e.key === 'Enter') { onPick(x); m.close(); } },
    }, kw ? x.path : x.name, h('span', { class: 'cnt' }, x.org.devices ? `${x.org.devices}대` : '')))));
    if (!items.length) list.append(h('li', { class: 'empty' }, '찾는 조직이 없습니다. 조직 화면에서 먼저 만드세요.'));
  };
  input.addEventListener('input', draw);
  draw();
}
