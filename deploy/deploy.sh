#!/usr/bin/env bash
# 평소 배포: 개발 PC 에서 git push 한 뒤 서버에서 실행
#   cd /opt/ecog && bash deploy/deploy.sh
# 되돌리기: bash deploy/deploy.sh --rollback   (직전 배포 태그로)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; PORT="${PORT:-3100}"

if [[ "${1:-}" == "--rollback" ]]; then
  PREV="$(git tag -l 'deploy-*' --sort=-creatordate | sed -n 2p)"
  [[ -z "$PREV" ]] && { echo "되돌릴 이전 배포가 없습니다"; exit 1; }
  echo "== $PREV 로 되돌립니다 =="
  git checkout -q "$PREV"
else
  [[ -n "$(git status --porcelain --untracked-files=no)" ]] && { echo "서버에서 고친 파일이 있습니다. git status 확인 후 다시 실행하세요"; exit 1; }
  git checkout -q main
  git pull --ff-only
fi

npm ci --omit=dev --no-audit --no-fund
node scripts/db-migrate.js
pm2 reload ecog --update-env

sleep 2
if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  if [[ "${1:-}" != "--rollback" ]]; then
    TAG="deploy-$(date +%Y%m%d-%H%M%S)"
    git tag "$TAG"
    echo "== 배포 완료: $(git log -1 --format='%h %s') ($TAG) =="
  else
    echo "== 되돌리기 완료. 다시 최신으로: git checkout main && bash deploy/deploy.sh =="
  fi
else
  echo "!! 앱이 응답하지 않습니다. pm2 logs ecog 확인. 되돌리기: bash deploy/deploy.sh --rollback"
  exit 1
fi
