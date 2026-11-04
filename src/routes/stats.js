import { Router } from 'express';
import ExcelJS from 'exceljs';
import { wrap } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { parsePeriod } from '../lib/dates.js';
import { buildStats } from '../lib/stats.js';

const r = Router();
const BY_LABEL = { org: '조직', sido: '시도', sigungu: '시군구', site: '설치처', device: '세척기' };

function params(qs) {
  const { by, unit, org, sido, sigungu, site } = qs;
  return { by, unit, org, sido, sigungu, site };
}

r.get('/stats', requireAuth, wrap(async (req, res) => {
  res.json(await buildStats(req.user, params(req.query), parsePeriod(req.query)));
}));

r.get('/stats/export', requireAuth, wrap(async (req, res) => {
  const st = await buildStats(req.user, params(req.query), parsePeriod(req.query));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ecoG';

  const ws = wb.addWorksheet('집계');
  ws.addRow([`ecoG 세척 통계 — ${BY_LABEL[st.by]}별`]).font = { bold: true, size: 13 };
  ws.addRow([`기간 ${st.period.from} ~ ${st.period.to} (${st.period.days}일), 비교 기간 ${st.prevPeriod.from} ~ ${st.prevPeriod.to}`]);
  ws.addRow([]);
  const head = ws.addRow([BY_LABEL[st.by], '장비 수(대)', '사용 횟수(회)', '직전 기간(회)', '증감(%)', '장비당 일평균(회)', '가동일률(%)', '탄소저감(kg)', '소나무 효과(그루)']);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3EE' } }; });
  for (const x of st.rows) {
    ws.addRow([
      x.sub ? `${x.label} (${x.sub})` : x.label, x.devices, x.uses, x.prevUses,
      x.change == null ? null : Math.round(x.change * 1000) / 10,
      Math.round(x.perDeviceDay * 100) / 100, Math.round(x.activeRate * 1000) / 10,
      Math.round(x.co2Kg * 100) / 100, Math.round(x.trees * 100) / 100,
    ]);
  }
  const t = st.total;
  const total = ws.addRow(['합계', t.devices, t.uses, t.prevUses, t.change == null ? null : Math.round(t.change * 1000) / 10,
    Math.round(t.perDeviceDay * 100) / 100, Math.round(t.activeRate * 1000) / 10, Math.round(t.co2Kg * 100) / 100, Math.round(t.trees * 100) / 100]);
  total.font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 36 : 15; });
  for (let i = 2; i <= 9; i++) ws.getColumn(i).numFmt = '#,##0.##';

  const ws2 = wb.addWorksheet('추이');
  ws2.addRow(['구간', '전체', ...st.series.lines.map((l) => l.label)]).font = { bold: true };
  st.series.buckets.forEach((b, i) => ws2.addRow([b, st.series.total[i], ...st.series.lines.map((l) => l.values[i])]));
  ws2.columns.forEach((c, i) => { c.width = i === 0 ? 14 : 16; });

  const name = `ecoG_통계_${BY_LABEL[st.by]}_${st.period.from}_${st.period.to}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  await wb.xlsx.write(res);
  res.end();
}));

export default r;
