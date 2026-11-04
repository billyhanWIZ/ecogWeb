// 구 테이블(eg_managegroup, eg_deviceinfo.mangegroup, eg_userinfo) → 새 테이블 이관.
// 여러 번 실행해도 이미 옮긴 것은 건너뛴다. 구 테이블은 읽기만 한다.
//
// 사용:
//   node scripts/migrate-legacy.js --dry-run
//   node scripts/migrate-legacy.js --root-name "ecoG" --admin-id admin --admin-pw '초기비밀번호'
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool, q, tx } from '../src/db.js';
import { normalizeSido } from '../src/lib/regions.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dryRun = args.includes('--dry-run');
const rootName = opt('root-name', 'ecoG');
const adminId = opt('admin-id', 'admin');
let adminPw = opt('admin-pw');

/** ECOGID_20251231_173350.897 → '2025-12-31' */
function dateFromDeviceId(id) {
  const m = /^[A-Za-z]+_(\d{4})(\d{2})(\d{2})_/.exec(id || '');
  if (!m) return null;
  const s = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

const log = [];
const say = (m) => { log.push(m); console.log(m); };

await tx(async (run) => {
  // 1) 조직
  let [root] = await run("SELECT sn FROM eg_org WHERE parent_sn IS NULL AND org_type='HQ' ORDER BY sn LIMIT 1");
  if (!root) {
    const r = await run("INSERT INTO eg_org (parent_sn, org_type, name) VALUES (NULL, 'HQ', ?)", [rootName]);
    root = { sn: r.insertId };
    say(`[조직] 최상위 '${rootName}' 생성 (sn=${root.sn})`);
  }
  const groups = await run('SELECT sn, groupname, upcode FROM eg_managegroup ORDER BY upcode, sn');
  const mapped = new Map((await run('SELECT sn, legacy_group_sn FROM eg_org WHERE legacy_group_sn IS NOT NULL'))
    .map((r) => [r.legacy_group_sn, r.sn]));

  // 상위 그룹 먼저, 하위 그룹은 상위가 만들어진 뒤에
  const pending = groups.filter((g) => !mapped.has(g.sn));
  for (let pass = 0; pass < 5 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const g = pending[i];
      const isTop = !g.upcode;
      const parentSn = isTop ? root.sn : mapped.get(g.upcode);
      if (!isTop && !parentSn && groups.some((x) => x.sn === g.upcode)) continue; // 다음 패스에서
      const type = isTop ? 'BRANCH' : 'SITE';
      const sido = normalizeSido(g.groupname);
      const r = await run(
        'INSERT INTO eg_org (parent_sn, org_type, name, sido, legacy_group_sn) VALUES (?,?,?,?,?)',
        [parentSn || root.sn, type, g.groupname, sido, g.sn]);
      mapped.set(g.sn, r.insertId);
      say(`[조직] ${type} '${g.groupname}' (구 그룹 ${g.sn} → ${r.insertId})${sido ? ` 시도=${sido}` : ''}`);
      pending.splice(i, 1);
    }
  }

  // 2) 장비 배정
  const devs = await run(`
    SELECT i.deviceid, i.devicename, i.mangegroup,
           (SELECT MIN(c.cleandate) FROM eg_cleancount c WHERE c.deviceid = i.deviceid) AS first_use
    FROM eg_deviceinfo i
    WHERE i.mangegroup IS NOT NULL AND i.mangegroup > 0
      AND NOT EXISTS (SELECT 1 FROM eg_device_site a WHERE a.deviceid = i.deviceid AND a.removed_on IS NULL)`);
  let assigned = 0;
  let skipped = 0;
  for (const d of devs) {
    const site = mapped.get(d.mangegroup);
    if (!site) { skipped++; continue; }
    // 설치일 = deviceid 날짜와 첫 사용일 중 빠른 날 (과거 기록이 빠지지 않게)
    const cands = [dateFromDeviceId(d.deviceid), d.first_use].filter(Boolean).sort();
    const installed = cands[0] || new Date().toISOString().slice(0, 10);
    await run('INSERT INTO eg_device_site (deviceid, site_sn, display_name, installed_on, memo) VALUES (?,?,?,?,?)',
      [d.deviceid, site, d.devicename, installed, '구 시스템에서 이관']);
    assigned++;
  }
  say(`[장비] 배정 ${assigned}대 이관${skipped ? `, 그룹을 찾지 못해 건너뜀 ${skipped}대` : ''}`);

  // 3) 사용자
  const users = await run(`SELECT u.* FROM eg_userinfo u
    WHERE NOT EXISTS (SELECT 1 FROM eg_user n WHERE n.legacy_userinfo_sn = u.sn OR n.login_id = u.userid)`);
  for (const u of users) {
    const level = Number(u.LEVEL ?? u.level ?? 2);
    const role = level === 0 ? 'CUSTADMIN' : 'VIEWER';
    const orgSn = level === 0 ? root.sn : mapped.get(u.managegroup) || root.sn;
    const hash = await bcrypt.hash(String(u.password), 10);
    await run('INSERT INTO eg_user (login_id, name, password_hash, role, org_sn, legacy_userinfo_sn) VALUES (?,?,?,?,?,?)',
      [u.userid, u.username, hash, role, orgSn, u.sn]);
    say(`[사용자] ${u.userid} (LEVEL ${level}) → ${role}, 조직 ${orgSn}`);
  }

  // 4) 시스템 관리자
  const [hasAdmin] = await run("SELECT sn FROM eg_user WHERE role='SYSADMIN' LIMIT 1");
  if (!hasAdmin) {
    const generated = !adminPw;
    if (generated) adminPw = crypto.randomBytes(6).toString('base64url');
    await run("INSERT INTO eg_user (login_id, name, password_hash, role, org_sn, must_change_pw) VALUES (?,?,?,'SYSADMIN',?,?)",
      [adminId, '시스템 관리자', await bcrypt.hash(adminPw, 10), root.sn, generated ? 'Y' : 'N']);
    say(`[사용자] 시스템 관리자 '${adminId}' 생성${generated ? ` — 임시 비밀번호: ${adminPw} (첫 로그인 후 변경)` : ''}`);
  }

  if (dryRun) throw Object.assign(new Error('dry-run'), { dry: true });
}).catch((e) => {
  if (e.dry) console.log('\n--dry-run: 위 내용은 되돌렸습니다. 실제로 반영하려면 --dry-run 없이 실행하세요.');
  else throw e;
});

const [cnt] = await q(`SELECT
  (SELECT COUNT(*) FROM eg_org) orgs,
  (SELECT COUNT(*) FROM eg_device_site WHERE removed_on IS NULL) assigned,
  (SELECT COUNT(*) FROM eg_deviceinfo) devices,
  (SELECT COUNT(*) FROM eg_user) users`);
console.log(`\n현재: 조직 ${cnt.orgs}, 배정 장비 ${cnt.assigned}/${cnt.devices}, 사용자 ${cnt.users}`);
await pool.end();
