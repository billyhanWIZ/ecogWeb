// 사이니지: 1분마다 숫자를 새로 받아온다
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
    $('updated').textContent = `${d.updatedAt} 기준`;
  } catch (e) {
    if (e.message === '404') $('err').hidden = false;
  }
}

load();
setInterval(load, 60_000);
