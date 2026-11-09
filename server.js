import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import helmet from 'helmet';
import compression from 'compression';
import cookieSession from 'cookie-session';
import { config } from './src/config.js';
import { pool } from './src/db.js';
import { loadUser } from './src/lib/auth.js';
import { errorHandler } from './src/lib/http.js';
import authRoutes from './src/routes/auth.js';
import dashboardRoutes from './src/routes/dashboard.js';
import statsRoutes from './src/routes/stats.js';
import deviceRoutes from './src/routes/devices.js';
import orgRoutes from './src/routes/orgs.js';
import userRoutes from './src/routes/users.js';
import settingRoutes from './src/routes/settings.js';
import reportRoutes from './src/routes/reports.js';
import signageRoutes from './src/routes/signage.js';
import tabletRoutes from './src/routes/tablet.js';

const app = express();
app.set('trust proxy', 1); // nginx 뒤에서 https 판단
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://cdn.jsdelivr.net'], // 글꼴 CSS 의 source map
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '200kb' }));
app.use(cookieSession({
  name: 'ecog_sess',
  keys: [config.sessionSecret],
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  maxAge: 12 * 3600_000,
}));
// 활동 중이면 세션 연장
app.use((req, _res, next) => {
  if (req.session?.uid) req.session.t = Math.floor(Date.now() / 60_000);
  next();
});
app.use(loadUser);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});
for (const r of [authRoutes, dashboardRoutes, statsRoutes, deviceRoutes, orgRoutes, userRoutes, settingRoutes, reportRoutes, signageRoutes, tabletRoutes]) app.use('/api', r);
app.use('/api', (_req, res) => res.status(404).json({ error: '없는 API 입니다' }));
app.use('/api', errorHandler);

const pub = path.join(config.root, 'public');

// 배포 버전: 화면 코드 주소에 넣어(/v/<버전>/js/...) 배포하면 브라우저가 무조건 새 파일을 받게 한다.
// ES 모듈의 상대 import 도 같은 /v/<버전>/ 아래로 풀리므로 나중에 불러오는 화면 코드까지 함께 바뀐다.
let VERSION;
try {
  VERSION = execSync('git rev-parse --short HEAD', { cwd: config.root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  VERSION = Date.now().toString(36);
}
if (!config.isProd) VERSION = `${VERSION}-${Date.now().toString(36)}`; // 개발 중엔 재시작마다 새로
app.locals.version = VERSION; // 태블릿이 신호 응답으로 받아, 다르면 화면을 새로 불러온다

const pageCache = new Map();
function sendPage(res, file) {
  let html = config.isProd ? pageCache.get(file) : null;
  if (!html) {
    html = fs.readFileSync(path.join(pub, file), 'utf8').replaceAll('__V__', VERSION);
    pageCache.set(file, html);
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
}

// 버전이 붙은 주소는 내용이 바뀌지 않으니 오래 캐시
app.use('/v/:ver', express.static(pub, { index: false, immutable: true, maxAge: '365d' }));
// 버전 없는 주소(사진·로고·지도 등)
app.use(express.static(pub, {
  index: false,
  cacheControl: false,
  setHeaders: (res, file) => {
    res.setHeader('Cache-Control', /\.(js|css|html)$/.test(file) || !config.isProd ? 'no-cache' : 'public, max-age=86400');
  },
}));
app.get('/login', (_req, res) => sendPage(res, 'login.html'));
app.get('/s/:token', (_req, res) => sendPage(res, 'signage.html')); // 로그인 없는 사이니지
app.get(['/t', '/t/'], (_req, res) => sendPage(res, 'tablet.html')); // 세척기 태블릿 (웹·APK 공용)
app.get('/', (req, res) => (req.user ? sendPage(res, 'index.html') : res.redirect('/login')));
app.use((_req, res) => res.status(404).send('Not found'));

app.listen(config.port, config.host, () => {
  console.log(`ecoG 2.0 listening on http://${config.host}:${config.port}`);
});
