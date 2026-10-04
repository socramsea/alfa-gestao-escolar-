#!/usr/bin/env python3
"""Prepara uma escola para a demonstração, pela API e só com dados fictícios.

Cria o que ainda não existir:
- período 2027, séries Infantil 4 e 5, turno da manhã e turmas T1 e T2,
  as mesmas da planilha docs/exemplos/planilha-alunos-ficticia.xlsx;
- o site da escola, publicado;
- horários de visita nos próximos dias úteis.

Pode rodar de novo: o que já existe fica como está.

Uso no servidor:  python3 deploy/servidor/dados-demo.py --email admin@exemplo.test
A senha é pedida no terminal ou lida de ALFA_SENHA.
"""
import argparse
import datetime
import getpass
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import uuid


def call(base, path, token=None, data=None):
    headers = {'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    body = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(f'{base}/api/{path}', data=body, headers=headers,
                                     method='GET' if data is None else 'POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b'null')
        except ValueError:
            return error.code, None


def items(base, token, path):
    found, page = [], 1
    while True:
        status, data = call(base, f'{path}?page={page}', token)
        if status != 200:
            raise SystemExit(f'Falha ao consultar {path} ({status}).')
        found += data['items']
        if not data['has_more']:
            return found
        page += 1


def ensure(base, token, path, data, match):
    """Cria o registro se nenhum existente satisfizer match."""
    existing = next((item for item in items(base, token, path) if match(item)), None)
    if existing:
        return existing, False
    status, result = call(base, path, token, data)
    if status not in (200, 201):
        raise SystemExit(f'Falha ao criar {path} ({status}): {result}')
    return result['item'], True


def slugify(name):
    text = unicodedata.normalize('NFD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', text)).strip('-')[:50] or 'escola-demo'


def site_content(school):
    return {
        'hero': {'title': f'Bem-vindo à {school}'[:120], 'image_id': None,
                 'subtitle': 'Educação infantil com acolhimento, rotina e parceria com as famílias. Escola fictícia, para demonstração.'},
        'about': {'title': 'Sobre a escola',
                  'text': 'Somos uma escola de educação infantil que acompanha cada criança de perto, com turmas pequenas e comunicação diária com as famílias.'},
        'highlights': [
            {'title': 'Turmas pequenas', 'text': 'Até 16 crianças por turma, com professora e auxiliar.'},
            {'title': 'Matrícula sem papel', 'text': 'A família completa a ficha pelo celular, com um link pelo WhatsApp.'},
            {'title': 'Parque e horta', 'text': 'Atividades ao ar livre todos os dias.'}],
        'routine': [
            {'title': '7h30 — Acolhida', 'text': 'Chegada, brincadeira livre e roda de conversa.'},
            {'title': '9h — Projetos', 'text': 'Atividades de linguagem, artes e natureza.'},
            {'title': '11h30 — Saída', 'text': 'Entrega das crianças às famílias.'}],
        'levels': [
            {'name': 'Infantil 4', 'ages': '4 anos', 'shifts': 'Manhã', 'description': 'Turma T1.'},
            {'name': 'Infantil 5', 'ages': '5 anos', 'shifts': 'Manhã', 'description': 'Turma T2.'}],
        'uniform': {'intro': 'O uniforme identifica a criança nos passeios e protege a roupa do dia a dia.',
                    'where_to_buy': 'Na secretaria da escola.',
                    'items': [
                        {'name': 'Camiseta', 'description': 'Algodão, com o logo da escola.', 'price': 'R$ 45,00', 'required': True, 'image_id': None},
                        {'name': 'Bermuda', 'description': 'Moletom leve, azul.', 'price': 'R$ 55,00', 'required': True, 'image_id': None},
                        {'name': 'Agasalho', 'description': 'Para os dias frios.', 'price': 'R$ 120,00', 'required': False, 'image_id': None}]},
        'faq': [
            {'question': 'Tem período integral?', 'answer': 'Nesta escola de demonstração, só o período da manhã.'},
            {'question': 'Como faço a matrícula?', 'answer': 'Preencha a pré-matrícula aqui no site. A secretaria envia o link da ficha pelo WhatsApp.'}],
        'location': {'address': 'Rua Fictícia, 100 — Centro', 'opening_hours': 'Segunda a sexta, das 7h às 18h'},
        'contact': {'whatsapp': '(11) 90000-0000', 'email': 'contato@escola-demo.test', 'instagram': None},
        'enrollment': {'open': True, 'year': 2027, 'intro': 'Matrículas abertas para 2027. Agende uma visita.'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--email', required=True, help='e-mail do administrador da escola')
    parser.add_argument('--url', default='http://127.0.0.1:8080', help='endereço do sistema (padrão: no próprio servidor)')
    parser.add_argument('--endereco-site', help='endereço público do site, por exemplo escola-demo (padrão: o nome da escola)')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    password = os.environ.get('ALFA_SENHA') or getpass.getpass('Senha do administrador: ')

    status, login = call(base, 'auth/login', data={'email': args.email.strip().lower(), 'password': password})
    if status != 200:
        raise SystemExit('Login recusado: confira o e-mail e a senha.' if status == 401 else f'Falha no login ({status}).')
    token = login['token']
    status, schools = call(base, 'schools', token)
    school = schools['schools'][0]['name'] if status == 200 and schools.get('schools') else 'Escola de Demonstração'
    print(f'Escola: {school}')

    status, result = call(base, 'structure/stages', token, {'code': 'infantil'})
    if status not in (200, 201, 409):
        raise SystemExit(f'Falha ao cadastrar a etapa ({status}).')
    year, made = ensure(base, token, 'structure/academic-years', {'code': '2027', 'starts_on': '2027-02-01', 'ends_on': '2027-12-17'},
                        lambda y: y['code'] == '2027')
    print(f"Período 2027: {'criado' if made else 'já existia'}")
    shift, _ = ensure(base, token, 'structure/shifts', {'code': 'MANHA', 'name': 'Manhã'}, lambda s: s['code'] == 'MANHA')
    levels = {}
    for code, name in (('G4', 'Infantil 4'), ('G5', 'Infantil 5')):
        levels[code], _ = ensure(base, token, 'structure/levels', {'stage_code': 'infantil', 'code': code, 'name': name},
                                 lambda level, code=code: level['code'] == code)
    for code, level in (('T1', 'G4'), ('T2', 'G5')):
        _, made = ensure(base, token, 'structure/class-groups',
                         {'code': code, 'stage_code': 'infantil', 'academic_year_id': year['id'], 'shift_id': shift['id'],
                          'level_ids': [levels[level]['id']]},
                         lambda g, code=code: g['code'] == code and g['academic_year_id'] == year['id'])
        print(f"Turma {code} ({levels[level]['name']}): {'criada' if made else 'já existia'}")

    status, site = call(base, 'admissions/site', token)
    if status != 200:
        raise SystemExit(f'Falha ao consultar o site ({status}).')
    slug = site['address']['slug'] if site.get('address') else None
    if not slug:
        wanted = slugify(args.endereco_site or school)
        for candidate in (wanted, f'{wanted[:44]}-{uuid.uuid4().hex[:5]}'):
            status, _ = call(base, 'admissions/site/address', token, {'slug': candidate})
            if status in (200, 201):
                slug = candidate
                break
        if not slug:
            raise SystemExit('Não foi possível definir o endereço do site.')
    if not (site.get('current') or {}).get('published'):
        status, result = call(base, 'admissions/site/versions', token, {'published': True, 'content': site_content(school)})
        if status not in (200, 201):
            raise SystemExit(f'Falha ao publicar o site ({status}): {result}')
    print(f'Site publicado: endereço do sistema + /escola/{slug}')

    day, opened = datetime.date.today(), 0
    while opened < 5:
        day += datetime.timedelta(days=1)
        if day.weekday() >= 5:
            continue
        for time in ('09:00', '14:00'):
            status, _ = call(base, 'admissions/visit-slots', token, {'date': day.isoformat(), 'time': time, 'capacity': 3})
            if status not in (200, 201, 409):
                raise SystemExit(f'Falha ao abrir horário de visita ({status}).')
        opened += 1
    print('Horários de visita: próximos 5 dias úteis, às 9h e às 14h, até 3 famílias cada.')
    print('Pronto. Planilha de exemplo para importar: docs/exemplos/planilha-alunos-ficticia.xlsx')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.URLError as error:
        sys.exit(f'Não consegui falar com o sistema: {error.reason}. Ele está no ar?')
