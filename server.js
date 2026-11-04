import express from 'express';
import path from 'node:path';
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
      connectSrc: ["'self'"],
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
for (const r of [authRoutes, dashboardRoutes, statsRoutes, deviceRoutes, orgRoutes, userRoutes, settingRoutes, reportRoutes, signageRoutes]) app.use('/api', r);
app.use('/api', (_req, res) => res.status(404).json({ error: '없는 API 입니다' }));
app.use('/api', errorHandler);

const pub = path.join(config.root, 'public');
// 화면 코드(js·css·html)는 매번 서버에 바뀌었는지 묻는다(ETag) → 배포하면 바로 반영.
// 사진·로고·지도·라이브러리처럼 거의 안 바뀌는 파일만 하루 캐시.
app.use(express.static(pub, {
  index: false,
  setHeaders: (res, file) => {
    if (/\.(js|css|html)$/.test(file) && !file.includes(`${path.sep}vendor${path.sep}`)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', config.isProd ? 'public, max-age=86400' : 'no-cache');
  },
}));
app.get('/login', (_req, res) => res.sendFile(path.join(pub, 'login.html')));
app.get('/s/:token', (_req, res) => res.sendFile(path.join(pub, 'signage.html'))); // 로그인 없는 사이니지
app.get('/', (req, res) => (req.user ? res.sendFile(path.join(pub, 'index.html')) : res.redirect('/login')));
app.use((_req, res) => res.status(404).send('Not found'));

app.listen(config.port, config.host, () => {
  console.log(`ecoG 2.0 listening on http://${config.host}:${config.port}`);
});
