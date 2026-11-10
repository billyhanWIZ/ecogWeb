import { Router } from 'express';
import crypto from 'node:crypto';
import { wrap, httpError } from '../lib/http.js';
import { requireRole, hashPassword, checkPasswordRule, ROLES, ROLE_LABEL } from '../lib/auth.js';
import { loadOrgs, userScope, pathName } from '../lib/orgs.js';
import { audit } from '../lib/audit.js';
import { q, one, exec } from '../db.js';

const r = Router();
const admin = requireRole('SYSADMIN', 'CUSTADMIN');

/** 고객 관리자는 자기 조직 이하 사용자만, 시스템 관리자 역할은 줄 수 없다 */
function assertManageable(tree, me, target) {
  if (me.role === 'SYSADMIN') return;
  if (target.role === 'SYSADMIN') throw httpError(403, '권한이 없습니다');
  if (!userScope(tree, me).has(target.org_sn)) throw httpError(403, '권한이 없습니다');
}

function checkRoleOrg(tree, me, role, orgSn) {
  if (!ROLES.includes(role)) throw httpError(400, '역할을 선택하세요');
  if (role === 'SYSADMIN' && me.role !== 'SYSADMIN') throw httpError(403, '시스템 관리자는 시스템 관리자만 만들 수 있습니다');
  if (role !== 'SYSADMIN') {
    if (!tree.byId.has(Number(orgSn))) throw httpError(400, '조직을 선택하세요');
    if (me.role !== 'SYSADMIN' && !userScope(tree, me).has(Number(orgSn))) throw httpError(403, '그 조직에 사용자를 둘 수 없습니다');
  }
}

const tempPassword = () => crypto.randomBytes(6).toString('base64url');

r.get('/users', admin, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const rows = await q(`SELECT sn, login_id, name, role, org_sn, email, active, must_change_pw,
                               DATE_FORMAT(last_login_at,'%Y-%m-%d %H:%i') last_login_at, legacy_userinfo_sn
                        FROM eg_user ORDER BY active DESC, role, login_id`);
  const scope = userScope(tree, req.user);
  const visible = req.user.role === 'SYSADMIN' ? rows : rows.filter((u) => u.role !== 'SYSADMIN' && scope.has(u.org_sn));
  res.json({
    users: visible.map((u) => ({ ...u, roleLabel: ROLE_LABEL[u.role], orgPath: u.org_sn && tree.byId.has(u.org_sn) ? pathName(tree, u.org_sn) : null })),
    roles: (req.user.role === 'SYSADMIN' ? ROLES : ROLES.filter((x) => x !== 'SYSADMIN')).map((x) => ({ value: x, label: ROLE_LABEL[x] })),
  });
}));

r.post('/users', admin, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const { loginId, name, role, orgSn, email, password } = req.body || {};
  const id = String(loginId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(id)) throw httpError(400, '아이디는 영문·숫자 3자 이상으로 정하세요');
  if (!String(name || '').trim()) throw httpError(400, '이름을 입력하세요');
  checkRoleOrg(tree, req.user, role, orgSn);
  if (await one('SELECT sn FROM eg_user WHERE login_id = ?', [id])) throw httpError(400, '이미 있는 아이디입니다');
  if (password) checkPasswordRule(password);
  const pw = password || tempPassword();
  const out = await exec("INSERT INTO eg_user (login_id, name, password_hash, role, org_sn, email, must_change_pw) VALUES (?,?,?,?,?,?,'Y')",
    [id, String(name).trim(), await hashPassword(pw), role, role === 'SYSADMIN' ? null : Number(orgSn), email?.trim() || null]);
  await audit(req, 'user.create', 'user', out.insertId, { loginId: id, role, orgSn });
  res.json({ ok: true, sn: out.insertId, tempPassword: password ? null : pw });
}));

r.patch('/users/:sn', admin, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const target = await one('SELECT * FROM eg_user WHERE sn = ?', [req.params.sn]);
  if (!target) throw httpError(404, '사용자를 찾을 수 없습니다');
  assertManageable(tree, req.user, target);
  const b = req.body || {};
  const role = b.role ?? target.role;
  const orgSn = b.orgSn ?? target.org_sn;
  checkRoleOrg(tree, req.user, role, orgSn);
  if (Number(req.params.sn) === req.user.sn && (role !== target.role || b.active === 'N')) throw httpError(400, '자기 자신의 역할이나 사용 여부는 바꿀 수 없습니다');
  await exec('UPDATE eg_user SET name = ?, email = ?, role = ?, org_sn = ?, active = ? WHERE sn = ?', [
    String(b.name ?? target.name).trim(), (b.email ?? target.email)?.trim() || null, role,
    role === 'SYSADMIN' ? null : Number(orgSn), b.active === 'N' ? 'N' : b.active === 'Y' ? 'Y' : target.active, target.sn]);
  const nextActive = b.active === 'N' ? 'N' : b.active === 'Y' ? 'Y' : target.active;
  await audit(req, nextActive !== target.active ? (nextActive === 'N' ? 'user.deactivate' : 'user.activate') : 'user.update', 'user', target.sn, b);
  res.json({ ok: true });
}));

/** 여러 명 한꺼번에 미사용 / 다시 사용. 자기 자신과 권한 밖 사용자가 섞이면 전체를 거절 */
r.post('/users/active', admin, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const value = req.body?.active === 'Y' ? 'Y' : req.body?.active === 'N' ? 'N' : null;
  if (!value) throw httpError(400, '사용 여부를 정하세요');
  const sns = [...new Set((req.body?.sns || []).map(Number).filter(Number.isInteger))].slice(0, 500);
  if (!sns.length) throw httpError(400, '사용자를 고르세요');
  if (sns.includes(req.user.sn)) throw httpError(400, '자기 자신의 사용 여부는 바꿀 수 없습니다');
  const targets = await q('SELECT sn, login_id, role, org_sn, active FROM eg_user WHERE sn IN (?)', [sns]);
  if (!targets.length) throw httpError(404, '사용자를 찾을 수 없습니다');
  for (const t of targets) assertManageable(tree, req.user, t);
  const change = targets.filter((t) => t.active !== value);
  if (change.length) {
    await exec('UPDATE eg_user SET active = ? WHERE sn IN (?)', [value, change.map((t) => t.sn)]);
    await audit(req, value === 'N' ? 'user.deactivate' : 'user.activate', 'user', change.length === 1 ? change[0].sn : `${change.length}명`,
      { loginIds: change.map((t) => t.login_id) });
  }
  res.json({ ok: true, count: change.length });
}));

r.post('/users/:sn/reset-password', admin, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const target = await one('SELECT * FROM eg_user WHERE sn = ?', [req.params.sn]);
  if (!target) throw httpError(404, '사용자를 찾을 수 없습니다');
  assertManageable(tree, req.user, target);
  const pw = tempPassword();
  await exec("UPDATE eg_user SET password_hash = ?, must_change_pw = 'Y', fail_count = 0, locked_until = NULL WHERE sn = ?", [await hashPassword(pw), target.sn]);
  await audit(req, 'user.reset_password', 'user', target.sn);
  res.json({ ok: true, tempPassword: pw });
}));

export default r;
