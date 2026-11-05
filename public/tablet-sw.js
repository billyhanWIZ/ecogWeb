// 세척기 태블릿 오프라인 대비: 인터넷이 끊긴 채 태블릿을 다시 켜도 화면이 뜨게 한다.
// 태블릿 화면(/t)과 그 화면이 쓰는 파일만 다룬다. API 와 관리 화면은 건드리지 않는다.
const CACHE = 'ecog-tablet-v1';
const PAGE = '/t';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function mine(url) {
  if (url.origin !== self.location.origin) return url.hostname === 'cdn.jsdelivr.net'; // 글꼴
  const p = url.pathname;
  if (p.startsWith('/api/')) return false;
  if (p === '/t' || p === '/t/') return true;
  return p.startsWith('/tablet/') || p.startsWith('/img/ecog-logo') || /^\/v\/[^/]+\/(js\/tablet\/|js\/wx\.js|css\/tablet\.css)/.test(p);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!mine(url) || req.headers.has('range')) return; // 영상 구간 요청은 브라우저에 맡긴다
  const isPage = url.pathname === '/t' || url.pathname === '/t/';
  if (isPage) {
    // 화면: 인터넷 먼저 (배포하면 바로 새 화면), 안 되면 저장해 둔 것
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(PAGE, copy)); }
      return res;
    }).catch(() => caches.match(PAGE)));
    return;
  }
  // 버전이 붙은 파일·사진: 저장해 둔 것 먼저
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
