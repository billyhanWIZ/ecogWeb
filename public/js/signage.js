// 사이니지: 시계는 1초마다, 숫자는 30초마다 새로 고친다
const token = location.pathname.split('/').pop();
const nf = new Intl.NumberFormat('ko-KR');
const $ = (id) => document.getElementById(id);
const co2 = (kg) => (kg >= 1000 ? `${(kg / 1000).toFixed(2)}t` : `${Math.round(kg)}kg`);

async function load() {
  try {
    const res = await fetch(`/api/signage/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    $('err').hidden = true;
    $('logo').src = d.logo;
    $('logo').classList.toggle('custom', !!d.logoCustom);
    $('name').textContent = d.name;
    document.title = `${d.name} 텀블러 세척기`;
    $('year').textContent = nf.format(d.year);
    $('cups').textContent = nf.format(d.year);
    $('today').textContent = `${nf.format(d.today)}번`;
    $('month').textContent = `${nf.format(d.month)}번`;
    $('co2').textContent = co2(d.cumulativeImpact.co2Kg);
    $('trees').textContent = `${nf.format(Math.round(d.cumulativeImpact.trees))}그루`;
    const max = Math.max(1, ...d.last14.map((x) => x.uses));
    $('bars').replaceChildren(...d.last14.map((x, i) => {
      const col = document.createElement('div');
      const bar = document.createElement('i');
      bar.style.height = `${(x.uses / max) * 100}%`;
      bar.title = `${x.d} ${x.uses}번`;
      const label = document.createElement('small');
      label.textContent = i === d.last14.length - 1 ? '오늘' : `${Number(x.d.slice(8))}일`;
      col.append(bar, label);
      return col;
    }));
    showWeather(d.weather);
    lastOk = new Date();
    $('updated').textContent = `${hm(lastOk)} 기준`;
  } catch (e) {
    if (e.message === '404') $('err').hidden = false;
  }
}

// 날씨: 기상청 현재 값. 없으면 칸을 숨긴다
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
const CLOUD = 'M17.5 19H8a5 5 0 1 1 1.1-9.88A6 6 0 0 1 20.6 11.3 3.9 3.9 0 0 1 17.5 19z';
function weatherIcon(kind, night) {
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
function showWeather(w) {
  const box = $('wx');
  if (!w || w.temp == null) { box.hidden = true; return; }
  const hr = new Date().getHours();
  const temp = document.createElement('b');
  temp.textContent = `${w.temp}°`;
  const text = document.createElement('span');
  text.textContent = w.text;
  const place = document.createElement('small');
  place.textContent = w.place || '';
  text.append(place);
  box.replaceChildren(weatherIcon(w.kind, hr < 6 || hr >= 18), temp, text);
  box.title = `${w.place || ''} ${w.text} ${w.temp}°${w.humidity != null ? ` · 습도 ${w.humidity}%` : ''} (기상청)`;
  box.hidden = false;
}

const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
let lastOk = null;
let lastDay = new Date().getDate();

function tick() {
  const t = new Date();
  const clock = $('clock');
  clock.dateTime = t.toISOString();
  clock.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = hm(t); // 시:분:초
  const small = document.createElement('small');
  small.textContent = `${t.getFullYear()}.${pad(t.getMonth() + 1)}.${pad(t.getDate())} (${DAYS[t.getDay()]})`;
  clock.append(b, small);
  // 날짜가 바뀌면 '오늘'·'이번 달' 숫자를 바로 다시 받는다
  if (t.getDate() !== lastDay) { lastDay = t.getDate(); load(); }
  // 2분 넘게 못 받아오면 표시
  if (lastOk && t - lastOk > 120_000) $('updated').textContent = `${hm(lastOk)} 기준 · 연결을 다시 시도하는 중`;
}

tick();
setInterval(tick, 1000);
load();
setInterval(load, 30_000);
