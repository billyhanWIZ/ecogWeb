import { exec } from '../db.js';

export async function audit(req, action, targetType, targetId, detail) {
  try {
    await exec('INSERT INTO eg_audit_log (user_sn, action, target_type, target_id, detail) VALUES (?,?,?,?,?)', [
      req.user?.sn ?? null,
      action,
      targetType,
      targetId == null ? null : String(targetId),
      detail == null ? null : JSON.stringify(detail).slice(0, 4000),
    ]);
  } catch (e) {
    console.error('[audit]', e.message);
  }
}
