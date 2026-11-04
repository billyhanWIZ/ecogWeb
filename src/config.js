import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`환경변수 ${name} 가 필요합니다 (.env 확인)`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  root,
  isProd,
  port: Number(process.env.PORT || 3100),
  host: process.env.HOST || '127.0.0.1',
  sessionSecret: required('SESSION_SECRET', isProd ? undefined : 'dev-only-secret'),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER', isProd ? undefined : 'ecog'),
    password: required('DB_PASSWORD', isProd ? undefined : 'ecogpw'),
    database: required('DB_NAME', isProd ? undefined : 'smartgym'),
  },
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
};
