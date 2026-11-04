import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { wrap, httpError } from '../lib/http.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { loadOrgs, invalidateOrgs, userScope, userRoots, inherited, descendants, toPublic } from '../lib/orgs.js';
import { normalizeSido, SIDO } from '../lib/regions.js';
import { audit } from '../lib/audit.js';
import { q, exec, one } from '../db.js';
import { config } from '../config.js';

const r = Router();
const TYPES = ['HQ', 'BRANCH', 'SITE'];
const logoDir = path.join(config.dataDir, 'logos');
fs.mkdirSync(logoDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: logoDir,
    filename: (req, file, cb) => cb(null, `org${req.params.sn}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : httpError(400, 'PNG, JPG, SVG, WEBP 파일만 올릴 수 있습니다'), ok);
  },
});

/** 고객 관리자는 자기 조직의 하위만 바꿀 수 있다 (자기 조직 자체의 이름·주소는 가능, 이동은 불가) */
function assertEditable(tree, user, sn, { move = false } = {}) {
  if (user.role === 'SYSADMIN') return;
  const scope = userScope(tree, user);
  if (!scope.has(Number(sn))) throw httpError(403, '이 조직을 수정할 권한이 없습니다');
  if (move && Number(sn) === user.org_sn) throw httpError(403, '자기 조직은 옮길 수 없습니다');
}

function cleanFields(b) {
  const out = {};
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n) throw httpError(400, '이름을 입력하세요');
    out.name = n.slice(0, 100);
  }
  if (b.orgType !== undefined) {
    if (!TYPES.includes(b.orgType)) throw httpError(400, '조직 유형이 올바르지 않습니다');
    out.org_type = b.orgType;
  }
  if (b.sido !== undefined) {
    const s = b.sido ? normalizeSido(b.sido) : null;
    if (b.sido && !s) throw httpError(400, '시도 이름을 확인하세요');
    out.sido = s;
  }
  for (const [k, col, max] of [['sigungu', 'sigungu', 30], ['address', 'address', 200], ['managerName', 'manager_name', 50], ['managerPhone', 'manager_phone', 30]]) {
    if (b[k] !== undefined) out[col] = b[k] ? String(b[k]).trim().slice(0, max) : null;
  }
  for (const k of ['lat', 'lng']) {
    if (b[k] !== undefined) out[k] = b[k] === '' || b[k] == null ? null : Number(b[k]);
  }
  if (b.sortOrder !== undefined) out.sort_order = Number(b.sortOrder) || 0;
  return out;
}

r.get('/orgs', requireAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const counts = new Map((await q('SELECT site_sn, COUNT(*) n FROM eg_device_site WHERE removed_on IS NULL GROUP BY site_sn')).map((x) => [x.site_sn, x.n]));
  const scope = userScope(tree, req.user);
  const node = (o) => {
    const kids = o.children.map(node);
    const direct = counts.get(o.sn) || 0;
    return {
      ...toPublic(o),
      sidoInherited: inherited(tree, o.sn, 'sido'),
      sigunguInherited: inherited(tree, o.sn, 'sigungu'),
      logoUrl: inherited(tree, o.sn, 'logo_path') ? `/api/orgs/${o.sn}/logo` : null,
      devices: direct,
      devicesTotal: direct + kids.reduce((x, k) => x + k.devicesTotal, 0),
      children: kids,
    };
  };
  const roots = userRoots(tree, req.user).map((sn) => node(tree.byId.get(sn)));
  res.json({ roots, sidoList: SIDO, canEdit: req.user.role !== 'VIEWER', scopeSize: scope.size });
}));

r.post('/orgs', requireRole('SYSADMIN', 'CUSTADMIN'), wrap(async (req, res) => {
  const tree = await loadOrgs();
  const parentSn = req.body?.parentSn ? Number(req.body.parentSn) : null;
  if (parentSn == null && req.user.role !== 'SYSADMIN') throw httpError(403, '최상위 조직은 시스템 관리자만 만들 수 있습니다');
  if (parentSn != null) {
    if (!tree.byId.has(parentSn)) throw httpError(400, '상위 조직을 찾을 수 없습니다');
    assertEditable(tree, req.user, parentSn);
  }
  const f = cleanFields({ orgType: 'SITE', ...req.body });
  if (!f.name) throw httpError(400, '이름을 입력하세요');
  const cols = ['parent_sn', ...Object.keys(f)];
  const out = await exec(`INSERT INTO eg_org (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [parentSn, ...Object.values(f)]);
  invalidateOrgs();
  await audit(req, 'org.create', 'org', out.insertId, { parentSn, ...f });
  res.json({ ok: true, sn: out.insertId });
}));

r.patch('/orgs/:sn', requireRole('SYSADMIN', 'CUSTADMIN'), wrap(async (req, res) => {
  const tree = await loadOrgs();
  const sn = Number(req.params.sn);
  if (!tree.byId.has(sn)) throw httpError(404, '조직을 찾을 수 없습니다');
  const moving = req.body && 'parentSn' in req.body;
  assertEditable(tree, req.user, sn, { move: moving });
  const f = cleanFields(req.body || {});
  if (moving) {
    const p = req.body.parentSn == null || req.body.parentSn === '' ? null : Number(req.body.parentSn);
    if (p == null && req.user.role !== 'SYSADMIN') throw httpError(403, '최상위로 옮길 수 없습니다');
    if (p != null) {
      if (!tree.byId.has(p)) throw httpError(400, '옮길 곳을 찾을 수 없습니다');
      if (descendants(tree, sn).includes(p)) throw httpError(400, '자기 하위 조직 아래로는 옮길 수 없습니다');
      assertEditable(tree, req.user, p);
    }
    f.parent_sn = p;
  }
  if (!Object.keys(f).length) return res.json({ ok: true });
  await exec(`UPDATE eg_org SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE sn = ?`, [...Object.values(f), sn]);
  invalidateOrgs();
  await audit(req, moving ? 'org.move' : 'org.update', 'org', sn, f);
  res.json({ ok: true });
}));

r.delete('/orgs/:sn', requireRole('SYSADMIN', 'CUSTADMIN'), wrap(async (req, res) => {
  const tree = await loadOrgs();
  const sn = Number(req.params.sn);
  const o = tree.byId.get(sn);
  if (!o) throw httpError(404, '조직을 찾을 수 없습니다');
  assertEditable(tree, req.user, sn, { move: true });
  if (o.children.length) throw httpError(400, '하위 조직이 있어 삭제할 수 없습니다. 먼저 옮기거나 삭제하세요');
  const d = await one('SELECT COUNT(*) n FROM eg_device_site WHERE site_sn = ? AND removed_on IS NULL', [sn]);
  if (d.n) throw httpError(400, `배정된 장비 ${d.n}대가 있어 삭제할 수 없습니다`);
  const u = await one("SELECT COUNT(*) n FROM eg_user WHERE org_sn = ? AND active = 'Y'", [sn]);
  if (u.n) throw httpError(400, `이 조직에 속한 사용자 ${u.n}명이 있어 삭제할 수 없습니다`);
  await exec("UPDATE eg_org SET use_yn = 'N' WHERE sn = ?", [sn]); // 과거 통계 보존을 위해 숨김 처리
  invalidateOrgs();
  await audit(req, 'org.delete', 'org', sn, { name: o.name });
  res.json({ ok: true });
}));

r.post('/orgs/:sn/logo', requireRole('SYSADMIN', 'CUSTADMIN'), wrap(async (req, res, next) => {
  const tree = await loadOrgs();
  const sn = Number(req.params.sn);
  if (!tree.byId.has(sn)) throw httpError(404, '조직을 찾을 수 없습니다');
  assertEditable(tree, req.user, sn);
  upload.single('logo')(req, res, async (err) => {
    try {
      if (err) throw err.status ? err : httpError(400, err.code === 'LIMIT_FILE_SIZE' ? '1MB 이하 파일만 올릴 수 있습니다' : err.message);
      if (!req.file) throw httpError(400, '파일을 선택하세요');
      await exec('UPDATE eg_org SET logo_path = ? WHERE sn = ?', [req.file.filename, sn]);
      invalidateOrgs();
      await audit(req, 'org.logo', 'org', sn, { file: req.file.filename });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}));

r.delete('/orgs/:sn/logo', requireRole('SYSADMIN', 'CUSTADMIN'), wrap(async (req, res) => {
  const tree = await loadOrgs();
  const sn = Number(req.params.sn);
  assertEditable(tree, req.user, sn);
  await exec('UPDATE eg_org SET logo_path = NULL WHERE sn = ?', [sn]);
  invalidateOrgs();
  await audit(req, 'org.logo.remove', 'org', sn);
  res.json({ ok: true });
}));

/** 로고 (자기 것이 없으면 상위 조직 것, 그래도 없으면 기본 로고) */
r.get('/orgs/:sn/logo', requireAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const sn = Number(req.params.sn);
  if (req.user.role !== 'SYSADMIN' && !userScope(tree, req.user).has(sn)) throw httpError(404, '없음');
  const file = inherited(tree, sn, 'logo_path');
  const full = file ? path.join(logoDir, path.basename(file)) : null;
  if (!full || !fs.existsSync(full)) return res.redirect('/img/ecog-logo.svg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox"); // SVG 안 스크립트 차단
  res.sendFile(full);
}));

export default r;
