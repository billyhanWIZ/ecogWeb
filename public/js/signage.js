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
    lastOk = new Date();
    $('updated').textContent = `${hm(lastOk)} 기준`;
  } catch (e) {
    if (e.message === '404') $('err').hidden = false;
  }
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
