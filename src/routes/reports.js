import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { parsePeriod } from '../lib/dates.js';
import { reportData, reportHtml, htmlToPdf } from '../lib/report.js';
import { loadOrgs, userScope } from '../lib/orgs.js';
import { audit } from '../lib/audit.js';
import { q, exec } from '../db.js';

const r = Router();
const params = (qs) => ({ org: qs.org || null, sido: qs.sido || null });

/** 브라우저에서 바로 보는 미리보기 (PDF 와 같은 HTML) */
r.get('/reports/preview', requireAuth, wrap(async (req, res) => {
  const d = await reportData(req.user, params(req.query), parsePeriod(req.query));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(reportHtml(d));
}));

r.get('/reports/pdf', requireAuth, wrap(async (req, res) => {
  const period = parsePeriod(req.query);
  const d = await reportData(req.user, params(req.query), period);
  const pdf = await htmlToPdf(reportHtml(d), `eco.G 텀블러 세척기 ESG 리포트 · ${d.scopeName}`);
  await exec('INSERT INTO eg_report (org_sn, scope_desc, date_from, date_to, created_by) VALUES (?,?,?,?,?)',
    [d.orgSn, d.scopeName.slice(0, 200), period.from, period.to, req.user.sn]);
  await audit(req, 'report.download', 'report', d.orgSn, { scope: d.scopeName, from: period.from, to: period.to });
  const name = `ecoG_ESG리포트_${d.scopeName.replace(/[\\/:*?"<>|›·\s]+/g, '_')}_${period.from}_${period.to}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(pdf);
}));

/** 최근 받은 리포트 (볼 수 있는 조직 것만) */
r.get('/reports/history', requireAuth, wrap(async (req, res) => {
  const tree = await loadOrgs();
  const scope = userScope(tree, req.user);
  const rows = await q(`SELECT r.sn, r.org_sn, r.scope_desc, DATE_FORMAT(r.date_from,'%Y-%m-%d') date_from, DATE_FORMAT(r.date_to,'%Y-%m-%d') date_to,
                               DATE_FORMAT(r.created_at,'%Y-%m-%d %H:%i') created_at, u.name created_by
                        FROM eg_report r LEFT JOIN eg_user u ON u.sn = r.created_by
                        ORDER BY r.sn DESC LIMIT 200`);
  const visible = req.user.role === 'SYSADMIN' ? rows : rows.filter((x) => x.org_sn == null ? false : scope.has(x.org_sn));
  res.json({ reports: visible.slice(0, 50) });
}));

export default r;
