import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { listSettings, updateSetting } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { q } from '../db.js';

const r = Router();
const sys = requireRole('SYSADMIN');

r.get('/settings', sys, wrap(async (req, res) => {
  res.json({ settings: await listSettings() });
}));

r.put('/settings', sys, wrap(async (req, res) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) await updateSetting(k, v);
  await audit(req, 'settings.update', 'setting', null, body);
  res.json({ ok: true });
}));

r.get('/audit', sys, wrap(async (req, res) => {
  const rows = await q(`SELECT l.sn, DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i:%s') created_at, l.action, l.target_type, l.target_id, l.detail,
                               u.login_id, u.name
                        FROM eg_audit_log l LEFT JOIN eg_user u ON u.sn = l.user_sn
                        ORDER BY l.sn DESC LIMIT 300`);
  res.json({ logs: rows });
}));

export default r;
