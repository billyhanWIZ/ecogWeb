// 날씨 키 확인: node scripts/weather-check.js [지역]   (예: node scripts/weather-check.js 진주시)
import 'dotenv/config';
import { resolvePlace, nearestName, weatherFor } from '../src/lib/weather.js';

const place = process.argv.slice(2).join(' ') || '서울 중구';
const loc = resolvePlace(place);
if (!loc) { console.error(`위치를 찾지 못했습니다: ${place}`); process.exit(1); }
if (!process.env.KMA_APIHUB_KEY && !process.env.KMA_SERVICE_KEY) { console.error('.env 에 KMA_APIHUB_KEY 또는 KMA_SERVICE_KEY 가 없습니다'); process.exit(1); }
console.log(`${process.env.KMA_APIHUB_KEY ? 'API허브' : '공공데이터포털'} 키로 ${nearestName(loc.lat, loc.lng)} 날씨 조회…`);
const w = await weatherFor({ ...loc, label: place });
if (w) console.log('성공:', w);
else console.log('실패: 위의 [weather] 메시지를 확인하세요 (키 승인 직후면 1시간쯤 뒤 다시)');
process.exit(w ? 0 : 1);
