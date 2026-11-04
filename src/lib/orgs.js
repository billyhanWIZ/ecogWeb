// 조직 트리는 수백 건 이하라 메모리에 올려 두고 범위·상속 계산을 JS 로 한다.
import { q } from '../db.js';

let cache = null;

export function invalidateOrgs() {
  cache = null;
}

export async function loadOrgs() {
  if (cache) return cache;
  const rows = await q("SELECT * FROM eg_org WHERE use_yn = 'Y' ORDER BY sort_order, name");
  const byId = new Map(rows.map((r) => [r.sn, { ...r, children: [] }]));
  const roots = [];
  for (const o of byId.values()) {
    const p = o.parent_sn != null ? byId.get(o.parent_sn) : null;
    if (p) p.children.push(o);
    else roots.push(o);
  }
  cache = { byId, roots };
  return cache;
}

/** 조직 sn 과 그 하위 전체 sn 배열 */
export function descendants(tree, sn) {
  const start = tree.byId.get(Number(sn));
  if (!start) return [];
  const out = [];
  const stack = [start];
  while (stack.length) {
    const o = stack.pop();
    out.push(o.sn);
    stack.push(...o.children);
  }
  return out;
}

/** 최상위부터 자신까지 */
export function ancestors(tree, sn) {
  const out = [];
  let o = tree.byId.get(Number(sn));
  const seen = new Set();
  while (o && !seen.has(o.sn)) {
    seen.add(o.sn);
    out.unshift(o);
    o = o.parent_sn != null ? tree.byId.get(o.parent_sn) : null;
  }
  return out;
}

/** 자신 → 상위로 올라가며 처음 값이 있는 속성 (sido, sigungu, logo_path) */
export function inherited(tree, sn, key) {
  const chain = ancestors(tree, sn);
  for (let i = chain.length - 1; i >= 0; i--) if (chain[i][key]) return chain[i][key];
  return null;
}

/** '경상남도 › 창원시청' 같은 경로 이름. fromSn 아래만 */
export function pathName(tree, sn, fromSn = null) {
  const chain = ancestors(tree, sn);
  const i = fromSn != null ? chain.findIndex((o) => o.sn === Number(fromSn)) : -1;
  const parts = chain.slice(i + 1).map((o) => o.name);
  return parts.length ? parts.join(' › ') : chain.at(-1)?.name ?? '';
}

/** 사용자가 볼 수 있는 최상위 조직 sn 목록 */
export function userRoots(tree, user) {
  if (user.role === 'SYSADMIN' || !user.org_sn) return tree.roots.map((r) => r.sn);
  return tree.byId.has(user.org_sn) ? [user.org_sn] : [];
}

/** 사용자가 볼 수 있는 조직 sn 전체 */
export function userScope(tree, user) {
  const set = new Set();
  for (const r of userRoots(tree, user)) for (const s of descendants(tree, r)) set.add(s);
  return set;
}

/** 요청한 조직이 사용자 범위 안인지 확인하고 그 하위 sn 목록을 돌려준다 */
export function scopedSubtree(tree, user, orgSn) {
  const scope = userScope(tree, user);
  if (orgSn == null || orgSn === '') return [...scope];
  const n = Number(orgSn);
  if (!scope.has(n)) throw Object.assign(new Error('볼 수 없는 조직입니다'), { status: 403 });
  return descendants(tree, n);
}

export function toPublic(o) {
  if (!o) return null;
  const { children, ...rest } = o;
  return rest;
}

/** 테스트 장비를 보고 지정할 수 있는 사람: 시스템 관리자, 최상위(본사) 조직의 고객 관리자 */
export function canSeeTest(tree, user) {
  if (user?.role === 'SYSADMIN') return true;
  return user?.role === 'CUSTADMIN' && tree.roots.some((r) => r.sn === user.org_sn);
}
