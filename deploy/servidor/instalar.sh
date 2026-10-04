#!/usr/bin/env bash
# Instala ou atualiza o Alfa Gestão Escolar num servidor Ubuntu 24.04 (por exemplo, uma VPS da Hostinger),
# com HTTPS automático pelo Caddy. Guia completo: deploy/NO-AR.md.
#
# Uso, como root, na pasta do projeto:
#   bash deploy/servidor/instalar.sh alfagestao.com.br   # domínio já apontado para o IP deste servidor
#   bash deploy/servidor/instalar.sh                     # sem domínio: usa <ip>.sslip.io
#
# Rodar de novo atualiza o sistema: faz backup do banco, aplica as migrations novas e reinicia.
set -euo pipefail

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail 'rode como root (ou com sudo).'
. /etc/os-release
[ "${ID:-}" = ubuntu ] || fail 'este script foi feito para Ubuntu 24.04.'
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
[ -f "$ROOT/deploy/compose.yml" ] || fail "não encontrei deploy/compose.yml em $ROOT."
cd "$ROOT"

IP=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
[ -n "$IP" ] || fail 'não consegui descobrir o IP deste servidor.'
DOMAIN=$(printf '%s' "${1:-${IP//./-}.sslip.io}" | tr '[:upper:]' '[:lower:]')
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fail "domínio inválido: $DOMAIN"
ORIGIN="https://$DOMAIN"
COMPOSE=(docker compose --env-file deploy/.env -f deploy/compose.yml)

# O certificado HTTPS só sai se o domínio já apontar para este servidor.
RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk 'NR == 1 { print $1 }' || true)
[ "$RESOLVED" = "$IP" ] || fail "o domínio $DOMAIN aponta para '${RESOLVED:-nenhum IP}', e este servidor é $IP.
Crie o registro A do domínio para $IP e espere alguns minutos, ou rode sem domínio para usar ${IP//./-}.sslip.io."
# Um registro AAAA (IPv6) apontando para outro lugar também impede o certificado: o Let's Encrypt prefere o IPv6.
IP6=$(ip -6 route get 2606:4700:4700::1111 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)
AAAA=$(python3 -c 'import socket, sys
try: print(" ".join(sorted({a[4][0] for a in socket.getaddrinfo(sys.argv[1], 443, socket.AF_INET6)})))
except OSError: pass' "$DOMAIN")
if [ -n "$AAAA" ] && [[ " $AAAA " != *" ${IP6:-sem-ipv6} "* ]]; then
  fail "o domínio $DOMAIN tem registro AAAA (IPv6) para '$AAAA', que não é este servidor.
Apague o registro AAAA do domínio no painel de DNS (ou aponte para ${IP6:-o IPv6 deste servidor}) e espere alguns minutos."
fi

say 'Pacotes do sistema'
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git gnupg python3 ufw debian-keyring debian-archive-keyring apt-transport-https

if ! command -v docker >/dev/null; then
  say 'Docker'
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null || fail 'o Docker Compose não está disponível.'

if ! command -v caddy >/dev/null; then
  say 'Caddy (HTTPS automático)'
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

if ! swapon --show | grep -q .; then
  say 'Memória extra (2 GB de swap) para montar as imagens'
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say 'Firewall: só SSH, HTTP e HTTPS'
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

if [ ! -f deploy/.env ]; then
  say 'Escola e administrador iniciais (use dados fictícios)'
  echo "Quando perguntar a origem pública, só aperte Enter para usar $ORIGIN."
  ALFA_ORIGEM_SUGERIDA="$ORIGIN" python3 deploy/configure.py
else
  # A origem pública não é segredo; muda quando o sistema troca de endereço (por exemplo, de sslip.io para o domínio).
  sed -i "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN='$ORIGIN'#" deploy/.env
fi
chmod 600 deploy/.env

if docker volume inspect alfa-mvp_mvpdata >/dev/null 2>&1; then
  say 'Backup do banco antes de atualizar'
  "${COMPOSE[@]}" up -d --wait postgres
  install -d -m 700 /var/backups/alfa-gestao
  BACKUP=/var/backups/alfa-gestao/alfa-$(date +%Y%m%d-%H%M%S).dump
  "${COMPOSE[@]}" exec -T postgres pg_dump -U postgres -Fc alfa_gestao > "$BACKUP"
  [ -s "$BACKUP" ] || fail 'o backup ficou vazio; nada foi atualizado.'
  chmod 600 "$BACKUP"
  echo "Backup: $BACKUP"
fi

say 'Montando as imagens (alguns minutos na primeira vez)'
"${COMPOSE[@]}" --profile setup build
"${COMPOSE[@]}" up -d --wait postgres
# Janela de manutenção: a API nova só sobe depois das migrations.
"${COMPOSE[@]}" stop api frontend >/dev/null 2>&1 || true
say 'Migrations, roles do banco e escola inicial'
"${COMPOSE[@]}" --profile setup run --rm setup
say 'API e interface'
"${COMPOSE[@]}" up -d --wait api frontend

say "HTTPS para $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
# Gerado por deploy/servidor/instalar.sh. Certificado HTTPS automático (Let's Encrypt).
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

say 'Conferindo o acesso pela internet'
for _ in $(seq 1 45); do
  if curl -fsS --max-time 5 "$ORIGIN/api/ready" >/dev/null 2>&1; then
    printf '\n\033[1;32mPRONTO: %s\033[0m\n' "$ORIGIN"
    echo 'Entre com o e-mail e a senha do administrador definidos na configuração.'
    echo "Dados de demonstração: python3 deploy/servidor/dados-demo.py --email SEU_EMAIL"
    exit 0
  fi
  sleep 2
done
fail "o sistema subiu, mas $ORIGIN ainda não responde pela internet. Veja: journalctl -u caddy --no-pager | tail -40"
