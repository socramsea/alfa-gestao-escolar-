import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { importTables, MAX_IMPORT_ROWS } from '../../src/modules/people/import.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(()=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@importacao.test`}));
const [a,b]=fixtures;
// CPFs fictícios com dígitos verificadores válidos.
const CPF_MAE='123.456.789-09',CPF_ALUNO='246.813.579-28',CPF_OUTRO='135.792.468-28';
async function api(who,path,data,key=randomUUID()){
  return fetch(`${base}/api/${path}`,{method:data!==undefined?'POST':'GET',
    headers:{...(who?{Authorization:`Bearer ${who.token}`}:{}),'Content-Type':'application/json','Idempotency-Key':key},
    ...(data!==undefined?{body:JSON.stringify(data)}:{})});
}
async function add(who,path,data){const res=await api(who,path,data);assert.equal(res.status,201,await res.clone().text());return (await res.json()).item;}
const body=(rows,extra={})=>({academic_year_id:a.year.id,guardians_are_legal:true,rows:rows.map((r,i)=>({line:i+2,...r})),...extra});
const preview=(who,data)=>api(who,'people/imports/preview',data);
const importar=(who,data,key)=>api(who,'people/imports',data,key);
const count=async(table,f=a)=>(await admin.query(`SELECT count(*)::int AS n FROM public.${table} WHERE school_id=$1`,[f.school_id])).rows[0].n;
const counts=async()=>Object.fromEntries(await Promise.all(['students','guardians','student_guardians','enrollments','people_imports']
  .map(async t=>[t,await count(t)])));
// Planilha fictícia: irmãos com a mesma mãe, o pai do mais velho em outra linha e uma turma informada.
const familia=[
  {student_name:'Lucas Fictício Prado',birth_date:'2019-03-10',student_cpf:CPF_ALUNO,guardian_name:'Marta Fictícia Prado',
    guardian_phone:'(11) 97000-1111',guardian_cpf:CPF_MAE,relationship:'Mãe',class_code:'t1'},
  {student_name:'Lucas Fictício Prado',birth_date:'2019-03-10',guardian_name:'Rui Fictício Prado',guardian_phone:'11 97000-2222',relationship:'Pai'},
  {student_name:'Bia Fictícia Prado',birth_date:'2021-07-01',guardian_name:'MARTA FICTICIA PRADO',guardian_phone:'+55 11 97000-1111',class_code:'M1',level:'Infantil 5'},
  {student_name:'Teo Fictício Sem Responsável',birth_date:'2020-01-15'}
];
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Importação fictícia','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    await add(f,'structure/stages',{code:'infantil'});
    f.year=await add(f,'structure/academic-years',{code:'2027',starts_on:'2027-02-01',ends_on:'2027-12-20'});
    f.shift=await add(f,'structure/shifts',{code:'MANHA',name:'Manhã'});
    f.g4=await add(f,'structure/levels',{code:'G4',name:'Infantil 4',stage_code:'infantil'});
    f.g5=await add(f,'structure/levels',{code:'G5',name:'Infantil 5',stage_code:'infantil'});
    f.t1=await add(f,'structure/class-groups',{code:'T1',stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.g4.id]});
    f.m1=await add(f,'structure/class-groups',{code:'M1',stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.g4.id,f.g5.id]});
  }
});
after(async()=>{
  try{
    const ids=fixtures.map(f=>f.school_id);
    for(const table of ['people_imports','enrollments','student_guardians','guardians','students','people_events','structure_events',
      'class_group_levels','class_groups','school_levels','school_shifts','academic_years','school_stages','users']){
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[ids]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[ids]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('importacao: previa mostra o resultado de cada linha e nao grava nada',async()=>{
  const before=await counts();
  const res=await preview(a,body([...familia,{student_name:'Data Errada',birth_date:'2019-02-30'}]));
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.can_import,false);
  assert.deepEqual(result.rows.map(r=>r.status),['novo','novo','novo','novo','erro']);
  assert.deepEqual(result.rows[0].actions,['aluno novo','responsável novo','vínculo criado','matrícula na turma T1']);
  assert.deepEqual(result.rows[1].actions,['mesmo aluno da linha 2','responsável novo','vínculo criado']);
  assert.deepEqual(result.rows[2].actions,['aluno novo','mesmo responsável da linha 2','vínculo criado','matrícula na turma M1']);
  assert.deepEqual(result.rows[4].errors,['Data de nascimento inválida. Use dd/mm/aaaa.']);
  assert.equal(result.rows[4].line,6);
  assert.deepEqual({...result.summary},{rows:5,rows_with_errors:1,students_created:3,students_existing:0,
    guardians_created:2,guardians_reused:0,links_created:3,enrollments_created:2});
  assert.deepEqual(await counts(),before);
  assert.equal((await (await preview(a,body(familia))).json()).can_import,true);
});

test('importacao: grava alunos, responsaveis, vinculos e matriculas; irmaos compartilham o responsavel',async()=>{
  const res=await importar(a,body(familia));
  assert.equal(res.status,201,await res.clone().text());
  const result=await res.json();
  assert.equal(result.replayed,false);
  assert.equal(result.summary.students_created,3);assert.equal(result.summary.guardians_created,2);
  const {rows:students}=await admin.query(`SELECT s.full_name,s.cpf,s.birth_date::text AS birth,
      (SELECT g.code FROM enrollments e JOIN class_groups g ON g.id=e.class_group_id WHERE e.student_id=s.id) AS turma,
      (SELECT l.code FROM enrollments e JOIN school_levels l ON l.id=e.level_id WHERE e.student_id=s.id) AS serie
    FROM students s WHERE s.school_id=$1 ORDER BY s.full_name`,[a.school_id]);
  assert.deepEqual(students,[
    {full_name:'Bia Fictícia Prado',cpf:null,birth:'2021-07-01',turma:'M1',serie:'G5'},
    {full_name:'Lucas Fictício Prado',cpf:'24681357928',birth:'2019-03-10',turma:'T1',serie:'G4'},
    {full_name:'Teo Fictício Sem Responsável',cpf:null,birth:'2020-01-15',turma:null,serie:null}]);
  const {rows:links}=await admin.query(`SELECT s.full_name AS aluno,g.full_name AS responsavel,g.cpf,sg.relationship,sg.is_legal
    FROM student_guardians sg JOIN students s ON s.id=sg.student_id JOIN guardians g ON g.id=sg.guardian_id
    WHERE sg.school_id=$1 ORDER BY 1,2`,[a.school_id]);
  assert.deepEqual(links.map(l=>[l.aluno,l.responsavel,l.cpf,l.relationship,l.is_legal]),[
    ['Bia Fictícia Prado','Marta Fictícia Prado','12345678909','Responsável',true],
    ['Lucas Fictício Prado','Marta Fictícia Prado','12345678909','Mãe',true],
    ['Lucas Fictício Prado','Rui Fictício Prado',null,'Pai',true]]);
  assert.equal(await count('guardians'),2);
  const {rows:[audit]}=await admin.query('SELECT user_id,result FROM people_imports WHERE school_id=$1',[a.school_id]);
  assert.equal(audit.user_id,a.sub);
  assert.equal(audit.result.created.students.length,3);
  assert.ok(!/Prado|Marta|97000|2019-03-10|12345678909/.test(JSON.stringify(audit.result)),'auditoria sem dados pessoais');
  const listed=(await (await api(a,'people/students')).json()).items;
  assert.equal(listed.length,3);
});

test('importacao: reimportar nao duplica; mesma chave devolve o resultado; chave com outros dados 409',async()=>{
  const before=await counts();
  const key=randomUUID();
  const res=await importar(a,body(familia),key);assert.equal(res.status,201);
  const result=await res.json();
  assert.deepEqual(result.rows.map(r=>r.status),['existente','existente','existente','existente']);
  assert.deepEqual(result.rows[0].actions,['aluno já cadastrado','responsável já cadastrado','vínculo já existia','já matriculado neste período']);
  assert.deepEqual([result.summary.students_created,result.summary.guardians_created,result.summary.links_created,result.summary.enrollments_created],[0,0,0,0]);
  assert.deepEqual({...await counts(),people_imports:before.people_imports},before);
  const replay=await importar(a,body(familia),key);assert.equal(replay.status,200);
  assert.equal((await replay.json()).replayed,true);
  assert.equal((await importar(a,body(familia.slice(0,2)),key)).status,409);
  assert.equal(await count('people_imports'),before.people_imports+1);
});

test('importacao: qualquer linha com erro recusa tudo sem gravar e diz o motivo de cada linha',async()=>{
  const before=await counts();
  const rows=[
    {student_name:'Ok Fictício',birth_date:'2020-05-05'},
    {student_name:'',birth_date:'2020-05-05'},
    {student_name:'Futuro Fictício',birth_date:'2999-01-01'},
    {student_name:'Cpf Fictício',birth_date:'2020-05-05',student_cpf:'111.111.111-11'},
    {student_name:'Sem Contato Fictício',birth_date:'2020-05-05',guardian_name:'Responsável Sem Contato'},
    {student_name:'Fone Fictício',birth_date:'2020-05-05',guardian_name:'Responsável Fone',guardian_phone:'1234'},
    {student_name:'Email Fictício',birth_date:'2020-05-05',guardian_name:'Responsável Email',guardian_phone:'(11) 97000-3333',guardian_email:'nao-e-email'},
    {student_name:'Turma Fictícia',birth_date:'2020-05-05',class_code:'Z9'},
    {student_name:'Serie Fictícia',birth_date:'2020-05-05',class_code:'M1'},
    {student_name:'Serie Errada',birth_date:'2020-05-05',class_code:'T1',level:'G5'},
    {student_name:'So Telefone',birth_date:'2020-05-05',guardian_phone:'(11) 97000-4444'}
  ];
  const res=await importar(a,body(rows));
  assert.equal(res.status,400);
  const result=await res.json();
  assert.equal(result.error,'Importação não realizada: corrija as linhas indicadas.');
  assert.deepEqual(result.rows.map(r=>[r.line,r.errors]),[
    [2,[]],[3,['Informe o nome do aluno.']],[4,['Data de nascimento inválida. Use dd/mm/aaaa.']],[5,['CPF do aluno inválido.']],
    [6,['Informe o telefone ou o CPF do responsável.']],[7,['Telefone do responsável inválido. Inclua o DDD.']],
    [8,['E-mail do responsável inválido.']],[9,['Turma Z9 não encontrada no período escolhido.']],
    [10,['A turma M1 tem mais de uma série. Informe a série.']],[11,['A série G5 não pertence à turma T1.']],
    [12,['Informe o nome do responsável.']]]);
  assert.equal(result.summary.rows_with_errors,10);
  const noYear=await importar(a,body([{student_name:'Sem Periodo',birth_date:'2020-05-05',class_code:'T1'}],{academic_year_id:null}));
  assert.deepEqual((await noYear.json()).rows[0].errors,['Escolha o período letivo para usar a turma.']);
  assert.deepEqual(await counts(),before);
});

test('importacao: reaproveita responsavel ja cadastrado por CPF ou nome e telefone; outra pessoa no mesmo telefone fica separada',async()=>{
  const existing=await add(b,'people/guardians',{full_name:'Joana Fictícia Lima',phone:'(21) 98000-5555'});
  const res=await importar(b,body([
    {student_name:'Filho Fictício Lima',birth_date:'2018-08-08',guardian_name:'joana ficticia  lima',guardian_phone:'21980005555'},
    {student_name:'Neto Fictício Lima',birth_date:'2017-09-09',guardian_name:'Avó Fictícia Lima',guardian_phone:'(21) 98000-5555'},
    {student_name:'Prima Fictícia Lima',birth_date:'2016-10-10',guardian_name:'Tia Fictícia',guardian_cpf:CPF_OUTRO}
  ],{academic_year_id:b.year.id}));
  assert.equal(res.status,201,await res.clone().text());
  const result=await res.json();
  assert.deepEqual(result.rows.map(r=>r.actions[1]),['responsável já cadastrado','responsável novo','responsável novo']);
  assert.equal(result.summary.guardians_reused,1);assert.equal(result.summary.guardians_created,2);
  const {rows}=await admin.query(`SELECT sg.guardian_id FROM student_guardians sg JOIN students s ON s.id=sg.student_id
    WHERE s.full_name='Filho Fictício Lima' AND sg.school_id=$1`,[b.school_id]);
  assert.equal(rows[0].guardian_id,existing.id);
  const again=await importar(b,body([{student_name:'Outra Prima Lima',birth_date:'2015-11-11',guardian_name:'Tia Fictícia Com Outro Nome',guardian_cpf:CPF_OUTRO}],
    {academic_year_id:b.year.id}));
  assert.deepEqual((await again.json()).rows[0].actions.slice(0,2),['aluno novo','responsável já cadastrado']);
});

test('importacao: isolamento entre escolas, perfis e limites',async()=>{
  const before=[await counts(),await counts(b)];
  assert.equal((await importar(a,body(familia,{academic_year_id:b.year.id}))).status,404);
  assert.equal((await preview(a,body(familia,{academic_year_id:b.year.id}))).status,404);
  assert.equal((await fetch(`${base}/api/people/imports`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body(familia))})).status,401);
  for(const bad of [body(familia,{school_id:b.school_id}),{...body(familia),rows:[{line:2,...familia[0],extra:'x'}]},
    body(Array.from({length:MAX_IMPORT_ROWS+1},(_,i)=>({student_name:`Aluno ${i}`,birth_date:'2020-01-01'}))),
    {...body(familia),rows:[]},{...body(familia),guardians_are_legal:'sim'}]){
    assert.equal((await importar(a,bad)).status,400);
  }
  assert.equal((await importar(a,body(familia),'nao-e-uuid')).status,400);
  await admin.query("UPDATE users SET role='teacher' WHERE id=$1",[a.sub]);
  try{
    assert.equal((await importar(a,body(familia))).status,403);
    assert.equal((await preview(a,body(familia))).status,403);
  }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  assert.deepEqual([await counts(),await counts(b)],before);
});

test('importacao: RLS sem contexto, alfa_auth sem leitura, sem UPDATE/DELETE e startup exige RLS na tabela nova',async()=>{
  for(const table of importTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await withTenant(a,async c=>{const {rows}=await c.query(`SELECT school_id FROM public.${table}`);assert.ok(rows.length>0);assert.ok(rows.every(r=>r.school_id===a.school_id));});
    await admin.query(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY`);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/);}
    finally{await admin.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);}
  }
  await testDatabaseConnection();
});
