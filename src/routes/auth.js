import { Router } from 'express';
import { wrap, httpError } from '../lib/http.js';
import { login, requireAuth, hashPassword, checkPasswordRule, ROLE_LABEL } from '../lib/auth.js';
import { one, exec } from '../db.js';
import { loadOrgs, userRoots, inherited, canSeeTest } from '../lib/orgs.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import bcrypt from 'bcryptjs';

const r = Router();

r.post('/auth/login', wrap(async (req, res) => {
  const { loginId, password } = req.body || {};
  if (!loginId || !password) throw httpError(400, '아이디와 비밀번호를 입력하세요');
  const u = await login(String(loginId).trim(), String(password));
  req.session = { uid: u.sn };
  req.user = u;
  await audit(req, 'login', 'user', u.sn);
  res.json({ ok: true, mustChangePassword: u.must_change_pw === 'Y' });
}));

r.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

r.get('/me', requireAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const s = await getSettings();
  const roots = userRoots(tree, req.user);
  const home = roots.length === 1 ? tree.byId.get(roots[0]) : null;
  res.json({
    user: {
      sn: req.user.sn,
      loginId: req.user.login_id,
      name: req.user.name,
      role: req.user.role,
      roleLabel: ROLE_LABEL[req.user.role],
      email: req.user.email,
      mustChangePassword: req.user.must_change_pw === 'Y',
      canSeeTest: canSeeTest(tree, req.user),
    },
    org: home ? { sn: home.sn, name: home.name } : null,
    logo: home && inherited(tree, home.sn, 'logo_path') ? `/api/orgs/${home.sn}/logo` : '/img/ecog-logo-white.png',
    logoCustom: !!(home && inherited(tree, home.sn, 'logo_path')),
    settings: { co2PerUseG: s.co2_per_use_g, co2PerTreeKg: s.co2_per_tree_kg, offlineSeconds: s.offline_seconds },
  });
}));

r.post('/me/password', requireAuth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  checkPasswordRule(next);
  const u = await one('SELECT password_hash FROM eg_user WHERE sn = ?', [req.user.sn]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw httpError(400, '현재 비밀번호가 맞지 않습니다');
  await exec("UPDATE eg_user SET password_hash = ?, must_change_pw = 'N' WHERE sn = ?", [await hashPassword(next), req.user.sn]);
  await audit(req, 'password.change', 'user', req.user.sn);
  res.json({ ok: true });
}));

export default r;
