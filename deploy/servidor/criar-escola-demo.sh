#!/usr/bin/env bash
# Cria uma escola de demonstração com o seu administrador e já prepara os dados de exemplo
# (período, turmas T1 e T2, site publicado e horários de visita). Cada escola só vê os próprios dados.
#
# Uso, na pasta do projeto:
#   no servidor, como root, depois de deploy/servidor/instalar.sh:
#     bash deploy/servidor/criar-escola-demo.sh "Escola Demonstração Ana" ana@exemplo.test
#   no piloto local (deploy/PILOTO-LOCAL.md), sem sudo:
#     bash deploy/servidor/criar-escola-demo.sh --piloto "Escola Demonstração Ana" ana@exemplo.test
# A senha é pedida no terminal. Use só dados fictícios.
set -euo pipefail

fail() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }
PILOT=false
if [ "${1:-}" = --piloto ]; then PILOT=true; shift; fi
[ "$#" = 2 ] || fail 'uso: bash deploy/servidor/criar-escola-demo.sh [--piloto] "Nome da escola" email@exemplo.test'
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
if $PILOT; then
  [ -f deploy/.env.piloto ] || fail 'não encontrei deploy/.env.piloto. Veja deploy/PILOTO-LOCAL.md.'
  COMPOSE=(docker compose --env-file deploy/.env.piloto -p alfa-piloto-local -f deploy/compose.yml -f deploy/compose.piloto.yml)
  PORT=$(sed -n "s/^HTTP_PORT='\{0,1\}\([0-9]*\)'\{0,1\}$/\1/p" deploy/.env.piloto)
  URL=http://127.0.0.1:${PORT:-8080}
else
  [ -f deploy/.env ] || fail 'rode primeiro deploy/servidor/instalar.sh.'
  COMPOSE=(docker compose --env-file deploy/.env -f deploy/compose.yml)
  URL=http://127.0.0.1:8080
fi
SCHOOL=$1
EMAIL=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')

read -r -s -p 'Senha do administrador (12 a 72 caracteres): ' PASSWORD; echo
read -r -s -p 'Confirme a senha: ' CONFIRM; echo
[ "$PASSWORD" = "$CONFIRM" ] || fail 'as senhas não conferem.'
[ "${#PASSWORD}" -ge 12 ] || fail 'a senha precisa de pelo menos 12 caracteres.'

# A senha vai pelo ambiente, nunca pela linha de comando.
SCHOOL_NAME=$SCHOOL ADMIN_EMAIL=$EMAIL ADMIN_PASSWORD=$PASSWORD \
  "${COMPOSE[@]}" --profile setup run --rm -e SCHOOL_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD setup node scripts/bootstrap-school.js
ALFA_SENHA=$PASSWORD python3 deploy/servidor/dados-demo.py --email "$EMAIL" --url "$URL"
