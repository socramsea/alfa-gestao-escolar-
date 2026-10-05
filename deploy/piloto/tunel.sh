#!/usr/bin/env bash
# Abre o piloto local para a internet, com HTTPS, por um túnel gratuito da Cloudflare (sem conta e sem domínio).
# Mostra o endereço da reunião e mantém o acesso aberto enquanto este terminal estiver aberto. Ctrl+C fecha.
# O endereço muda a cada vez que o túnel é aberto. Uso, na pasta do projeto:  bash deploy/piloto/tunel.sh
set -euo pipefail

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
[ -f deploy/.env.piloto ] || fail 'não encontrei deploy/.env.piloto. Veja deploy/PILOTO-LOCAL.md.'
PORT=$(sed -n "s/^HTTP_PORT='\{0,1\}\([0-9]*\)'\{0,1\}$/\1/p" deploy/.env.piloto)
PORT=${PORT:-8080}
curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/ready" >/dev/null \
  || fail "o piloto não responde em http://127.0.0.1:$PORT. Rode antes: bash deploy/piloto/atualizar.sh"

if ! command -v cloudflared >/dev/null; then
  say 'Instalando o cloudflared, da Cloudflare (vai pedir a sua senha do computador)'
  ARCH=$(dpkg --print-architecture)
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/cloudflared.deb" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb"
  sudo dpkg -i "$TMP/cloudflared.deb"
  rm -rf "$TMP"
fi

say 'Abrindo o túnel'
LOG=$(mktemp)
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$LOG" 2>&1 &
PID=$!
INHIBIT_PID=''
closed() {
  if kill "$PID" 2>/dev/null; then wait "$PID" 2>/dev/null || true; fi
  [ -z "$INHIBIT_PID" ] || kill "$INHIBIT_PID" 2>/dev/null || true
  rm -f "$LOG"
  echo
  echo 'Túnel fechado: o sistema não está mais acessível pela internet.'
}
trap closed EXIT
trap 'exit 0' INT TERM

# Enquanto o túnel estiver aberto, o computador não suspende (quando o sistema permitir).
if command -v systemd-inhibit >/dev/null; then
  systemd-inhibit --what=idle:sleep --who=alfa-gestao --why='Túnel da reunião aberto' \
    tail --pid="$PID" -f /dev/null >/dev/null 2>&1 &
  INHIBIT_PID=$!
fi

URL=''
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -n 1 || true)
  [ -n "$URL" ] && break
  kill -0 "$PID" 2>/dev/null || { cat "$LOG"; fail 'o cloudflared parou antes de abrir o túnel.'; }
  sleep 1
done
[ -n "$URL" ] || { cat "$LOG"; fail 'o túnel não informou o endereço em 60 segundos.'; }

# Consultar o endereço antes de ele existir faz o computador guardar "não existe" por um tempo.
# Por isso, só depois da conexão com a Cloudflare e de alguns segundos.
for _ in $(seq 1 30); do
  grep -q 'Registered tunnel connection' "$LOG" && break
  kill -0 "$PID" 2>/dev/null || { cat "$LOG"; fail 'o cloudflared parou antes de abrir o túnel.'; }
  sleep 1
done
sleep 5
echo 'Conferindo se o endereço responde pela internet…'
READY=false
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 "$URL/api/ready" >/dev/null 2>&1; then READY=true; break; fi
  sleep 3
done

printf '\n\033[1;32m=================================================================\033[0m\n'
printf '\033[1;32m  ENDEREÇO DA REUNIÃO: %s\033[0m\n' "$URL"
printf '\033[1;32m=================================================================\033[0m\n\n'
echo '- Use este endereço também no seu computador: os links da matrícula e do site saem com ele.'
echo '- Site da escola: este endereço + /escola/<endereço do site>.'
echo '- Deixe este terminal aberto e o computador na tomada e conectado. Ctrl+C fecha o acesso.'
echo '- Se fechar e abrir de novo, o endereço muda.'
if ! $READY; then
  printf '\n\033[1;33mATENÇÃO: daqui do computador o endereço ainda não respondeu.\033[0m\n'
  echo 'Abra no celular, fora do Wi-Fi. Se lá funcionar, rode "resolvectl flush-caches" e tente de novo no computador.'
fi
wait "$PID" || true
tail -n 20 "$LOG"
fail 'o túnel caiu. Rode de novo: bash deploy/piloto/tunel.sh. O endereço será outro.'
