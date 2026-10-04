import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { create, enrollmentTables } from '../../src/modules/enrollments/service.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(()=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@enrollments.test`}));
const [a,b]=fixtures;
async function api(who,path,data,key=randomUUID(),extra={}) {
  return fetch(`${base}/api/${path}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${who.token}`,'Content-Type':'application/json','Idempotency-Key':key,...extra},...(data?{body:JSON.stringify(data)}:{})});
}
const request=(who,data,key,extra)=>api(who,'enrollments',data,key,extra);
async function add(who,path,data) {
  const res=await api(who,path,data);assert.equal(res.status,201,await res.clone().text());return (await res.json()).item;
}
const student=(f,full_name='Aluno Fictício')=>add(f,'people/students',{full_name,birth_date:'2020-02-29'});
const classData=(f,code,extra={})=>({code,stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.level.id],...extra});
const enrollment=(f,extra={})=>({student_id:f.student.id,class_group_id:f.group.id,level_id:f.level.id,...extra});
const events=key=>admin.query('SELECT * FROM enrollment_events WHERE request_key=$1',[key]);
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Matriculas ficticias','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    await add(f,'structure/stages',{code:'infantil'});
    f.year=await add(f,'structure/academic-years',{code:'2027',starts_on:'2027-02-01',ends_on:'2027-12-20'});
    f.shift=await add(f,'structure/shifts',{code:'MANHA',name:'Manhã'});
    f.level=await add(f,'structure/levels',{code:'G1',name:'Grupo 1',stage_code:'infantil'});
    f.group=await add(f,'structure/class-groups',classData(f,'T1'));
    f.student=await student(f);
  }
  a.nextYear=await add(a,'structure/academic-years',{code:'2028',starts_on:'2028-02-01',ends_on:'2028-12-20'});
  a.nextGroup=await add(a,'structure/class-groups',classData(a,'T1',{academic_year_id:a.nextYear.id}));
  a.otherLevel=await add(a,'structure/levels',{code:'G2',name:'Grupo 2',stage_code:'infantil'});
  a.otherGroup=await add(a,'structure/class-groups',classData(a,'T2'));
  a.multi=await add(a,'structure/class-groups',classData(a,'MULTI',{level_ids:[a.level.id,a.otherLevel.id]}));
});
after(async()=>{
  try{
    for(const table of ['enrollment_events','enrollments','people_events','student_guardians','guardians','students','structure_events',
      'class_group_levels','class_groups','school_levels','school_shifts','academic_years','school_stages','users']){
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[fixtures.map(f=>f.school_id)]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[fixtures.map(f=>f.school_id)]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('matriculas: persiste com periodo derivado da turma; listagem isolada',async()=>{
  const res=await request(a,enrollment(a));assert.equal(res.status,201);
  const {item,replayed}=await res.json();a.enrollment=item;
  assert.equal(replayed,false);assert.equal(item.school_id,a.school_id);assert.equal(item.student_id,a.student.id);
  assert.equal(item.academic_year_id,a.year.id);assert.equal(item.academic_year_code,'2027');
  assert.equal(item.class_group_code,'T1');assert.equal(item.level_code,'G1');assert.equal(item.student_name,'Aluno Fictício');
  const rows=(await (await request(a)).json()).items;
  assert.equal(rows.length,1);assert.equal(rows[0].id,item.id);
  assert.deepEqual((await (await request(b)).json()).items,[]);
});
test('matriculas: uma por aluno em cada periodo; outro periodo e turma multisseriada aceitos',async()=>{
  assert.equal((await request(a,enrollment(a))).status,409);
  assert.equal((await request(a,enrollment(a,{class_group_id:a.otherGroup.id}))).status,409);
  const next=await add(a,'enrollments',enrollment(a,{class_group_id:a.nextGroup.id}));
  assert.equal(next.academic_year_id,a.nextYear.id);
  const s=await student(a,'Multisseriado');
  const multi=await add(a,'enrollments',enrollment(a,{student_id:s.id,class_group_id:a.multi.id,level_id:a.otherLevel.id}));
  assert.equal(multi.level_id,a.otherLevel.id);
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE school_id=$1 AND student_id=$2',[a.school_id,a.student.id])).rowCount,2);
});
test('matriculas: chaves diferentes nao contornam unicidade concorrente',async()=>{
  const s=await student(a,'Concorrente');
  const res=await Promise.all([request(a,enrollment(a,{student_id:s.id})),request(a,enrollment(a,{student_id:s.id,class_group_id:a.otherGroup.id}))]);
  assert.deepEqual(res.map(r=>r.status).sort(),[201,409]);
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,1);
});
test('matriculas: reenvio concorrente cria um registro/evento; payload divergente devolve 409',async()=>{
  const s=await student(a,'Reenvio');const data=enrollment(a,{student_id:s.id});const key=randomUUID();
  const res=await Promise.all(Array.from({length:5},()=>request(a,data,key)));
  assert.deepEqual(res.map(r=>r.status).sort(),[200,200,200,200,201]);
  const items=await Promise.all(res.map(r=>r.json()));
  assert.equal(new Set(items.map(r=>r.item.id)).size,1);assert.equal(items.filter(r=>r.replayed).length,4);
  assert.equal((await request(a,{...data,class_group_id:a.otherGroup.id},key)).status,409);
  const audit=(await events(key)).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].entity_id,items[0].item.id);assert.equal(audit[0].user_id,a.sub);
  for(const column of ['result','student_id','full_name'])assert.equal(Object.hasOwn(audit[0],column),false);
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,1);
});
test('matriculas: mesma chave em tenants diferentes nao compartilha resultado',async()=>{
  const key=randomUUID();const s=await student(a,'Chave igual');
  const results=await Promise.all([request(a,enrollment(a,{student_id:s.id}),key),request(b,enrollment(b),key)]);
  assert.ok(results.every(r=>r.status===201));const [x,y]=await Promise.all(results.map(r=>r.json()));
  assert.notEqual(x.item.id,y.item.id);assert.equal(x.item.school_id,a.school_id);assert.equal(y.item.school_id,b.school_id);
});
test('matriculas: IDOR, referencias inexistentes e serie fora da turma retornam 404 sem escrita',async()=>{
  const s=await student(a,'Sem matrícula');
  for(const delta of [{student_id:b.student.id},{class_group_id:b.group.id},{level_id:b.level.id},
    {student_id:randomUUID()},{class_group_id:randomUUID()},{level_id:randomUUID()},{level_id:a.otherLevel.id}]){
    const key=randomUUID();assert.equal((await request(a,enrollment(a,{student_id:s.id,...delta}),key)).status,404);
    assert.equal((await events(key)).rowCount,0);
  }
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=ANY($1::uuid[])',[[s.id,b.student.id]])).rowCount,1);
});
test('matriculas: tenant injetado, periodo declarado, campos extras e parametros invalidos recusados',async()=>{
  const s=await student(a,'Validação');const data=enrollment(a,{student_id:s.id});
  for(const extra of [{school_id:b.school_id},{academic_year_id:a.nextYear.id},{status:'active'},{capacity:1}]){
    assert.equal((await request(a,{...data,...extra})).status,400);
  }
  for(const field of Object.keys(data)){
    const {[field]:_omitted,...missing}=data;assert.equal((await request(a,missing)).status,400);
    assert.equal((await request(a,{...data,[field]:'invalido'})).status,400);
  }
  assert.equal((await request(a,data,'chave-invalida')).status,400);
  assert.equal((await api(a,`enrollments?school_id=${b.school_id}`,data)).status,400);
  assert.equal((await api(a,`enrollments?school_id=${b.school_id}`)).status,400);
  assert.equal((await api(a,'enrollments?page=0')).status,400);
  const r=await request(a,undefined,randomUUID(),{'X-School-Id':b.school_id});
  assert.ok((await r.json()).items.every(i=>i.school_id===a.school_id));
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,0);
});
test('matriculas: sem token e perfis nao administrativos negados; role atual prevalece',async()=>{
  assert.equal((await fetch(`${base}/api/enrollments`)).status,401);
  const s=await student(a,'Negado');
  for(const role of ['teacher','guardian']){
    await admin.query('UPDATE users SET role=$1 WHERE id=$2',[role,a.sub]);
    try{assert.equal((await request(a)).status,403);assert.equal((await request(a,enrollment(a,{student_id:s.id}))).status,403);}
    finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  }
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,0);
  await admin.query("UPDATE users SET role='platform_admin' WHERE id=$1",[a.sub]);
  try{
    const r=await request(a);assert.equal(r.status,200);assert.ok((await r.json()).items.every(i=>i.school_id===a.school_id));
    assert.equal((await request(a,enrollment(a,{student_id:s.id,class_group_id:b.group.id,level_id:b.level.id}))).status,404);
  }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
});
test('matriculas: escola suspensa bloqueia leitura e escrita',async()=>{
  const s=await student(a,'Suspensa');
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try{assert.equal((await request(a)).status,401);assert.equal((await request(a,enrollment(a,{student_id:s.id}))).status,401);}
  finally{await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]);}
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,0);
});
test('matriculas: RLS bilateral sem WHERE, ausencia de contexto e auth sem leitura inclusive COPY',async()=>{
  for(const table of enrollmentTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>authPool.query(`COPY public.${table} TO STDOUT`),e=>e.code==='42501');
    for(const f of fixtures)await withTenant(f,async c=>{
      const {rows}=await c.query(`SELECT * FROM public.${table}`);assert.ok(rows.length>0);assert.ok(rows.every(r=>r.school_id===f.school_id));
    });
  }
});
test('matriculas: banco bloqueia escrita cruzada, FKs de outro tenant, periodo divergente e serie fora da turma',async()=>{
  const s=await student(a,'Banco');
  const insert=(who,values)=>withTenant(who,c=>c.query(`INSERT INTO enrollments(school_id,student_id,academic_year_id,class_group_id,level_id)
    VALUES($1,$2,$3,$4,$5)`,values));
  const valid=[a.school_id,s.id,a.year.id,a.group.id,a.level.id];
  await assert.rejects(()=>insert(a,[b.school_id,b.student.id,b.year.id,b.group.id,b.level.id]),e=>e.code==='42501');
  for(const [index,value] of [[1,b.student.id],[2,b.year.id],[3,b.group.id],[4,b.level.id],[2,a.nextYear.id],[4,a.otherLevel.id]]){
    await assert.rejects(()=>insert(a,valid.with(index,value)),e=>e.code==='23503');
  }
  await assert.rejects(()=>insert(a,valid.with(1,a.student.id)),e=>e.code==='23505');
  await assert.rejects(()=>withTenant(a,c=>c.query(`INSERT INTO enrollment_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,'enrollments',$3,'hash',$4)`,[a.school_id,b.sub,randomUUID(),a.enrollment.id])),e=>e.code==='23503');
  await assert.rejects(()=>withTenant(a,c=>c.query(`INSERT INTO enrollment_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,'enrollments',$3,'hash',$4)`,[a.school_id,a.sub,randomUUID(),randomUUID()])),e=>e.code==='23503');
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,0);
});
test('matriculas: auditoria invalida reverte criacao sem deixar matricula ou evento',async()=>{
  const s=await student(a,'Rollback');const key=randomUUID();
  await assert.rejects(()=>withTenant(a,(c,u)=>create(c,{...u,id:b.sub},enrollment(a,{student_id:s.id}),key)),e=>e.code==='23503');
  assert.equal((await admin.query('SELECT id FROM enrollments WHERE student_id=$1',[s.id])).rowCount,0);
  assert.equal((await events(key)).rowCount,0);
});
test('matriculas: runtime sem UPDATE/DELETE; startup exige RLS FORCE nas novas tabelas',async()=>{
  for(const table of enrollmentTables){
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await admin.query(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY`);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/);}
    finally{await admin.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);}
  }
  await testDatabaseConnection();
});
test('matriculas: paginacao estavel sem omissao, repeticao ou mistura de tenant',async()=>{
  await admin.query(`WITH s AS (INSERT INTO students(school_id,full_name,birth_date)
      SELECT $1,'Página '||n,'2020-01-01' FROM generate_series(1,101) n RETURNING id)
    INSERT INTO enrollments(school_id,student_id,academic_year_id,class_group_id,level_id) SELECT $1,s.id,$2,$3,$4 FROM s`,
  [b.school_id,b.year.id,b.group.id,b.level.id]);
  const first=await (await api(b,'enrollments?page=1')).json();const second=await (await api(b,'enrollments?page=2')).json();
  assert.equal(first.items.length,100);assert.equal(first.has_more,true);assert.equal(second.items.length,2);assert.equal(second.has_more,false);
  const all=[...first.items,...second.items];assert.equal(new Set(all.map(i=>i.id)).size,102);assert.ok(all.every(i=>i.school_id===b.school_id));
});
