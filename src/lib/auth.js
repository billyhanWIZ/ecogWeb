import bcrypt from 'bcryptjs';
import { one, exec } from '../db.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 10;
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

export const ROLES = ['SYSADMIN', 'CUSTADMIN', 'VIEWER'];
export const ROLE_LABEL = { SYSADMIN: '시스템 관리자', CUSTADMIN: '고객 관리자', VIEWER: '조회자' };

export async function login(loginId, password) {
  const u = await one("SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM eg_user WHERE login_id = ? AND active = 'Y'", [loginId]);
  const fail = () => Object.assign(new Error('아이디 또는 비밀번호가 맞지 않습니다'), { status: 401 });
  if (!u) {
    await bcrypt.compare(String(password), DUMMY_HASH); // 없는 아이디도 같은 시간이 걸리게
    throw fail();
  }
  if (Number(u.is_locked)) {
    throw Object.assign(new Error(`로그인을 ${LOCK_AFTER}회 실패해 잠시 잠겼습니다. ${LOCK_MINUTES}분 뒤 다시 시도하세요`), { status: 423 });
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const n = u.fail_count + 1;
    await exec(
      `UPDATE eg_user SET fail_count = ?, locked_until = IF(? >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL) WHERE sn = ?`,
      [n >= LOCK_AFTER ? 0 : n, n, LOCK_AFTER, LOCK_MINUTES, u.sn]);
    throw fail();
  }
  await exec('UPDATE eg_user SET fail_count = 0, locked_until = NULL, last_login_at = NOW() WHERE sn = ?', [u.sn]);
  return u;
}

export function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

export function checkPasswordRule(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    throw Object.assign(new Error('비밀번호는 8자 이상으로 정하세요'), { status: 400 });
  }
}

/** 세션 → req.user. 매 요청 DB 에서 다시 읽어 비활성·권한 변경을 바로 반영한다 */
export async function loadUser(req, _res, next) {
  try {
    const sn = req.session?.uid;
    if (sn) {
      const u = await one(
        "SELECT sn, login_id, name, role, org_sn, email, must_change_pw FROM eg_user WHERE sn = ? AND active = 'Y'", [sn]);
      if (u) req.user = u;
      else req.session = null;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '권한이 없습니다' });
    next();
  };
}

export const isAdmin = (u) => u?.role === 'SYSADMIN' || u?.role === 'CUSTADMIN';
