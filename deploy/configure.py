"""Configuração interativa local. Não imprime nem sobrescreve segredos."""
import getpass
import os
from pathlib import Path
import secrets
from urllib.parse import urlparse

target = Path(__file__).with_name('.env')
if target.exists():
    raise SystemExit('deploy/.env já existe; configuração preservada.')
school = input('Nome da escola de teste: ').strip()
email = input('E-mail do administrador: ').strip().lower()
password = getpass.getpass('Senha do administrador (12 a 72 bytes): ')
confirmation = getpass.getpass('Confirme a senha: ')
# deploy/servidor/instalar.sh sugere a origem HTTPS do domínio; localmente, o padrão continua localhost.
default_origin = os.environ.get('ALFA_ORIGEM_SUGERIDA', 'http://localhost:8080')
origin = input(f'Origem pública [{default_origin}]: ').strip() or default_origin
if not school or '@' not in email or not 12 <= len(password.encode()) <= 72 or password != confirmation:
    raise SystemExit('Dados inválidos; nenhum arquivo criado.')
parsed = urlparse(origin)
if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username:
    raise SystemExit('Origem inválida.')
values = {key: secrets.token_hex(32) for key in ('POSTGRES_PASSWORD','APP_PASSWORD','AUTH_PASSWORD','JWT_SECRET')}
values.update(SCHOOL_NAME=school, ADMIN_NAME='Administrador escolar', ADMIN_EMAIL=email,
              ADMIN_PASSWORD=password, PUBLIC_ORIGIN=origin.rstrip('/'), HTTP_PORT='8080')
# Aspas simples no formato dotenv do Compose evitam interpolação de $.
if any(any(c in value for c in ("'", '\n', '\r', '\0')) for value in values.values()):
    raise SystemExit('Nesta configuração não use apóstrofo, NUL ou quebra de linha.')
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    for key, value in values.items():
        output.write(f"{key}='{value}'\n")
print('deploy/.env criado com permissão 0600; segredos não exibidos.')
