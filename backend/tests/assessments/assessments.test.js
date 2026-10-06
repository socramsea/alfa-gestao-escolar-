import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { pool as admin, administrativeUrl } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { assessmentTables, MAX_SCORES } from '../../src/modules/assessments/service.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(()=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@notas.test`}));
const [a,b]=fixtures;
async function api(who,path,data,key=randomUUID(),extra={}) {
  return fetch(`${base}/api/${path}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${who.token}`,'Content-Type':'application/json','Idempotency-Key':key,...extra},...(data?{body:JSON.stringify(data)}:{})});
}
async function add(who,path,data) {
  const res=await api(who,path,data);assert.equal(res.status,201,await res.clone().text());return (await res.json()).item;
}
async function expectError(res,status,message) {
  const body=await res.json();
  assert.equal(res.status,status,JSON.stringify(body));
  assert.match(body.error,message);
  return body;
}
const classData=(f,code)=>({code,stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.level.id]});
const book=(f,group=f.group)=>api(f,`assessments?class_group_id=${group.id}`);
const launch=(f,assessment,scores,key,extra)=>api(f,`assessments/${assessment.id}/scores`,{scores},key,extra);
const history=(f,assessment)=>api(f,`assessments/${assessment.id}/scores`);
const rows=assessment=>admin.query('SELECT * FROM student_assessments WHERE assessment_id=$1 ORDER BY created_at,id',[assessment.id]);
const student=f=>book(f).then(r=>r.json()).then(g=>Object.fromEntries(g.students.map(s=>[s.student_id,s])));
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Notas ficticias','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Secretaria Fictícia',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    await add(f,'structure/stages',{code:'infantil'});
    f.year=await add(f,'structure/academic-years',{code:'2027',starts_on:'2027-02-01',ends_on:'2027-12-20'});
    f.shift=await add(f,'structure/shifts',{code:'MANHA',name:'Manhã'});
    f.level=await add(f,'structure/levels',{code:'G1',name:'Grupo 1',stage_code:'infantil'});
    f.group=await add(f,'structure/class-groups',classData(f,'T1'));
    f.students=[];
    for(const name of ['Ana Fictícia','Bruno Fictício','Carla Fictícia']){
      const s=await add(f,'people/students',{full_name:name,birth_date:'2020-03-10'});
      await add(f,'enrollments',{student_id:s.id,class_group_id:f.group.id,level_id:f.level.id});
      f.students.push(s);
    }
  }
  a.otherGroup=await add(a,'structure/class-groups',classData(a,'T2'));
  a.outsider=await add(a,'people/students',{full_name:'Davi de Outra Turma',birth_date:'2020-05-01'});
  await add(a,'enrollments',{student_id:a.outsider.id,class_group_id:a.otherGroup.id,level_id:a.level.id});
  a.prova=await add(a,'assessments/types',{code:'prova',name:'Prova',default_weight:2});
  a.trabalho=await add(a,'assessments/types',{code:'TRABALHO',name:'Trabalho',default_weight:1});
  a.p1=await add(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.prova.id,title:'Prova 1',held_on:'2027-04-10'});
  a.t1=await add(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.trabalho.id,title:'Trabalho em grupo',held_on:'2027-03-20',weight:1});
  b.prova=await add(b,'assessments/types',{code:'PROVA',name:'Prova',default_weight:1});
  b.p1=await add(b,'assessments',{class_group_id:b.group.id,assessment_type_id:b.prova.id,title:'Prova B',held_on:'2027-04-10'});
});
after(async()=>{
  try{
    for(const table of ['outbox_events','assessment_events','student_assessments','assessments','assessment_types',
      'enrollment_events','enrollments','people_events','students','structure_events',
      'class_group_levels','class_groups','school_levels','school_shifts','academic_years','school_stages','users']){
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[fixtures.map(f=>f.school_id)]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[fixtures.map(f=>f.school_id)]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('notas: tipos e avaliacoes da turma, peso padrao do tipo e data dentro do periodo letivo',async()=>{
  assert.equal(a.prova.code,'PROVA');assert.equal(a.prova.default_weight,2);
  assert.equal(a.p1.weight,2,'sem peso informado, vale o peso padrão do tipo');
  assert.equal(a.t1.weight,1);assert.equal(a.p1.academic_year_id,a.year.id);assert.equal(a.p1.scored_count,0);
  await expectError(await api(a,'assessments/types',{code:'PROVA',name:'Outra prova',default_weight:3}),409,/Já existe um tipo de avaliação com este código/);
  await expectError(await api(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.prova.id,title:'Fora do ano',held_on:'2028-01-10'}),
    400,/dentro do período letivo da turma, de 01\/02\/2027 a 20\/12\/2027/);
  await expectError(await api(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.prova.id,title:'Data inexistente',held_on:'2027-02-30'}),
    400,/Data da avaliação inválida/);
  const types=(await (await api(a,'assessments/types')).json()).items;
  assert.deepEqual(types.map(t=>t.code),['PROVA','TRABALHO']);
  const g=await (await book(a)).json();
  assert.equal(g.class_group.code,'T1');
  assert.deepEqual(g.assessments.map(x=>x.title),['Trabalho em grupo','Prova 1'],'avaliações em ordem de data');
  assert.deepEqual(g.students.map(s=>s.student_name),['Ana Fictícia','Bruno Fictício','Carla Fictícia'],'só os matriculados na turma');
  assert.ok(g.students.every(s=>s.average===null && s.graded_count===0 && s.scores.length===0));
});

test('notas: lancamento em lote e media ponderada Σ(nota × peso) / Σ(peso)',async()=>{
  const [ana,bruno,carla]=a.students;
  const res=await launch(a,a.p1,[{student_id:ana.id,score:8},{student_id:bruno.id,score:5.5},{student_id:carla.id,score:10}]);
  const body=await res.json();
  assert.equal(res.status,201,JSON.stringify(body));
  assert.equal(body.launched,3);assert.equal(body.corrected,0);assert.equal(body.replayed,false);
  assert.deepEqual(body.scores.map(s=>s.score),[8,5.5,10]);
  assert.equal((await launch(a,a.t1,[{student_id:ana.id,score:5},{student_id:bruno.id,score:7}])).status,201);
  const s=await student(a);
  assert.equal(s[ana.id].average,7,'(8×2 + 5×1) / 3');
  assert.equal(s[bruno.id].average,6,'(5,5×2 + 7×1) / 3');
  assert.equal(s[carla.id].average,10,'avaliação sem nota fica fora da média');
  assert.equal(s[carla.id].graded_count,1);assert.equal(s[ana.id].graded_count,2);
  const g=await (await book(a)).json();
  assert.deepEqual(g.assessments.map(x=>x.scored_count),[2,3]);
});

test('notas: correcao e linha nova com corrects_id e motivo; a original fica no historico',async()=>{
  const bruno=a.students[1];
  const original=(await rows(a.p1)).rows.find(r=>r.student_id===bruno.id);
  const before=(await rows(a.p1)).rowCount;
  let body=await expectError(await launch(a,a.p1,[{student_id:bruno.id,score:6.5}]),409,/Nenhuma nota foi gravada/);
  assert.match(body.items[0].error,/já tem nota\. Para mudar, envie a correção com o motivo/);
  body=await expectError(await launch(a,a.p1,[{student_id:bruno.id,score:6.5,corrects_id:original.id}]),400,/Informe o motivo da correção/);
  assert.equal(body.field,'scores.0.reason');
  body=await expectError(await launch(a,a.p1,[{student_id:bruno.id,score:5.5,corrects_id:original.id,reason:'Revisão'}]),400,/Nenhuma nota foi gravada/);
  assert.equal(body.items[0].error,'A nota corrigida é igual à nota atual.');
  assert.equal((await rows(a.p1)).rowCount,before,'nada gravado nas tentativas recusadas');
  const res=await launch(a,a.p1,[{student_id:bruno.id,score:6.5,corrects_id:original.id,reason:'Questão 3 recontada'}]);
  body=await res.json();assert.equal(res.status,201,JSON.stringify(body));
  assert.equal(body.corrected,1);assert.equal(body.launched,0);assert.equal(body.scores[0].corrects_id,original.id);
  const stored=(await rows(a.p1)).rows.filter(r=>r.student_id===bruno.id);
  assert.equal(stored.length,2);assert.equal(stored[0].score,'5.50','a nota original não muda');
  assert.equal(stored[1].corrects_id,original.id);assert.equal(stored[1].reason,'Questão 3 recontada');
  assert.equal((await student(a))[bruno.id].average,6.67,'(6,5×2 + 7×1) / 3 com a nota corrigida');
  body=await expectError(await launch(a,a.p1,[{student_id:bruno.id,score:7,corrects_id:original.id,reason:'De novo'}]),409,/Nenhuma nota foi gravada/);
  assert.match(body.items[0].error,/mudou desde que a lista foi aberta/,'corrigir uma nota que já foi corrigida é conflito');
  const h=await (await history(a,a.p1)).json();
  const mine=h.items.filter(i=>i.student_id===bruno.id);
  assert.deepEqual(mine.map(i=>[i.score,i.current,i.reason]),[[5.5,false,null],[6.5,true,'Questão 3 recontada']]);
  assert.equal(mine[1].created_by_name,'Secretaria Fictícia');
  const g=await (await book(a)).json();
  const cell=g.students.find(s=>s.student_id===bruno.id).scores.find(x=>x.assessment_id===a.p1.id);
  assert.deepEqual([cell.score,cell.corrected],[6.5,true]);
  assert.equal(g.assessments.find(x=>x.id===a.p1.id).scored_count,3,'correção não conta como aluno novo');
});

test('notas: lote tudo ou nada com erros por item em portugues',async()=>{
  const assessment=await add(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.trabalho.id,title:'Lista de exercícios',held_on:'2027-05-02'});
  const [ana,bruno]=a.students;
  let body=await expectError(await launch(a,assessment,[{student_id:ana.id,score:9},{student_id:a.outsider.id,score:7},{student_id:ana.id,score:8}]),
    400,/corrija os itens indicados\. Nenhuma nota foi gravada/);
  assert.deepEqual(body.items.map(i=>[i.index,i.error]),[[1,'O aluno não está matriculado nesta turma.'],[2,'Aluno repetido neste envio.']]);
  body=await expectError(await launch(a,assessment,[{student_id:bruno.id,score:7,corrects_id:randomUUID(),reason:'x'}]),409,/Nenhuma nota/);
  assert.equal(body.items[0].error,'Este aluno ainda não tem nota para corrigir.');
  assert.equal((await rows(assessment)).rowCount,0,'nenhuma nota do lote recusado foi gravada');
  for(const [score,message] of [[11,/entre 0 e 10/],[-1,/entre 0 e 10/],[7.555,/duas casas decimais/],['7',/Informe a nota/],[null,/Informe a nota/]]){
    body=await expectError(await launch(a,assessment,[{student_id:ana.id,score}]),400,message);
    assert.equal(body.field,'scores.0.score');
  }
  await expectError(await launch(a,assessment,[]),400,/Informe pelo menos uma nota/);
  await expectError(await launch(a,assessment,Array.from({length:MAX_SCORES+1},()=>({student_id:ana.id,score:5}))),400,new RegExp(`no máximo ${MAX_SCORES} notas`));
  await expectError(await launch(a,assessment,[{student_id:ana.id,score:5,nota:5}]),400,/Campo não permitido: nota\./);
  await expectError(await launch(a,assessment,[{student_id:'aluno',score:5}]),400,/Aluno inválido/);
  await expectError(await api(a,`assessments/${assessment.id}/scores`,[1,2]),400,/Envie os dados da avaliação/);
  await expectError(await api(a,'assessments',{class_group_id:a.group.id,title:'Sem tipo',held_on:'2027-05-02'}),400,/Escolha o tipo de avaliação/);
  await expectError(await api(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.prova.id,title:'Peso zero',held_on:'2027-05-02',weight:0}),
    400,/O peso deve ser maior que 0/);
  await expectError(await api(a,'assessments?class_group_id=turma'),400,/Turma inválida/);
  await expectError(await api(a,'assessments'),400,/Escolha a turma/);
  await expectError(await api(a,`assessments/${randomUUID()}/scores`,{scores:[{student_id:ana.id,score:5}]}),404,/Avaliação não encontrada na sua escola/);
  await expectError(await api(a,'assessments/types',{code:'PROVA FINAL',name:'x',default_weight:1}),400,/letras sem acento, números/);
  const ok=await launch(a,assessment,[{student_id:ana.id,score:9},{student_id:bruno.id,score:0}]);
  assert.equal(ok.status,201,await ok.clone().text());
  assert.deepEqual((await rows(assessment)).rows.map(r=>r.score).sort(),['0.00','9.00'],'nota zero é nota, não ausência');
});

test('notas: Idempotency-Key repete o resultado sem duplicar e recusa reuso com outros dados',async()=>{
  const assessment=await add(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.trabalho.id,title:'Ditado',held_on:'2027-06-01'});
  const [ana,bruno]=a.students;
  const key=randomUUID(),scores=[{student_id:ana.id,score:7.25},{student_id:bruno.id,score:8}];
  const first=await launch(a,assessment,scores,key);const original=await first.json();
  assert.equal(first.status,201);
  const again=await launch(a,assessment,scores,key);const replay=await again.json();
  assert.equal(again.status,200);assert.equal(replay.replayed,true);
  assert.deepEqual({...replay,replayed:false},original);
  assert.equal((await rows(assessment)).rowCount,2,'o reenvio não grava de novo');
  await expectError(await launch(a,assessment,[{student_id:ana.id,score:1}],key),409,/chave de envio já foi usada com outros dados/);
  await expectError(await launch(a,assessment,scores,'nao-e-uuid'),400,/Idempotency-Key/);
  const res=await fetch(`${base}/api/assessments/${assessment.id}/scores`,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({scores})});
  await expectError(res,400,/Idempotency-Key/);
  const typeKey=randomUUID(),type={code:'SIMULADO',name:'Simulado',default_weight:1.5};
  const t1=await api(a,'assessments/types',type,typeKey),t2=await api(a,'assessments/types',type,typeKey);
  assert.deepEqual([t1.status,t2.status],[201,200]);
  assert.equal((await t1.json()).item.id,(await t2.json()).item.id);
  const events=await admin.query('SELECT operation,count(*)::int AS n FROM assessment_events WHERE request_key=ANY($1::uuid[]) GROUP BY operation ORDER BY operation',[[key,typeKey]]);
  const stored=(await admin.query('SELECT result FROM assessment_events WHERE request_key=$1',[key])).rows[0].result;
  assert.deepEqual(Object.keys(stored).sort(),['assessment_id','corrected','launched','student_assessment_ids'],'o registro de idempotência não copia as notas');
  assert.deepEqual(events.rows,[{operation:'scores',n:1},{operation:'types',n:1}]);
});

test('notas: evento nota_lancada no canal interno, na mesma transacao das notas',async()=>{
  const assessment=await add(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.prova.id,title:'Prova 2',held_on:'2027-09-15'});
  const [ana,bruno,carla]=a.students;
  const listener=new pg.Client({connectionString:administrativeUrl()});
  await listener.connect();
  const heard=[];listener.on('notification',n=>heard.push([n.channel,JSON.parse(n.payload)]));
  await listener.query('LISTEN alfa_eventos');
  try{
    await expectError(await launch(a,assessment,[{student_id:ana.id,score:7},{student_id:a.outsider.id,score:7}]),400,/Nenhuma nota/);
    const res=await launch(a,assessment,[{student_id:ana.id,score:7},{student_id:bruno.id,score:8},{student_id:carla.id,score:9}]);
    const body=await res.json();assert.equal(res.status,201);
    for(let i=0;i<50 && !heard.length;i++)await new Promise(r=>setTimeout(r,20));
    assert.deepEqual(heard,[['alfa_eventos',{topic:'nota_lancada'}]],'um aviso por lote confirmado; o lote recusado não avisa');
    const {rows:events}=await admin.query('SELECT topic,entity_id,payload FROM outbox_events WHERE payload->>\'assessment_id\'=$1 ORDER BY created_at,id',[assessment.id]);
    assert.equal(events.length,3);
    assert.ok(events.every(e=>e.topic==='nota_lancada'));
    assert.deepEqual(new Set(events.map(e=>e.entity_id)),new Set(body.scores.map(s=>s.student_assessment_id)));
    const one=events.find(e=>e.payload.student_id===ana.id);
    assert.deepEqual(Object.keys(one.payload).sort(),['assessment_id','corrects_id','student_assessment_id','student_id'],'só identificadores, sem nota nem nome');
    const fix=await launch(a,assessment,[{student_id:ana.id,score:7.5,corrects_id:one.entity_id,reason:'Revisão'}]);
    assert.equal(fix.status,201);
    const {rows:after}=await admin.query('SELECT payload FROM outbox_events WHERE payload->>\'corrects_id\'=$1',[one.entity_id]);
    assert.equal(after.length,1,'a correção também publica nota_lancada, com corrects_id');
  }finally{await listener.end();}
});

test('notas: RLS, escola B nao ve nem lanca na escola A',async()=>{
  await expectError(await book(b,a.group),404,/Turma não encontrada na sua escola/);
  await expectError(await history(b,a.p1),404,/Avaliação não encontrada na sua escola/);
  await expectError(await launch(b,a.p1,[{student_id:a.students[0].id,score:1}]),404,/Avaliação não encontrada na sua escola/);
  await expectError(await api(b,'assessments',{class_group_id:b.group.id,assessment_type_id:a.prova.id,title:'Tipo alheio',held_on:'2027-04-01'}),
    404,/Tipo de avaliação não encontrado na sua escola/);
  await expectError(await api(b,'assessments',{class_group_id:a.group.id,assessment_type_id:b.prova.id,title:'Turma alheia',held_on:'2027-04-01'}),
    404,/Turma não encontrada na sua escola/);
  const body=await expectError(await launch(b,b.p1,[{student_id:a.students[0].id,score:1}]),400,/Nenhuma nota/);
  assert.equal(body.items[0].error,'O aluno não está matriculado nesta turma.');
  assert.deepEqual((await (await api(b,'assessments/types')).json()).items.map(t=>t.id),[b.prova.id]);
  const gb=await (await book(b)).json();
  assert.deepEqual(gb.assessments.map(x=>x.id),[b.p1.id]);
  assert.ok(gb.students.every(s=>s.average===null));
  for(const table of assessmentTables){
    const {rows}=await withTenant(b,c=>c.query(`SELECT school_id FROM public.${table}`));
    assert.ok(rows.every(r=>r.school_id===b.school_id),`${table}: escola B só enxerga as próprias linhas`);
  }
  await assert.rejects(()=>withTenant(b,c=>c.query('INSERT INTO public.student_assessments(school_id,assessment_id,student_id,score,created_by) VALUES($1,$2,$3,5,$4)',
    [a.school_id,a.p1.id,a.students[2].id,b.sub])),e=>e.code==='42501','escrever na escola A com o contexto da escola B é barrado pelo RLS');
});

test('notas: so insercao, RLS FORCE em todas as tabelas, alfa_auth sem leitura e perfil sem permissao',async()=>{
  for(const table of assessmentTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0,`${table}: sem contexto de escola, nada aparece`);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await admin.query(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY`);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/);}
    finally{await admin.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);}
  }
  await testDatabaseConnection();
  await assert.rejects(()=>admin.query("INSERT INTO student_assessments(school_id,assessment_id,student_id,score,corrects_id,created_by) SELECT school_id,assessment_id,student_id,1,id,created_by FROM student_assessments WHERE school_id=$1 LIMIT 1",[a.school_id]),
    e=>e.code==='23514','correção sem motivo é barrada também no banco');
  await admin.query("UPDATE users SET role='teacher' WHERE id=$1",[a.sub]);
  try{
    await expectError(await book(a),403,/Permissão insuficiente/);
    await expectError(await launch(a,a.p1,[{student_id:a.students[0].id,score:1}]),403,/Permissão insuficiente/);
  }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  const anonymous=await fetch(`${base}/api/assessments?class_group_id=${a.group.id}`);
  assert.equal(anonymous.status,401);
});

test('notas: dois lancamentos simultaneos para o mesmo aluno gravam uma nota so',async()=>{
  const assessment=await add(a,'assessments',{class_group_id:a.group.id,assessment_type_id:a.trabalho.id,title:'Corrida de notas',held_on:'2027-10-01'});
  const carla=a.students[2];
  const results=await Promise.all([6,9].map(score=>launch(a,assessment,[{student_id:carla.id,score}])));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const loser=await results.find(r=>r.status===409).json();
  assert.match(loser.items[0].error,/já tem nota/);
  assert.equal((await rows(assessment)).rowCount,1);
});
