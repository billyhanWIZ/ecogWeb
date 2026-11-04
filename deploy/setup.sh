#!/usr/bin/env bash
# ecoG 2.0 서버 최초 설치 (한 번만). 저장소를 /opt/ecog 에 clone 한 뒤 root 로 실행.
#
#   sudo bash deploy/setup.sh ecog.jnwiz.com admin@example.com --check   # 바꾸지 않고 점검만
#   sudo bash deploy/setup.sh ecog.jnwiz.com admin@example.com           # 설치
#
# 하는 일: Node 20·pm2 설치(없을 때), .env 준비, DB 테이블 생성, 웹서버(nginx 또는 Apache) 도메인 설정,
#          Let's Encrypt 인증서, pm2 등록. 기존 Tomcat(restapi) 과 다른 서비스 설정은 건드리지 않는다.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
MODE="${3:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-3100}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "사용: sudo bash deploy/setup.sh <도메인> <이메일> [--check]"; exit 1
fi

ok()   { echo -e "  \033[32m✔\033[0m $*"; }
warn() { echo -e "  \033[33m!\033[0m $*"; }
fail() { echo -e "  \033[31m✘\033[0m $*"; }

echo "== 점검 =="
echo "  설치 위치: $APP_DIR, 앱 포트: $PORT"
case "$APP_DIR" in
  /usr/local/webapps*|*/webapps/*) fail "Tomcat 배포 폴더 안입니다. /opt/ecog 처럼 다른 곳에 clone 하세요 (.env 가 웹에 노출될 수 있음)"; exit 1 ;;
  *) ok "Tomcat 배포 폴더 밖에 있음" ;;
esac

WEB=""
if command -v ss >/dev/null; then
  OWNER80="$(ss -ltnp 2>/dev/null | awk '$4 ~ /:80$/ {print $NF}' | head -1)"
  echo "  80 포트 사용 중: ${OWNER80:-없음}"
  echo "  443 포트 사용 중: $(ss -ltnp 2>/dev/null | awk '$4 ~ /:443$/ {print $NF}' | head -1 || true)"
  if ss -ltnp 2>/dev/null | grep -q ":$PORT "; then warn "$PORT 포트를 이미 누가 쓰고 있습니다. .env 의 PORT 를 바꾸세요"; else ok "$PORT 포트 비어 있음"; fi
  [[ "$OWNER80" == *nginx* ]] && WEB=nginx
  [[ "$OWNER80" == *apache* || "$OWNER80" == *httpd* ]] && WEB=apache
fi
if [[ -z "$WEB" ]]; then
  command -v nginx >/dev/null && WEB=nginx
  [[ -z "$WEB" ]] && (command -v apache2 >/dev/null || command -v httpd >/dev/null) && WEB=apache
fi
[[ -n "$WEB" ]] && ok "웹서버: $WEB" || warn "웹서버가 없습니다. 설치 단계에서 nginx 를 설치합니다"

PUBIP="$(curl -s -4 --max-time 5 https://ifconfig.me || true)"
DNSIP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
if [[ -n "$DNSIP" && "$DNSIP" == "$PUBIP" ]]; then ok "DNS $DOMAIN → $DNSIP (이 서버)"; else warn "DNS $DOMAIN → ${DNSIP:-없음}, 이 서버 IP ${PUBIP:-확인 불가}. 인증서 발급 전에 DNS A 레코드를 맞추세요"; fi
command -v node >/dev/null && ok "Node $(node -v)" || warn "Node 없음 (설치 단계에서 설치)"
[[ -f "$APP_DIR/.env" ]] && ok ".env 있음" || warn ".env 없음 (설치 단계에서 만들고 멈춤)"

[[ "$MODE" == "--check" ]] && { echo "== --check: 아무것도 바꾸지 않았습니다 =="; exit 0; }
[[ $EUID -ne 0 ]] && { fail "root 로 실행하세요 (sudo)"; exit 1; }

echo "== 설치 =="
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2
# PDF 리포트(3단계)에 쓸 한글 폰트
apt-get install -y fonts-noto-cjk >/dev/null 2>&1 || warn "fonts-noto-cjk 설치 실패 (PDF 단계 전에 다시 설치)"

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  fail ".env 를 만들었습니다. DB 접속 정보(DB_USER, DB_PASSWORD, DB_NAME)를 채운 뒤 다시 실행하세요: $APP_DIR/.env"
  exit 1
fi

mkdir -p /var/log/ecog "$APP_DIR/data/logos"
cd "$APP_DIR"
npm ci --omit=dev
node scripts/db-migrate.js

if [[ "$WEB" == "" ]]; then apt-get install -y nginx; WEB=nginx; fi
if [[ "$WEB" == "nginx" ]]; then
  CONF="/etc/nginx/conf.d/ecog-$DOMAIN.conf"
  cat > "$CONF" <<NGX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 2m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGX
  nginx -t && systemctl reload nginx
  ok "nginx 설정: $CONF"
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || warn "인증서 발급 실패. DNS 를 확인한 뒤: certbot --nginx -d $DOMAIN"
else
  a2enmod proxy proxy_http headers >/dev/null
  CONF="/etc/apache2/sites-available/ecog-$DOMAIN.conf"
  cat > "$CONF" <<APA
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "http"
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
</VirtualHost>
APA
  a2ensite "ecog-$DOMAIN" >/dev/null && apache2ctl configtest && systemctl reload apache2
  ok "Apache 설정: $CONF"
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-apache
  certbot --apache -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || warn "인증서 발급 실패. DNS 를 확인한 뒤: certbot --apache -d $DOMAIN"
fi

pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true
sleep 2
curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && ok "앱 응답 확인" || fail "앱이 응답하지 않습니다: pm2 logs ecog"

echo
echo "다음 단계: 구 데이터 이관 (먼저 --dry-run 으로 확인)"
echo "  node scripts/migrate-legacy.js --dry-run"
echo "  node scripts/migrate-legacy.js --admin-id admin --admin-pw '<초기 비밀번호>'"
echo "  https://$DOMAIN 에서 로그인"
