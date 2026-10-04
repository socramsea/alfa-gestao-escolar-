"""Valida imagens já construídas em projeto efêmero, banco tmpfs e dados fictícios."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

root = Path(__file__).resolve().parents[1]
# Verifica o host antes de criar banco/rede. Falha aqui não autoriza reduzir segurança.
preflight = subprocess.run(['docker','run','--rm','--read-only','--security-opt','no-new-privileges:true',
                           '--cap-drop','ALL','--entrypoint','/usr/local/bin/node','alfa-mvp-api:local','--version'],
                          capture_output=True,text=True)
if preflight.returncode:
    raise SystemExit('DEPLOY BLOCKED: runtime não executa a imagem com os controles exigidos.\n' + preflight.stderr.strip())
project = 'alfa-check-' + uuid.uuid4().hex[:10]
with tempfile.TemporaryDirectory(prefix='alfa-check-') as temporary:
    tmp = Path(temporary)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    values = {key: secrets.token_hex(32) for key in ('POSTGRES_PASSWORD','APP_PASSWORD','AUTH_PASSWORD','JWT_SECRET','ADMIN_PASSWORD')}
    values.update(SCHOOL_NAME='Escola de teste descartavel', ADMIN_EMAIL='admin@deploy.test', ADMIN_NAME='Administrador teste', PUBLIC_ORIGIN=origin, HTTP_PORT=str(port))
    config = tmp / '.env'
    config.write_text(''.join(f'{k}={v}\n' for k,v in values.items()))
    config.chmod(0o600)
    override = tmp / 'tmpfs.yml'
    override.write_text('services:\n  postgres:\n    volumes:\n      - type: tmpfs\n        target: /var/lib/postgresql/data\n')
    compose = ['docker','compose','--env-file',str(config),'-p',project,'-f',str(root/'deploy/compose.yml'),'-f',str(override)]
    def run(*args, **kwargs):
        return subprocess.run([*compose,*args],check=True,**kwargs)
    def call(path, data=None, token=None):
        headers = {'Content-Type':'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
            headers['Idempotency-Key'] = str(uuid.uuid4())
        request = urllib.request.Request(origin+path, data=json.dumps(data).encode() if data else None, headers=headers)
        with urllib.request.urlopen(request,timeout=15) as response:
            return json.load(response), response.headers
    try:
        run('config','--quiet')
        run('up','-d','--wait','postgres')
        run('--profile','setup','run','--rm','setup')
        run('--profile','setup','run','--rm','setup')
        print('PASS: migrations, provisionamento e bootstrap repetidos sem duplicação',flush=True)
        run('up','-d','--no-build','--wait','api','frontend')
        for attempt in range(30):
            try:
                status,headers = call('/api/ready')
                assert status['status']=='ok'
                break
            except (OSError,AssertionError):
                if attempt == 29: raise
                time.sleep(1)
        assert headers['X-Content-Type-Options']=='nosniff'
        assert headers['Cache-Control']=='no-store'
        assert "frame-ancestors 'none'" in headers['Content-Security-Policy']
        api_id = run('ps','-q','api',capture_output=True,text=True).stdout.strip()
        inspection = json.loads(subprocess.run(['docker','inspect',api_id],capture_output=True,text=True,check=True).stdout)[0]
        env_keys = {value.split('=',1)[0] for value in inspection['Config']['Env']}
        assert not {'ADMIN_DATABASE_URL','ADMIN_PASSWORD','POSTGRES_PASSWORD'} & env_keys
        assert inspection['HostConfig']['ReadonlyRootfs']
        assert 'no-new-privileges:true' in inspection['HostConfig']['SecurityOpt']
        print('PASS: proxy, headers, readiness e runtime sem credenciais administrativas',flush=True)
        browser_env = dict(os.environ, E2E_BASE_URL=origin, E2E_EMAIL=values['ADMIN_EMAIL'], E2E_PASSWORD=values['ADMIN_PASSWORD'],
                           E2E_ARTIFACTS=str(tmp/'browser'), E2E_SCREENSHOT='/tmp/alfa-mvp-mobile.png')
        browser = os.environ.get('E2E_BROWSER_EXECUTABLE') or shutil.which('google-chrome')
        if browser: browser_env['E2E_BROWSER_EXECUTABLE']=browser
        subprocess.run(['npm','run','test:e2e'],cwd=root/'frontend',env=browser_env,check=True)
        identity,_ = call('/api/auth/login',{'email':values['ADMIN_EMAIL'],'password':values['ADMIN_PASSWORD']})
        token = identity['token']
        # Os specs de estrutura, matrícula, profissionais e matrícula online criam uma turma cada; pessoas, matrícula
        # e matrícula online criam um aluno cada; a matrícula online aprovada cria responsável, vínculo e matrícula.
        # A importação cria as turmas T1 e T2 e importa dois irmãos com a mesma mãe, matriculados.
        before,_ = call('/api/structure/class-groups',token=token)
        assert len(before['items'])==6
        people_before = {}
        for resource, expected in (('students',5),('guardians',3),('student-guardians',4)):
            people_before[resource],_ = call('/api/people/'+resource,token=token)
            assert len(people_before[resource]['items'])==expected
        enrollments_before,_ = call('/api/enrollments',token=token)
        assert len(enrollments_before['items'])==4
        staff_before = {}
        for resource in ('members','assignments','assignment-endings'):
            staff_before[resource],_ = call('/api/staff/'+resource,token=token)
            assert len(staff_before[resource]['items'])==1
        # O spec de captação publica o site, abre um horário e recebe uma pré-matrícula com visita registrada.
        leads_before,_ = call('/api/admissions/leads',token=token)
        assert len(leads_before['items'])==1 and leads_before['items'][0]['status']=='visitou'
        site_before,_ = call('/api/admissions/site',token=token)
        assert site_before['current']['published']
        online_before,_ = call('/api/online-enrollments/applications',token=token)
        assert len(online_before['items'])==1 and online_before['items'][0]['state']=='aprovada'
        run('restart','api')
        for attempt in range(30):
            try:
                after,_ = call('/api/structure/class-groups',token=token)
                assert after==before
                for resource, expected in people_before.items():
                    actual,_ = call('/api/people/'+resource,token=token)
                    assert actual==expected
                actual,_ = call('/api/enrollments',token=token)
                assert actual==enrollments_before
                for resource, expected in staff_before.items():
                    actual,_ = call('/api/staff/'+resource,token=token)
                    assert actual==expected
                actual,_ = call('/api/admissions/leads',token=token)
                assert actual==leads_before
                actual,_ = call('/api/admissions/site',token=token)
                assert actual==site_before
                actual,_ = call('/api/online-enrollments/applications',token=token)
                assert actual==online_before
                break
            except (OSError,AssertionError):
                if attempt==29: raise
                time.sleep(1)
        dump = run('exec','-T','postgres','pg_dump','-U','postgres','-Fc','alfa_gestao',capture_output=True).stdout
        run('exec','-T','postgres','createdb','-U','postgres','restore_probe')
        run('exec','-T','postgres','pg_restore','-U','postgres','--exit-on-error','-d','restore_probe',input=dump)
        count = run('exec','-T','postgres','psql','-U','postgres','-d','restore_probe','-Atc',
                    'SELECT count(*) FROM class_groups;',capture_output=True,text=True).stdout.strip()
        assert count=='6'
        for table, expected in (('students','5'),('guardians','3'),('student_guardians','4'),('enrollments','4'),('enrollment_events','1'),
                                ('staff_members','1'),('class_group_staff','1'),('class_group_staff_endings','1'),('staff_events','3'),
                                ('school_site_addresses','1'),('school_site_versions','1'),('visit_slots','1'),('admission_leads','1'),
                                ('visit_bookings','1'),('visit_booking_outcomes','1'),('admission_lead_updates','1'),('admission_events','4'),
                                ('enrollment_form_settings','1'),('online_enrollments','1'),('online_enrollment_links','1'),
                                ('online_enrollment_access_attempts','5'),('online_enrollment_submissions','1'),
                                ('online_enrollment_reviews','1'),('online_enrollment_events','5'),
                                ('online_enrollment_birth_date_corrections','1'),('people_imports','1')):
            count = run('exec','-T','postgres','psql','-U','postgres','-d','restore_probe','-Atc',
                        f'SELECT count(*) FROM {table};',capture_output=True,text=True).stdout.strip()
            assert count==expected
        print('PASS: persistência após reinício; backup/restauração em banco descartável',flush=True)
        print('DEPLOY SMOKE PASS: stack, navegador e dados fictícios verificados',flush=True)
    finally:
        run('down','--remove-orphans')
