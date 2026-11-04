// sql/ 폴더의 번호 붙은 파일 중 아직 적용하지 않은 것만 순서대로 실행한다.
// 사용: node scripts/db-migrate.js   (deploy.sh 가 매 배포 때 실행)
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const dir = path.join(config.root, 'sql');
const conn = await mysql.createConnection({ ...config.db, multipleStatements: true, charset: 'UTF8_GENERAL_CI' });

await conn.query(`CREATE TABLE IF NOT EXISTS eg_schema_migrations (
  filename VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci`);

const [done] = await conn.query('SELECT filename FROM eg_schema_migrations');
const applied = new Set(done.map((r) => r.filename));
const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

let count = 0;
for (const f of files) {
  if (applied.has(f)) continue;
  console.log(`[migrate] ${f}`);
  await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await conn.query('INSERT INTO eg_schema_migrations (filename) VALUES (?)', [f]);
  count++;
}
console.log(count ? `[migrate] ${count}개 적용` : '[migrate] 적용할 파일 없음');
await conn.end();
