import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { create, onlineEnrollmentTables, validCpf } from '../../src/modules/online-enrollments/service.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(()=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@matricula-online.test`}));
const [a,b]=fixtures;
const BIRTH='2021-04-22';
// CPFs fictícios com dígitos verificadores válidos.
const CPF_A='529.982.247-25',CPF_B='111.444.777-35';
async function api(who,path,data,key=randomUUID()){
  return fetch(`${base}/api/${path}`,{method:data!==undefined?'POST':'GET',
    headers:{...(who?{Authorization:`Bearer ${who.token}`}:{}),'Content-Type':'application/json','Idempotency-Key':key},
    ...(data!==undefined?{body:JSON.stringify(data)}:{})});
}
async function add(who,path,data,status=201){
  const res=await api(who,path,data);assert.equal(res.status,status,await res.clone().text());return res.json();
}
const family=(path,body,key=randomUUID())=>fetch(`${base}/api/family/enrollments/${path}`,{method:'POST',
  headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
const ficha=(extra={})=>({child:{full_name:'Criança Fictícia Online'},guardians:[{full_name:'Responsável Fictícia',
  relationship:'Mãe',phone:'(11) 98765-4321',is_legal:true,is_financial:true}],accept_terms:true,...extra});
async function invite(f,extra={}){
  const app=(await add(f,'online-enrollments/applications',{child_name:'Criança Fictícia Online',child_birth_date:BIRTH,
    guardian_name:'Responsável Fictícia',guardian_phone:'(11) 98765-4321',...extra})).item;
  const link=await add(f,'online-enrollments/links',{application_id:app.id});
  return {app,token:link.token};
}
async function openFicha(token,birth=BIRTH){return family('access',{token,birth_date:birth});}
async function send(token,data=ficha(),settings_id,key){
  if(settings_id===undefined)settings_id=(await (await openFicha(token)).json()).settings.id;
  return family('submissions',{token,birth_date:BIRTH,settings_id,data},key);
}
const latestSubmission=async(f,appId)=>(await (await api(f,`online-enrollments/applications/${appId}`)).json()).item.submissions[0];
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Matrícula online fictícia','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    await add(f,'structure/stages',{code:'infantil'});
    f.year=(await add(f,'structure/academic-years',{code:'2027',starts_on:'2027-02-01',ends_on:'2027-12-20'})).item;
    f.shift=(await add(f,'structure/shifts',{code:'MANHA',name:'Manhã'})).item;
    f.level=(await add(f,'structure/levels',{code:'G4',name:'Infantil 4',stage_code:'infantil'})).item;
    f.otherLevel=(await add(f,'structure/levels',{code:'G5',name:'Infantil 5',stage_code:'infantil'})).item;
    f.group=(await add(f,'structure/class-groups',{code:'T1',stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.level.id]})).item;
  }
});
after(async()=>{
  try{
    const ids=fixtures.map(f=>f.school_id);
    for(const table of ['online_enrollment_events','online_enrollment_reviews','online_enrollment_submissions',
      'online_enrollment_access_attempts','online_enrollment_link_revocations','online_enrollment_links',
      'online_enrollment_birth_date_corrections','online_enrollments',
      'enrollment_form_settings','admission_events','admission_lead_updates','admission_leads','enrollment_events','enrollments',
      'student_guardians','guardians','students','structure_events','class_group_levels','class_groups','school_levels',
      'school_shifts','academic_years','school_stages','users']){
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[ids]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[ids]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('regras da escola: padrao sem exigencias extras, versionadas e estritas',async()=>{
  const empty=await (await api(b,'online-enrollments/settings')).json();
  assert.deepEqual(empty.item.required_fields,[]);assert.equal(empty.item.id,null);
  const first=(await add(a,'online-enrollments/settings',{required_fields:['guardian_cpf'],terms_text:'Regulamento fictício v1'})).item;
  const second=(await add(a,'online-enrollments/settings',{required_fields:['guardian_cpf','address'],terms_text:'Regulamento fictício v2'})).item;
  assert.notEqual(first.id,second.id);
  assert.deepEqual((await (await api(a,'online-enrollments/settings')).json()).item.required_fields,['guardian_cpf','address']);
  for(const bad of [{required_fields:['outro']},{required_fields:['address','address']},{required_fields:[],extra:1}]){
    assert.equal((await api(a,'online-enrollments/settings',bad)).status,400);
  }
  await add(a,'online-enrollments/settings',{required_fields:[],terms_text:'Regulamento fictício v3'});
});

test('convite: a partir da captacao ou manual; um por interessado; nascimento obrigatorio',async()=>{
  const lead=(await add(a,'admissions/leads',{source:'whatsapp',interest:'matricula',guardian_name:'Responsável Captada',
    guardian_phone:'(11) 97777-6666',child_name:'Criança Captada',consent:true})).item;
  assert.equal((await api(a,'online-enrollments/applications',{lead_id:lead.id})).status,400);
  const app=(await add(a,'online-enrollments/applications',{lead_id:lead.id,child_birth_date:BIRTH})).item;
  assert.equal(app.lead_id,lead.id);assert.equal(app.child_name,'Criança Captada');assert.equal(app.state,'convidada');
  assert.equal((await api(a,'online-enrollments/applications',{lead_id:lead.id,child_birth_date:BIRTH})).status,409);
  const otherLead=(await add(b,'admissions/leads',{source:'outro',interest:'visita',guardian_name:'B',guardian_phone:'(11) 96666-5555',child_name:'B',consent:true})).item;
  assert.equal((await api(a,'online-enrollments/applications',{lead_id:otherLead.id,child_birth_date:BIRTH})).status,404);
  assert.equal((await api(a,'online-enrollments/applications',{child_name:'X',child_birth_date:'2999-01-01',guardian_name:'Y',guardian_phone:'(11) 95555-4444'})).status,400);
  assert.equal((await api(a,'online-enrollments/applications',{child_name:'X',child_birth_date:BIRTH,guardian_name:'Y',guardian_phone:'123'})).status,400);
});

test('link: token so na criacao, guardado como hash; novo link revoga o anterior',async()=>{
  const {app}=await invite(a);
  const key=randomUUID();
  const first=await api(a,'online-enrollments/links',{application_id:app.id},key);assert.equal(first.status,201);
  const {token}=await first.json();assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  const replay=await (await api(a,'online-enrollments/links',{application_id:app.id},key)).json();
  assert.equal(replay.replayed,true);assert.equal(replay.token,null);
  const {rows}=await admin.query('SELECT token_hash FROM online_enrollment_links WHERE application_id=$1',[app.id]);
  assert.ok(rows.every(r=>r.token_hash!==token&&/^[0-9a-f]{64}$/.test(r.token_hash)));
  assert.equal((await openFicha(token)).status,200);
  const second=(await add(a,'online-enrollments/links',{application_id:app.id})).token;
  assert.equal((await openFicha(token)).status,401);
  assert.equal((await openFicha(second)).status,200);
});

test('acesso da familia: data errada recusada, bloqueio apos 5 erros e resposta sem identificadores internos',async()=>{
  const {token}=await invite(a);
  const ok=await openFicha(token);assert.equal(ok.status,200);
  const body=await ok.json();
  assert.equal(body.state,'convidada');assert.equal(body.school_name,'Matrícula online fictícia');
  assert.equal(body.application.child_birth_date,BIRTH);
  assert.ok(!JSON.stringify(body).includes(a.school_id));
  for(let i=0;i<4;i++)assert.equal((await openFicha(token,'2020-01-01')).status,401);
  assert.equal((await openFicha(token)).status,200);
  for(let i=0;i<4;i++)assert.equal((await openFicha(token,'2020-01-01')).status,401);
  assert.equal((await openFicha(token,'2020-01-01')).status,429);
  assert.equal((await openFicha(token)).status,429);
  assert.equal((await openFicha('x'.repeat(43))).status,401);
  for(const bad of [{token},{token,birth_date:'22/04/2021'},{token,birth_date:BIRTH,school_id:b.school_id}]){
    assert.equal((await family('access',bad)).status,400);
  }
  assert.equal((await openFicha(token,'2021-02-30')).status,401);
});

test('acesso da familia: link expirado e escola suspensa recusados',async()=>{
  const {app,token}=await invite(a);
  await admin.query("UPDATE online_enrollment_links SET expires_at=now()-interval '1 second', created_at=now()-interval '1 day' WHERE application_id=$1",[app.id]);
  assert.equal((await openFicha(token)).status,401);
  const fresh=(await add(a,'online-enrollments/links',{application_id:app.id})).token;
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try{assert.equal((await openFicha(fresh)).status,401);}
  finally{await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]);}
  assert.equal((await openFicha(fresh)).status,200);
});

test('envio: regras de cada escola, CPF valido, responsavel financeiro e legal obrigatorios',async()=>{
  assert.equal(validCpf(CPF_A),true);assert.equal(validCpf('111.111.111-11'),false);assert.equal(validCpf('529.982.247-26'),false);
  await add(b,'online-enrollments/settings',{required_fields:['guardian_cpf','address','second_guardian'],terms_text:null});
  const {token}=await invite(b);
  const second={full_name:'Pai Fictício',relationship:'Pai',phone:'(11) 91111-2222',cpf:CPF_B,is_legal:true,is_financial:false};
  const address={zip_code:'01310-100',street:'Avenida Fictícia',number:'100',district:'Centro',city:'São Paulo',state:'sp'};
  const full=ficha({guardians:[{...ficha().guardians[0],cpf:CPF_A},second],address});
  for(const bad of [ficha(),ficha({guardians:[{...ficha().guardians[0],cpf:CPF_A},second]}),
    {...full,guardians:[{...full.guardians[0],cpf:'529.982.247-26'},second]},
    {...full,guardians:full.guardians.map(g=>({...g,is_financial:false}))},
    {...full,guardians:full.guardians.map(g=>({...g,is_legal:false}))},
    {...full,accept_terms:false},{...full,child:{...full.child,extra:1}},{...full,address:{...address,state:'São Paulo'}}]){
    assert.equal((await send(token,bad)).status,400);
  }
  const res=await send(token,full);assert.equal(res.status,201);
  const {rows:[row]}=await admin.query('SELECT data FROM online_enrollment_submissions WHERE school_id=$1 ORDER BY created_at DESC LIMIT 1',[b.school_id]);
  assert.equal(row.data.guardians[0].cpf,'52998224725');assert.equal(row.data.address.state,'SP');assert.equal(row.data.accept_terms,undefined);
  assert.equal((await (await openFicha(token)).json()).state,'enviada');
  await add(b,'online-enrollments/settings',{required_fields:[],terms_text:null});
});

test('envio: reenvio idempotente, chave com dados diferentes 409, ficha enviada nao reabre e regra alterada recusada',async()=>{
  const {token}=await invite(a);
  const settings=(await (await openFicha(token)).json()).settings.id;
  await add(a,'online-enrollments/settings',{required_fields:[],terms_text:'Regulamento fictício v4'});
  const stale=await send(token,ficha(),settings);assert.equal(stale.status,409);assert.equal((await stale.json()).reason,'settings_changed');
  const key=randomUUID();
  assert.equal((await send(token,ficha(),undefined,key)).status,201);
  assert.equal((await send(token,ficha(),undefined,key)).status,200);
  const conflict=await send(token,ficha({child:{full_name:'Outro nome'}}),undefined,key);
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).reason,'conflict');
  const closed=await send(token,ficha());assert.equal(closed.status,409);assert.equal((await closed.json()).reason,'closed');
});

test('analise: correcao com motivo, nova ficha, aprovacao cria aluno, responsaveis, vinculos e matricula',async()=>{
  const lead=(await add(a,'admissions/leads',{source:'whatsapp',interest:'matricula',guardian_name:'Mãe Fictícia',
    guardian_phone:'(11) 98888-1111',child_name:'Aluna Fictícia',child_birth_date:BIRTH,consent:true})).item;
  const app=(await add(a,'online-enrollments/applications',{lead_id:lead.id})).item;
  const {token}=await add(a,'online-enrollments/links',{application_id:app.id});
  assert.equal((await send(token,ficha({child:{full_name:'Aluna Fictícia'}}))).status,201);
  const first=await latestSubmission(a,app.id);
  assert.equal((await api(a,'online-enrollments/reviews',{submission_id:first.id,decision:'correcao'})).status,400);
  await add(a,'online-enrollments/reviews',{submission_id:first.id,decision:'correcao',note:'Informe o CPF da responsável'});
  const reopened=await (await openFicha(token)).json();
  assert.equal(reopened.state,'correcao');assert.equal(reopened.review_note,'Informe o CPF da responsável');
  assert.equal(reopened.last_submission.child.full_name,'Aluna Fictícia');
  assert.equal((await api(a,'online-enrollments/reviews',{submission_id:first.id,decision:'aprovada',class_group_id:a.group.id,level_id:a.level.id})).status,409);
  const guardians=[{...ficha().guardians[0],cpf:CPF_A},{full_name:'Avó Fictícia',relationship:'Avó',phone:'(11) 93333-4444',is_legal:false,is_financial:false}];
  assert.equal((await send(token,ficha({child:{full_name:'Aluna Fictícia de Souza',health_notes:'Alergia a amendoim'},guardians}))).status,201);
  const second=await latestSubmission(a,app.id);
  assert.equal((await api(a,'online-enrollments/reviews',{submission_id:second.id,decision:'aprovada',class_group_id:a.group.id,level_id:a.otherLevel.id})).status,404);
  assert.equal((await api(a,'online-enrollments/reviews',{submission_id:second.id,decision:'aprovada',class_group_id:b.group.id,level_id:b.level.id})).status,404);
  const review=(await add(a,'online-enrollments/reviews',{submission_id:second.id,decision:'aprovada',class_group_id:a.group.id,level_id:a.level.id})).item;
  assert.ok(review.student_id&&review.enrollment_id);
  const {rows:[student]}=await admin.query('SELECT full_name,birth_date::text AS birth_date FROM students WHERE id=$1',[review.student_id]);
  assert.deepEqual(student,{full_name:'Aluna Fictícia de Souza',birth_date:BIRTH});
  const {rows:links}=await admin.query(`SELECT g.full_name,sg.relationship,sg.is_legal FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
    WHERE sg.student_id=$1 ORDER BY g.full_name`,[review.student_id]);
  assert.deepEqual(links.map(l=>[l.full_name,l.relationship,l.is_legal]),[['Avó Fictícia','Avó',false],['Responsável Fictícia','Mãe',true]]);
  const enrollments=await (await api(a,'enrollments')).json();
  assert.ok(enrollments.items.some(e=>e.id===review.enrollment_id&&e.class_group_code==='T1'&&e.academic_year_code==='2027'));
  assert.equal((await (await api(a,`admissions/leads/${lead.id}`)).json()).item.status,'matriculado');
  assert.equal((await (await openFicha(token)).json()).state,'aprovada');
  assert.equal((await send(token,ficha())).status,409);
  assert.equal((await api(a,'online-enrollments/links',{application_id:app.id})).status,409);
  const detail=(await (await api(a,`online-enrollments/applications/${app.id}`)).json()).item;
  assert.equal(detail.state,'aprovada');assert.deepEqual(detail.submissions.map(s=>s.decision),['aprovada','correcao']);
});

test('analise: recusa encerra o atendimento da captacao com o motivo',async()=>{
  const lead=(await add(a,'admissions/leads',{source:'indicacao',interest:'matricula',guardian_name:'Recusa',
    guardian_phone:'(11) 92222-3333',child_name:'Criança Recusa',child_birth_date:BIRTH,consent:true})).item;
  const app=(await add(a,'online-enrollments/applications',{lead_id:lead.id})).item;
  const {token}=await add(a,'online-enrollments/links',{application_id:app.id});
  assert.equal((await send(token)).status,201);
  const sub=await latestSubmission(a,app.id);
  await add(a,'online-enrollments/reviews',{submission_id:sub.id,decision:'recusada',note:'Sem vaga na turma'});
  const leadNow=(await (await api(a,`admissions/leads/${lead.id}`)).json()).item;
  assert.equal(leadNow.status,'desistiu');assert.equal(leadNow.updates.at(-1).note,'Sem vaga na turma');
  assert.equal((await (await openFicha(token)).json()).state,'recusada');
});

test('isolamento: listagem, detalhe e analise de outra escola recusados sem escrita',async()=>{
  const {app,token}=await invite(b);assert.equal((await send(token)).status,201);
  const sub=await latestSubmission(b,app.id);
  const list=await (await api(a,'online-enrollments/applications')).json();
  assert.ok(list.items.every(i=>i.school_id===a.school_id));assert.ok(!list.items.some(i=>i.id===app.id));
  assert.equal((await api(a,`online-enrollments/applications/${app.id}`)).status,404);
  const before=await admin.query('SELECT count(*)::int AS n FROM online_enrollment_reviews WHERE school_id=$1',[b.school_id]);
  assert.equal((await api(a,'online-enrollments/reviews',{submission_id:sub.id,decision:'correcao',note:'x'})).status,404);
  assert.equal((await api(a,'online-enrollments/links',{application_id:app.id})).status,404);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM online_enrollment_reviews WHERE school_id=$1',[b.school_id])).rows[0].n,before.rows[0].n);
  assert.equal((await api(a,'online-enrollments/applications?state=enviada&school_id=x')).status,400);
  const filtered=await (await api(b,'online-enrollments/applications?state=enviada')).json();
  assert.ok(filtered.items.some(i=>i.id===app.id));assert.ok(filtered.items.every(i=>i.state==='enviada'));
});

test('perfis: sem token, perfis nao administrativos e escola suspensa negados',async()=>{
  assert.equal((await fetch(`${base}/api/online-enrollments/applications`)).status,401);
  for(const role of ['teacher','guardian']){
    await admin.query('UPDATE users SET role=$1 WHERE id=$2',[role,a.sub]);
    try{
      assert.equal((await api(a,'online-enrollments/applications')).status,403);
      assert.equal((await api(a,'online-enrollments/settings',{required_fields:[]})).status,403);
    }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  }
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try{assert.equal((await api(a,'online-enrollments/applications')).status,401);}
  finally{await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]);}
});

test('banco: RLS sem contexto, alfa_auth sem leitura, sem UPDATE/DELETE e aprovacao revertida por auditoria invalida',async()=>{
  for(const table of onlineEnrollmentTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0,table);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await withTenant(a,async c=>{const {rows}=await c.query(`SELECT school_id FROM public.${table}`);assert.ok(rows.every(r=>r.school_id===a.school_id));});
  }
  const {app,token}=await invite(a);assert.equal((await send(token)).status,201);
  const sub=await latestSubmission(a,app.id);
  const students=async()=>(await admin.query('SELECT count(*)::int AS n FROM students WHERE school_id=$1',[a.school_id])).rows[0].n;
  const before=await students();
  await assert.rejects(()=>withTenant(a,(c,u)=>create(c,{...u,id:b.sub},'reviews',
    {submission_id:sub.id,decision:'aprovada',note:null,class_group_id:a.group.id,level_id:a.level.id},randomUUID())),e=>e.code==='23503');
  assert.equal(await students(),before);
  assert.equal((await latestSubmission(a,app.id)).decision,null);
});

test('fronteira da familia: somente alfa_app executa e a inicializacao recusa funcao alterada',async()=>{
  await assert.rejects(()=>authPool.query("SELECT family_public.application('x',NULL)"),e=>e.code==='42501');
  await assert.rejects(()=>pool.query('SET ROLE alfa_family_owner'),e=>e.code==='42501');
  await assert.rejects(()=>pool.query('ALTER FUNCTION family_public.submit(text,date,uuid,text,uuid,jsonb) SECURITY INVOKER'),e=>e.code==='42501');
  await testDatabaseConnection();
  for(const [change,restore] of [
    ['ALTER FUNCTION family_public.application(text,date) SECURITY INVOKER','ALTER FUNCTION family_public.application(text,date) SECURITY DEFINER'],
    ['GRANT EXECUTE ON FUNCTION family_public.submit(text,date,uuid,text,uuid,jsonb) TO alfa_auth','REVOKE EXECUTE ON FUNCTION family_public.submit(text,date,uuid,text,uuid,jsonb) FROM alfa_auth'],
    ['ALTER TABLE public.online_enrollment_submissions NO FORCE ROW LEVEL SECURITY','ALTER TABLE public.online_enrollment_submissions FORCE ROW LEVEL SECURITY']]){
    await admin.query(change);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio|Fronteira publica da familia/);}
    finally{await admin.query(restore);}
  }
  await testDatabaseConnection();
});

test('convite: nascimento errado e corrigido pela escola; a familia entra com a data certa pelo mesmo link',async()=>{
  const WRONG='2021-01-01';
  const lead=(await add(a,'admissions/leads',{source:'whatsapp',interest:'matricula',guardian_name:'Responsável Correção',
    guardian_phone:'(11) 94444-5555',child_name:'Criança Correção',consent:true})).item;
  const app=(await add(a,'online-enrollments/applications',{lead_id:lead.id,child_birth_date:WRONG})).item;
  const {token}=await add(a,'online-enrollments/links',{application_id:app.id});
  for(let i=0;i<4;i++)assert.equal((await openFicha(token)).status,401);
  assert.equal((await openFicha(token)).status,429);
  assert.equal((await openFicha(token)).status,429);
  assert.equal((await api(a,'online-enrollments/applications',{lead_id:lead.id,child_birth_date:BIRTH})).status,409);
  for(const bad of [{application_id:app.id},{application_id:app.id,child_birth_date:'2999-01-01'},
    {application_id:app.id,child_birth_date:'22/04/2021'},{application_id:app.id,child_birth_date:BIRTH,school_id:b.school_id}]){
    assert.equal((await api(a,'online-enrollments/birth-date-corrections',bad)).status,400);
  }
  assert.equal((await api(b,'online-enrollments/birth-date-corrections',{application_id:app.id,child_birth_date:BIRTH})).status,404);
  const key=randomUUID();
  const fixed=await api(a,'online-enrollments/birth-date-corrections',{application_id:app.id,child_birth_date:BIRTH},key);
  assert.equal(fixed.status,201);assert.equal((await fixed.json()).item.child_birth_date,BIRTH);
  assert.equal((await api(a,'online-enrollments/birth-date-corrections',{application_id:app.id,child_birth_date:BIRTH},key)).status,200);
  assert.equal((await api(a,'online-enrollments/birth-date-corrections',{application_id:app.id,child_birth_date:BIRTH})).status,409);
  const opened=await openFicha(token);assert.equal(opened.status,200);
  assert.equal((await opened.json()).application.child_birth_date,BIRTH);
  assert.equal((await openFicha(token,WRONG)).status,401);
  const detail=(await (await api(a,`online-enrollments/applications/${app.id}`)).json()).item;
  assert.equal(detail.child_birth_date,BIRTH);assert.equal(detail.lead_id,lead.id);
  assert.deepEqual(detail.birth_date_corrections.map(c=>c.child_birth_date),[BIRTH]);
  assert.equal((await send(token)).status,201);
  const sub=await latestSubmission(a,app.id);
  const review=(await add(a,'online-enrollments/reviews',{submission_id:sub.id,decision:'aprovada',class_group_id:a.group.id,level_id:a.level.id})).item;
  const {rows:[student]}=await admin.query('SELECT birth_date::text AS birth_date FROM students WHERE id=$1',[review.student_id]);
  assert.equal(student.birth_date,BIRTH);
  assert.equal((await (await api(a,`admissions/leads/${lead.id}`)).json()).item.status,'matriculado');
  assert.equal((await api(a,'online-enrollments/birth-date-corrections',{application_id:app.id,child_birth_date:'2021-05-05'})).status,409);
});

async function approve(f,data){
  const {app,token}=await invite(f,{child_name:data.child.full_name});
  assert.equal((await send(token,data)).status,201);
  const sub=await latestSubmission(f,app.id);
  return api(f,'online-enrollments/reviews',{submission_id:sub.id,decision:'aprovada',class_group_id:f.group.id,level_id:f.level.id});
}
const guardiansOf=async studentId=>(await admin.query(`SELECT sg.guardian_id,g.full_name,g.cpf,g.email,sg.relationship,sg.is_legal,sg.is_financial
  FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id WHERE sg.student_id=$1 ORDER BY g.full_name`,[studentId])).rows;

test('aprovacao: CPF, nome social, saude, endereco e responsavel financeiro chegam ao cadastro',async()=>{
  const data=ficha({child:{full_name:'Criança Cadastro Completo',social_name:'Cacá',cpf:'246.813.579-28',health_notes:'Alergia a lactose'},
    guardians:[{full_name:'Mãe Cadastro',relationship:'Mãe',phone:'(11) 95555-1212',cpf:'123.456.789-09',email:'MAE@cadastro.test',is_legal:true,is_financial:false},
      {full_name:'Pai Cadastro',relationship:'Pai',phone:'(11) 95555-3434',is_legal:false,is_financial:true}],
    address:{zip_code:'01310-100',street:'Avenida Fictícia',number:'100',complement:'Apto 1',district:'Centro',city:'São Paulo',state:'sp'}});
  const res=await approve(a,data);assert.equal(res.status,201);
  const review=(await res.json()).item;
  const {rows:[student]}=await admin.query(`SELECT full_name,social_name,cpf,health_notes,address_zip_code,address_street,address_number,
    address_complement,address_district,address_city,address_state FROM students WHERE id=$1`,[review.student_id]);
  assert.deepEqual(student,{full_name:'Criança Cadastro Completo',social_name:'Cacá',cpf:'24681357928',health_notes:'Alergia a lactose',
    address_zip_code:'01310-100',address_street:'Avenida Fictícia',address_number:'100',address_complement:'Apto 1',
    address_district:'Centro',address_city:'São Paulo',address_state:'SP'});
  assert.deepEqual((await guardiansOf(review.student_id)).map(({guardian_id:_,...g})=>g),[
    {full_name:'Mãe Cadastro',cpf:'12345678909',email:'mae@cadastro.test',relationship:'Mãe',is_legal:true,is_financial:false},
    {full_name:'Pai Cadastro',cpf:null,email:null,relationship:'Pai',is_legal:false,is_financial:true}]);
  const listed=(await (await api(a,'people/students')).json()).items.find(s=>s.id===review.student_id);
  assert.equal(listed.cpf,'24681357928');assert.equal(listed.address_city,'São Paulo');
  // A mesma criança (mesmo CPF) não vira um segundo aluno: a aprovação é recusada sem gravar nada.
  const count=async()=>(await admin.query('SELECT count(*)::int AS n FROM students WHERE school_id=$1',[a.school_id])).rows[0].n;
  const before=await count();
  assert.equal((await approve(a,ficha({child:{full_name:'Criança Cadastro Repetida',cpf:'246.813.579-28'}}))).status,409);
  assert.equal(await count(),before);
});

test('aprovacao: irmaos compartilham o responsavel ja cadastrado; pessoas diferentes nao se fundem',async()=>{
  const mother={full_name:'Mãe dos Irmãos',relationship:'Mãe',phone:'(11) 96666-1010',cpf:'987.654.321-00',is_legal:true,is_financial:true};
  const father={full_name:'Pai dos Irmãos',relationship:'Pai',phone:'(11) 96666-2020',is_legal:true,is_financial:false};
  const {token}=await invite(a);
  assert.equal((await send(token,ficha({guardians:[mother,{...father,cpf:mother.cpf}]}))).status,400);
  const first=(await (await approve(a,ficha({child:{full_name:'Irmão Mais Velho'},guardians:[mother,father]}))).json()).item;
  // Mesma mãe pelo CPF; mesmo pai por nome e telefone escritos de outro jeito e sem CPF.
  const second=(await (await approve(a,ficha({child:{full_name:'Irmã do Meio'},guardians:[
    {...mother,full_name:'MÃE DOS IRMÃOS',phone:'+55 11 96666-1010'},{...father,full_name:'pai  dos irmaos',phone:'11966662020',is_financial:true}]}))).json()).item;
  const firstLinks=await guardiansOf(first.student_id),secondLinks=await guardiansOf(second.student_id);
  assert.deepEqual(secondLinks.map(g=>g.guardian_id),firstLinks.map(g=>g.guardian_id));
  assert.deepEqual(secondLinks.map(g=>[g.full_name,g.is_financial]),[['Mãe dos Irmãos',true],['Pai dos Irmãos',true]]);
  // Mesmo telefone com outro nome (avó) e mesmo nome e telefone com outro CPF são pessoas diferentes.
  const third=(await (await approve(a,ficha({child:{full_name:'Irmão Caçula'},guardians:[
    {...father,full_name:'Avó dos Irmãos',relationship:'Avó'},{...mother,cpf:'135.792.468-28'}]}))).json()).item;
  const known=new Set(firstLinks.map(g=>g.guardian_id));
  const thirdLinks=await guardiansOf(third.student_id);
  assert.equal(thirdLinks.length,2);assert.ok(thirdLinks.every(g=>!known.has(g.guardian_id)));
  const {rows:[{n}]}=await admin.query(`SELECT count(*)::int AS n FROM guardians WHERE school_id=$1
    AND full_name IN ('Mãe dos Irmãos','Pai dos Irmãos','Avó dos Irmãos')`,[a.school_id]);
  assert.equal(n,4);
});
