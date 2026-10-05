#!/usr/bin/env bash
# Atualiza o piloto local (projeto alfa-piloto-local, configurado em deploy/.env.piloto) para a versão desta pasta.
# Faz backup do banco antes, aplica as migrations novas e reinicia. Os cadastros existentes são preservados.
# Uso, na pasta do projeto, sem sudo:  bash deploy/piloto/atualizar.sh
set -euo pipefail

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
[ -f deploy/.env.piloto ] || fail 'não encontrei deploy/.env.piloto. O piloto local foi configurado nesta pasta? Veja deploy/PILOTO-LOCAL.md.'
command -v docker >/dev/null || fail 'o Docker não está instalado.'
docker info >/dev/null 2>&1 || fail 'o Docker não está rodando, ou o seu usuário não tem permissão para usá-lo.'
P=(docker compose --env-file deploy/.env.piloto -p alfa-piloto-local -f deploy/compose.yml -f deploy/compose.piloto.yml)
PORT=$(sed -n "s/^HTTP_PORT='\{0,1\}\([0-9]*\)'\{0,1\}$/\1/p" deploy/.env.piloto)
PORT=${PORT:-8080}

say 'Banco do piloto'
"${P[@]}" up -d --wait postgres

say 'Backup antes de atualizar'
install -d -m 700 deploy/backups
BACKUP=deploy/backups/piloto-$(date +%Y%m%d-%H%M%S).dump
"${P[@]}" exec -T postgres pg_dump -U postgres -Fc alfa_gestao > "$BACKUP"
[ -s "$BACKUP" ] || fail 'o backup ficou vazio; nada foi atualizado.'
chmod 600 "$BACKUP"
echo "Backup: $BACKUP"

say 'Montando as imagens da versão nova (alguns minutos)'
"${P[@]}" --profile setup build
# Janela de manutenção: a API nova só sobe depois das migrations.
"${P[@]}" stop api frontend >/dev/null 2>&1 || true
say 'Migrations novas'
"${P[@]}" --profile setup run --rm setup
say 'API e interface'
"${P[@]}" up -d --wait postgres api frontend

curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/ready" >/dev/null || fail "o piloto subiu, mas http://127.0.0.1:$PORT não responde."
printf '\n\033[1;32mPRONTO: piloto atualizado em http://127.0.0.1:%s\033[0m\n' "$PORT"
echo 'Para a reunião, abra o acesso pela internet com:  bash deploy/piloto/tunel.sh'
