// 시계 옆 날씨 표시 (사이니지·대시보드 공용). 아이콘은 SVG 로 직접 그린다
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
const CLOUD = 'M17.5 19H8a5 5 0 1 1 1.1-9.88A6 6 0 0 1 20.6 11.3 3.9 3.9 0 0 1 17.5 19z';
export function weatherIcon(kind, night) {
  const svg = svgEl('svg', { viewBox: '0 0 28 28', 'aria-hidden': 'true', class: 'wx-icon' });
  const sun = (cx, cy, r, rays) => {
    if (night) {
      svg.append(svgEl('path', { d: `M${cx + r * 0.2} ${cy - r * 1.25}a${r * 1.3} ${r * 1.3} 0 1 0 ${r * 1.15} ${r * 1.9}A${r * 1.05} ${r * 1.05} 0 0 1 ${cx + r * 0.2} ${cy - r * 1.25}z`, fill: '#F3E6A1' }));
      return;
    }
    svg.append(svgEl('circle', { cx, cy, r, fill: '#FFD45C' }));
    if (rays) for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, r1 = r + 2, r2 = r + 4.4;
      svg.append(svgEl('line', { x1: cx + r1 * Math.cos(a), y1: cy + r1 * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy + r2 * Math.sin(a), stroke: '#FFD45C', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
    }
  };
  const cloud = (fill, dy = 0) => svg.append(svgEl('path', { d: CLOUD, fill, transform: `translate(0 ${dy})` }));
  const drops = (marks) => marks.forEach(([x, snow]) => svg.append(snow
    ? svgEl('circle', { cx: x, cy: 24.5, r: 1.3, fill: '#fff' })
    : svgEl('line', { x1: x + 1, y1: 22, x2: x - 0.6, y2: 26, stroke: '#8FD0F5', 'stroke-width': 1.8, 'stroke-linecap': 'round' })));
  if (kind === 'sun') sun(14, 14, 6, true);
  else if (kind === 'partly') { sun(10, 9, 4.6, true); cloud('#EEF4EF', 3); }
  else if (kind === 'cloud') { cloud('#B9C8BC', -3); cloud('#EEF4EF', 1); }
  else {
    cloud('#DDE6DF', -3);
    drops(kind === 'snow' ? [[9, 1], [14, 1], [19, 1]] : kind === 'sleet' ? [[9, 0], [14, 1], [19, 0]] : [[9, 0], [14, 0], [19, 0]]);
  }
  return svg;
}
/** [아이콘, 기온, 날씨+지역] 노드. 날씨가 없으면 null */
export function weatherNodes(w) {
  if (!w || w.temp == null) return null;
  const hr = new Date().getHours();
  const temp = document.createElement('b');
  temp.textContent = `${w.temp}°`;
  const text = document.createElement('span');
  text.textContent = w.text;
  const place = document.createElement('small');
  place.textContent = w.place || '';
  text.append(place);
  return [weatherIcon(w.kind, hr < 6 || hr >= 18), temp, text];
}

export const weatherTitle = (w) => `${w.place || ''} ${w.text} ${w.temp}°${w.humidity != null ? ` · 습도 ${w.humidity}%` : ''} (기상청)`;
