// 로컬 개발용: 구 테이블 4개를 만들고 운영과 비슷한 모양의 가짜 데이터를 넣는다.
// 운영 서버에서는 절대 실행하지 말 것 (테이블을 비운다).
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

if (config.isProd) throw new Error('운영 환경에서는 실행할 수 없습니다');

const conn = await mysql.createConnection({ ...config.db, multipleStatements: true, charset: 'UTF8_GENERAL_CI' });
await conn.query(fs.readFileSync(path.join(config.root, 'dev/legacy_schema.sql'), 'utf8'));
await conn.query('TRUNCATE eg_cleancount; TRUNCATE eg_deviceinfo; TRUNCATE eg_managegroup; TRUNCATE eg_userinfo;');

let s = 42;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 상위 그룹(upcode=0) = 시도, 하위 그룹 = 설치처
const tops = { '경상남도': ['창원시청', '김해시청', '진주시청', '경남도청'], '인천광역시': ['인천시청', '연수구청'], '서울특별시': ['서울시청 본관'] };
const groupSn = {};
const subs = [];
for (const [top, children] of Object.entries(tops)) {
  const [r] = await conn.query('INSERT INTO eg_managegroup (groupname, upcode) VALUES (?, 0)', [top]);
  groupSn[top] = r.insertId;
  for (const c of children) {
    const [r2] = await conn.query('INSERT INTO eg_managegroup (groupname, upcode) VALUES (?, ?)', [c, r.insertId]);
    subs.push({ sn: r2.insertId, name: c, top });
  }
}

await conn.query(`INSERT INTO eg_userinfo (userid, username, password, managegroup, LEVEL) VALUES
  ('ecog', '본사', 'ecog1234', 0, 0),
  ('gyeongnam', '경상남도', 'gn1234', ?, 1),
  ('changwon', '창원시청', 'cw1234', ?, 2)`, [groupSn['경상남도'], subs[0].sn]);

// 장비: 배정 80대 + 미배정 30대
const weights = [30, 12, 8, 11, 9, 4, 6];
const devices = [];
let k = 0;
subs.forEach((g, i) => {
  for (let j = 0; j < weights[i]; j++) devices.push({ group: g.sn, name: `${g.name} ${j + 1}호기`, idx: k++ });
});
for (let j = 0; j < 30; j++) devices.push({ group: null, name: `테스트 ${j + 1}`, idx: k++ });

const today = new Date();
const start = new Date('2025-01-01T00:00:00');
for (const d of devices) {
  const inst = new Date(start.getTime() - rnd() * 400 * 864e5);
  const t = `${pad(Math.floor(rnd() * 24))}${pad(Math.floor(rnd() * 60))}${pad(Math.floor(rnd() * 60))}.${String(Math.floor(rnd() * 1000)).padStart(3, '0')}`;
  d.id = `ECOGID_${ymd(inst).replaceAll('-', '')}_${t}`;
  // 2026년 4월 이후로는 대부분 꺼짐 (운영 데이터 모양 재현)
  d.stopAt = rnd() < 0.85 ? new Date('2026-0' + (1 + Math.floor(rnd() * 4)) + '-15') : today;
  d.alive = d.stopAt === today && d.group !== null;
  // 신호 시각은 DB 시계 기준으로: 살아 있는 장비는 방금, 꺼진 장비는 멈춘 날 무렵
  const agoSec = d.alive ? Math.floor(rnd() * 20) : Math.max(3600, Math.floor((today - d.stopAt) / 1000) + Math.floor(rnd() * 86400));
  await conn.query('INSERT INTO eg_deviceinfo (deviceid, devicename, mangegroup, lastsignaldt) VALUES (?,?,?, NOW() - INTERVAL ? SECOND)',
    [d.id, d.name, d.group, agoSec]);
}

const rows = [];
for (const d of devices) {
  const base = 2 + rnd() * 10;
  for (let t = start.getTime(); t <= d.stopAt.getTime(); t += 864e5) {
    const day = new Date(t);
    const wd = day.getDay();
    if (wd === 0 || wd === 6 ? rnd() < 0.85 : rnd() < 0.25) continue;
    const c = Math.max(1, Math.round(base * (0.4 + rnd() * 1.2)));
    rows.push([d.id, ymd(day), c]);
  }
}
// 같은 날짜 중복 행 몇 개 (MAX 집계 검증용)
for (let i = 0; i < 5; i++) { const r = rows[Math.floor(rnd() * rows.length)]; rows.push([r[0], r[1], Math.max(1, r[2] - 2)]); }
for (let i = 0; i < rows.length; i += 2000) {
  await conn.query('INSERT INTO eg_cleancount (deviceid, cleandate, cleancount) VALUES ?', [rows.slice(i, i + 2000)]);
}
console.log(`그룹 ${3 + subs.length}, 장비 ${devices.length}, 세척 행 ${rows.length}`);
await conn.end();
