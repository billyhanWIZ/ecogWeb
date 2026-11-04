// PDF 리포트: 집계 → HTML(인라인 SVG 차트) → Chromium 으로 A4 PDF
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { loadOrgs, userRoots, inherited, pathName, scopedSubtree } from './orgs.js';
import { buildStats, resolveSites, loadUsage } from './stats.js';
import { getSettings, impact } from './settings.js';
import { signalStatus } from './usage.js';
import { q } from '../db.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 });
const int = (v) => n0.format(Math.round(v || 0));
const co2 = (kg) => (kg >= 1000 ? `${n1.format(kg / 1000)}t` : `${n1.format(kg)}kg`);
const pct = (v) => (v == null ? '–' : `${n1.format(v * 100)}%`);
const chg = (v) => (v == null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : ''}${n1.format(v * 100)}%`);
const dot = (d) => d.replaceAll('-', '.');

/** 리포트 대상과 데이터 */
export async function reportData(user, params, period) {
  const tree = await loadOrgs();
  const s = await getSettings();
  const roots = userRoots(tree, user);
  const orgSn = params.org ? Number(params.org) : roots.length === 1 ? roots[0] : null;
  if (orgSn != null) scopedSubtree(tree, user, orgSn); // 범위 확인 (밖이면 403)
  const target = orgSn != null ? tree.byId.get(orgSn) : null;
  const p = { org: orgSn ?? undefined, sido: params.sido || undefined };

  const sites = resolveSites(tree, user, p);
  const data = await loadUsage(sites, period);
  const groupBy = p.sido ? 'sigungu' : target && target.children.length ? 'org' : target ? 'device' : 'org';
  const [main, bySite] = await Promise.all([
    buildStats(user, { ...p, by: groupBy }, period, data),
    buildStats(user, { ...p, by: 'site' }, period, data),
  ]);

  const current = sites.length ? await q('SELECT deviceid FROM eg_device_site WHERE removed_on IS NULL AND site_sn IN (?)', [sites]) : [];
  const sig = await signalStatus(current.map((c) => c.deviceid));
  const online = current.filter((c) => (sig.get(c.deviceid)?.ago ?? Infinity) <= s.offline_seconds).length;

  const scopeName = [target ? pathName(tree, target.sn) : '전체', p.sido].filter(Boolean).join(' · ');
  const logoOrg = target?.sn ?? roots[0];
  const logoFile = logoOrg != null ? inherited(tree, logoOrg, 'logo_path') : null;

  return {
    scopeName,
    orgSn,
    sido: p.sido || null,
    period,
    prev: data.prev,
    settings: s,
    total: main.total,
    devicesInstalled: current.length,
    devicesOnline: online,
    devicesUsed: new Set(data.daily.filter((d) => d.cnt > 0).map((d) => d.deviceid)).size,
    unit: main.unit,
    series: main.series,
    groupBy,
    rows: main.rows,
    topSites: bySite.rows.filter((r) => r.uses > 0).slice(0, 10),
    logo: logoDataUri(logoFile),
    photo: `data:image/jpeg;base64,${fs.readFileSync(path.join(config.root, 'public/img/photo-hand.jpg')).toString('base64')}`,
    issued: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10),
    issuer: user.name,
    prevImpact: impact(main.total.prevUses, s),
  };
}

function logoDataUri(file) {
  const fallback = path.join(config.root, 'public/img/ecog-logo.png');
  const full = file ? path.join(config.dataDir, 'logos', path.basename(file)) : fallback;
  const use = fs.existsSync(full) ? full : fallback;
  const ext = path.extname(use).toLowerCase();
  const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] || 'image/png';
  return `data:${mime};base64,${fs.readFileSync(use).toString('base64')}`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

function bucketLabel(b, unit) {
  if (unit === 'month') return `${Number(b.slice(5, 7))}월`;
  return `${Number(b.slice(5, 7))}/${Number(b.slice(8))}`;
}

/** 세로 막대 (추이) */
function barChart(buckets, values, unit) {
  const W = 680, H = 230, L = 46, B = 26, T = 10;
  const max = niceMax(Math.max(...values, 0));
  const n = values.length || 1;
  const step = (W - L - 8) / n;
  const bw = Math.min(28, step * 0.62);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = Math.ceil(n / 14);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="#E5ECE3"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#7F9384">${int(v)}</text>`;
  }
  values.forEach((v, i) => {
    const x = L + step * i + (step - bw) / 2;
    g += `<rect x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(0, H - B - y(v))}" rx="2" fill="#1F7A45"/>`;
    if (i % every === 0) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7F9384">${esc(bucketLabel(buckets[i], unit))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="사용 횟수 추이">${g}</svg>`;
}

/** 가로 막대 (순위) */
function rankChart(rows) {
  const W = 680, rowH = 26, L = 230;
  const max = niceMax(Math.max(...rows.map((r) => r.uses), 0));
  let g = '';
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    const w = ((W - L - 70) * r.uses) / max;
    const name = r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label;
    g += `<text x="0" y="${y + 13}" font-size="11.5" fill="#134226">${esc(name)}</text>`;
    g += `<rect x="${L}" y="${y + 3}" width="${Math.max(2, w)}" height="13" rx="2" fill="${i === 0 ? '#134226' : '#88BC50'}"/>`;
    g += `<text x="${L + w + 6}" y="${y + 13}" font-size="11" fill="#4D6152">${int(r.uses)}회</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${rows.length * rowH + 8}" width="100%" role="img" aria-label="설치처 순위">${g}</svg>`;
}

const GROUP_LABEL = { org: '조직', sigungu: '시군구', device: '세척기', site: '설치처', sido: '시도' };

export function reportHtml(d) {
  const t = d.total;
  const s = d.settings;
  const cups = int(t.uses);
  const rows = d.rows.filter((r) => r.devices > 0 || r.uses > 0);
  const table = rows.length ? `
    <table>
      <thead><tr><th>${GROUP_LABEL[d.groupBy]}</th><th class="r">장비</th><th class="r">사용(회)</th><th class="r">직전 대비</th><th class="r">장비당 일평균</th><th class="r">가동일률</th><th class="r">탄소 저감</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.label)}${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}</td><td class="r">${int(r.devices)}</td><td class="r b">${int(r.uses)}</td><td class="r">${chg(r.change)}</td><td class="r">${n1.format(r.perDeviceDay)}</td><td class="r">${pct(r.activeRate)}</td><td class="r">${co2(r.co2Kg)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>합계</td><td class="r">${int(t.devices)}</td><td class="r">${int(t.uses)}</td><td class="r">${chg(t.change)}</td><td class="r">${n1.format(t.perDeviceDay)}</td><td class="r">${pct(t.activeRate)}</td><td class="r">${co2(t.co2Kg)}</td></tr></tfoot>
    </table>` : '<p class="muted">이 기간에 해당하는 장비가 없습니다.</p>';

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>eco.G ESG 리포트 — ${esc(d.scopeName)}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Noto Sans CJK KR', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #134226; font-size: 10.5pt; line-height: 1.55; font-variant-numeric: tabular-nums; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .cover { height: 255mm; display: flex; flex-direction: column; justify-content: space-between; }
  .cover .logo { height: 16mm; max-width: 70mm; object-fit: contain; object-position: left; }
  .cover .title { border-left: 3mm solid #88BC50; padding-left: 7mm; }
  .cover h1 { font-size: 27pt; line-height: 1.25; margin: 0 0 4mm; letter-spacing: -0.02em; }
  .cover .scope { font-size: 15pt; margin: 0; }
  .cover .period { font-size: 12pt; color: #4D6152; margin: 2mm 0 0; }
  .cover .photo { height: 78mm; border-radius: 3mm; background-size: cover; background-position: center 40%; }
  .cover .lead { background: #134226; color: #fff; border-radius: 3mm; padding: 9mm 10mm; }
  .cover .lead p { margin: 0; color: #C4D9C6; font-size: 11pt; }
  .cover .lead b { display: block; color: #fff; font-size: 26pt; letter-spacing: -0.02em; margin: 1mm 0 2mm; }
  .cover .meta { font-size: 9pt; color: #7F9384; display: flex; justify-content: space-between; }
  h2 { font-size: 14pt; margin: 0 0 4mm; letter-spacing: -0.01em; }
  h2 small { font-size: 9.5pt; color: #7F9384; font-weight: 400; margin-left: 2mm; }
  section { margin-bottom: 9mm; break-inside: avoid; }
  .kpi { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
  .kpi div { border: 0.3mm solid #DCE5DA; border-radius: 2mm; padding: 3.5mm 4mm; }
  .kpi span { display: block; font-size: 9pt; color: #4D6152; }
  .kpi b { display: block; font-size: 17pt; margin-top: 1mm; letter-spacing: -0.01em; }
  .kpi em { font-style: normal; font-size: 9pt; color: #4D6152; }
  .up { color: #2F8F5B; } .down { color: #B9432F; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { text-align: left; color: #4D6152; font-weight: 600; border-bottom: 0.4mm solid #134226; padding: 2mm 2mm; white-space: nowrap; }
  td { border-bottom: 0.2mm solid #E5ECE3; padding: 1.8mm 2mm; }
  tfoot td { font-weight: 700; border-top: 0.4mm solid #134226; border-bottom: 0; }
  .r { text-align: right; } .b { font-weight: 700; }
  .sub { display: block; font-size: 8pt; color: #7F9384; }
  .muted { color: #7F9384; }
  .note { font-size: 9pt; color: #4D6152; }
  .note li { margin-bottom: 1.5mm; }
  .src { font-size: 8.5pt; color: #7F9384; }
  @media screen { body { max-width: 210mm; margin: 0 auto; padding: 16mm; background: #fff; } html { background: #EBF0E9; } .page { border-bottom: 1px dashed #DCE5DA; padding-bottom: 12mm; margin-bottom: 12mm; } .cover { height: auto; min-height: 240mm; } }
</style></head>
<body>
<div class="page cover">
  <img class="logo" src="${d.logo}" alt="">
  <div class="title">
    <h1>텀블러 세척기<br>ESG 리포트</h1>
    <p class="scope">${esc(d.scopeName)}</p>
    <p class="period">${dot(d.period.from)} ~ ${dot(d.period.to)} (${d.period.days}일)</p>
  </div>
  <div class="photo" style="background-image:url('${d.photo}')"></div>
  <div class="lead">
    <p>이 기간 텀블러를 씻은 횟수</p>
    <b>${cups}회</b>
    <p>일회용컵 ${cups}개를 대신해 탄소 ${co2(t.co2Kg)}를 줄였습니다. 30년생 소나무 ${int(t.trees)}그루가 1년 동안 흡수하는 양입니다.</p>
  </div>
  <div class="meta"><span>발행일 ${dot(d.issued)}</span><span>작성 ${esc(d.issuer)}</span></div>
</div>

<div class="page">
  <section>
    <h2>한눈에 보기 <small>직전 기간 ${dot(d.prev.from)} ~ ${dot(d.prev.to)}와 비교</small></h2>
    <div class="kpi">
      <div><span>세척 횟수</span><b>${int(t.uses)}회</b><em class="${t.change >= 0 ? 'up' : 'down'}">${chg(t.change)}</em> <em>직전 ${int(t.prevUses)}회</em></div>
      <div><span>탄소 저감</span><b>${co2(t.co2Kg)}</b><em>직전 ${co2(d.prevImpact.co2Kg)}</em></div>
      <div><span>소나무 효과</span><b>${int(t.trees)}그루</b><em>30년생 소나무 1년 흡수량</em></div>
      <div><span>운영 장비</span><b>${int(d.devicesInstalled)}대</b><em>기간 중 사용 ${int(d.devicesUsed)}대</em></div>
      <div><span>장비당 하루 평균</span><b>${n1.format(t.perDeviceDay)}회</b><em>배정 기간 기준</em></div>
      <div><span>가동일률</span><b>${pct(t.activeRate)}</b><em>하루라도 쓰인 날의 비율</em></div>
    </div>
  </section>
  <section>
    <h2>${d.unit === 'month' ? '월별' : d.unit === 'week' ? '주별' : '일별'} 세척 횟수</h2>
    ${barChart(d.series.buckets, d.series.total, d.unit)}
  </section>
  <section>
    <h2>많이 쓴 설치처</h2>
    ${d.topSites.length ? rankChart(d.topSites) : '<p class="muted">이 기간에 사용 기록이 없습니다.</p>'}
  </section>
</div>

<div class="page">
  <section>
    <h2>${GROUP_LABEL[d.groupBy]}별 현황</h2>
    ${table}
  </section>
  <section class="note">
    <h2>산정 기준</h2>
    <ul>
      <li>세척 1회는 일회용컵 1개를 대신한 것으로 봅니다. 탄소 저감량은 일회용 플라스틱컵(300mL) 1개의 전 과정 배출량 ${n1.format(s.co2_per_use_g)}g을 곱했습니다.</li>
      <li>소나무 효과는 탄소 저감량을 30년생 소나무 1그루의 연간 이산화탄소 흡수량 ${n1.format(s.co2_per_tree_kg)}kg으로 나눈 값입니다.</li>
      <li>세척 횟수는 각 세척기가 보낸 하루 누적값입니다. 장비를 옮긴 경우 옮기기 전 사용량은 이전 설치처에 포함됩니다.</li>
      <li>가동일률은 장비가 설치처에 배정된 날 가운데 한 번이라도 쓰인 날의 비율입니다.</li>
    </ul>
    <p class="src">출처: 기후변화행동연구소(일회용컵 LCA, 포스코 뉴스룸·더나은미래 인용), 국립산림과학원(30년생 소나무 연간 흡수량). 일회용 종이컵 기준(28g)으로 계산하면 탄소 저감량은 약 ${n0.format((28 / s.co2_per_use_g) * 100)}% 수준입니다.</p>
  </section>
</div>
</body></html>`;
}

// ── Chromium (한 개를 띄워 두고 재사용, 동시에 하나씩) ──
let browserP = null;
let queue = Promise.resolve();

async function browser() {
  if (browserP) {
    const b = await browserP.catch(() => null);
    if (b && b.isConnected()) return b;
  }
  const { chromium } = await import('playwright-core');
  browserP = chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  return browserP;
}

export function htmlToPdf(html, footerText) {
  const job = queue.then(async () => {
    const b = await browser();
    const page = await b.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="font-size:8px;color:#7F9384;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>${esc(footerText)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
        margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
      });
    } finally {
      await page.close().catch(() => {});
    }
  });
  queue = job.catch(() => {});
  return job;
}
