import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  charset: 'UTF8_GENERAL_CI',
  timezone: '+09:00',
  dateStrings: true, // DATE/DATETIME 을 문자열 그대로 받는다 (시간대 변환 없음)
  connectionLimit: 10,
  waitForConnections: true,
});

/** SELECT → rows */
export async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** 첫 행 또는 null */
export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE → result */
export async function exec(sql, params = []) {
  const [res] = await pool.query(sql, params);
  return res;
}

export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const run = async (sql, params = []) => (await conn.query(sql, params))[0];
    const out = await fn(run);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
