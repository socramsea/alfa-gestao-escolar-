import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { create, peopleTables } from '../../src/modules/people/service.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(()=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@people.test`}));
const [a,b]=fixtures;
const sample={full_name:'Aluno Fictício',birth_date:'2020-02-29'};
async function request(who,resource,data,key=randomUUID(),extra={}) {
  return fetch(`${base}/api/people/${resource}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${who.token}`,'Content-Type':'application/json','Idempotency-Key':key,...extra},...(data?{body:JSON.stringify(data)}:{})});
}
async function add(who,resource,data) {
  const res=await request(who,resource,data);assert.equal(res.status,201);return (await res.json()).item;
}
const link=(f,extra={})=>({student_id:f.student.id,guardian_id:f.guardian.id,relationship:'Mãe',is_legal:true,...extra});
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Pessoas ficticias','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    f.student=await add(f,'students',sample);f.guardian=await add(f,'guardians',{full_name:'Responsável Fictício'});
  }
});
after(async()=>{
  try{
    for(const table of ['people_events','student_guardians','guardians','students','users'])await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[fixtures.map(f=>f.school_id)]);
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[fixtures.map(f=>f.school_id)]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('pessoas: datas civis, contatos opcionais e listagens isoladas',async()=>{
  assert.equal(a.student.birth_date,'2020-02-29');assert.equal(a.guardian.email,null);assert.equal(a.guardian.phone,null);
  for(const resource of ['students','guardians']){
    const rows=(await (await request(a,resource)).json()).items;
    assert.equal(rows.length,1);assert.ok(rows.every(r=>r.school_id===a.school_id));
    const other=(await (await request(b,resource)).json()).items;
    assert.equal(other.length,1);assert.notEqual(rows[0].id,other[0].id);
  }
});
test('pessoas: vinculo persiste sem criar conta de responsavel e aceita relacao nao legal',async()=>{
  const before=(await admin.query('SELECT count(*) FROM users')).rows[0].count;
  const item=await add(a,'student-guardians',link(a));a.link=item;
  assert.equal(item.is_legal,true);assert.equal(item.student_id,a.student.id);
  assert.deepEqual((await (await request(b,'student-guardians')).json()).items,[]);
  const second=await add(a,'guardians',{full_name:'Avó Fictícia',phone:'(11) 99999-0000',email:'  AVO@EXAMPLE.TEST  '});
  assert.equal(second.email,'avo@example.test');
  const nonlegal=await add(a,'student-guardians',link(a,{guardian_id:second.id,relationship:'Avó',is_legal:false}));
  assert.equal(nonlegal.is_legal,false);
  const sibling=await add(a,'students',{...sample,full_name:'Outro Aluno Fictício'});
  await add(a,'student-guardians',link(a,{student_id:sibling.id}));
  assert.equal((await admin.query('SELECT count(*) FROM users')).rows[0].count,before);
});
test('pessoas: IDOR e referencias inexistentes ou de outra escola retornam 404 sem escrita',async()=>{
  for(const delta of [{student_id:b.student.id},{guardian_id:b.guardian.id},{student_id:randomUUID()},{guardian_id:randomUUID()}]){
    const key=randomUUID();assert.equal((await request(a,'student-guardians',link(a,delta),key)).status,404);
    assert.equal((await admin.query('SELECT id FROM people_events WHERE request_key=$1',[key])).rowCount,0);
  }
});
test('pessoas: tenant injetado, campos de portal/financeiro e parametros extras recusados',async()=>{
  for(const [resource,data] of [['students',sample],['guardians',{full_name:'Teste'}],['student-guardians',link(a)]]){
    assert.equal((await request(a,resource,{...data,school_id:b.school_id})).status,400);
    assert.equal((await request(a,`${resource}?school_id=${b.school_id}`)).status,400);
    assert.equal((await request(a,`${resource}?school_id=${b.school_id}`,data)).status,400);
    assert.equal((await request(a,resource,data,'chave-invalida')).status,400);
  }
  assert.equal((await request(a,'guardians',{full_name:'Teste',user_id:a.sub})).status,400);
  assert.equal((await request(a,'student-guardians',{...link(a),portal_access:true})).status,400);
  assert.equal((await request(a,'student-guardians',{...link(a),is_financial:true})).status,400);
  const r=await request(a,'students',undefined,randomUUID(),{'X-School-Id':b.school_id});
  assert.ok((await r.json()).items.every(i=>i.school_id===a.school_id));
});
test('pessoas: datas invalidas/futuras, nomes vazios, contatos invalidos e boolean string recusados',async()=>{
  for(const birth_date of ['2021-02-29','2020-02-30','2999-01-01','1899-12-31','2020-1-1'])assert.equal((await request(a,'students',{...sample,birth_date})).status,400);
  for(const full_name of ['   ','a'.repeat(151),'Nome\0Inválido'])assert.equal((await request(a,'students',{...sample,full_name})).status,400);
  for(const extra of [{email:'invalido'},{phone:'abc'},{phone:'++--'},{phone:'1'.repeat(31)}])assert.equal((await request(a,'guardians',{full_name:'Teste',...extra})).status,400);
  assert.equal((await request(a,'student-guardians',{...link(a),is_legal:'false'})).status,400);
  assert.equal((await request(a,'student-guardians',{...link(a),relationship:' '})).status,400);
  const item=await add(a,'guardians',{full_name:' Sem contato ',phone:' ',email:''});
  assert.equal(item.full_name,'Sem contato');assert.equal(item.email,null);assert.equal(item.phone,null);
});
test('pessoas: homonimos nao sao mesclados por nome, nascimento ou email',async()=>{
  const second=await add(a,'students',sample);assert.notEqual(second.id,a.student.id);
  const data={full_name:'Homônimo',email:'mesmo@example.test'};
  const first=await add(a,'guardians',data);const other=await add(a,'guardians',data);assert.notEqual(first.id,other.id);
});
test('pessoas: reenvio concorrente cria somente um registro/evento e conflito devolve 409',async()=>{
  for(const [resource,data] of [['students',{...sample,full_name:'Reenvio'}],['guardians',{full_name:'Reenvio'}]]){
    const key=randomUUID();const res=await Promise.all(Array.from({length:5},()=>request(a,resource,data,key)));
    assert.deepEqual(res.map(r=>r.status).sort(),[200,200,200,200,201]);
    const items=await Promise.all(res.map(r=>r.json()));assert.equal(new Set(items.map(r=>r.item.id)).size,1);
    assert.equal((await request(a,resource,{...data,full_name:'Alterado'},key)).status,409);
    const audit=(await admin.query('SELECT * FROM people_events WHERE request_key=$1',[key])).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].entity_id,items[0].item.id);
    assert.equal(Object.hasOwn(audit[0],'result'),false);assert.equal(Object.hasOwn(audit[0],'full_name'),false);
  }
});
test('pessoas: vinculo concorrente unico com reenvio e chaves diferentes',async()=>{
  const s=await add(a,'students',{...sample,full_name:'Vínculo concorrente'});const data=link(a,{student_id:s.id});const key=randomUUID();
  const same=await Promise.all([request(a,'student-guardians',data,key),request(a,'student-guardians',data,key)]);
  assert.deepEqual(same.map(r=>r.status).sort(),[200,201]);
  assert.equal((await request(a,'student-guardians',data)).status,409);
  const s2=await add(a,'students',{...sample,full_name:'Chaves diferentes'});
  const different=await Promise.all([request(a,'student-guardians',link(a,{student_id:s2.id})),request(a,'student-guardians',link(a,{student_id:s2.id}))]);
  assert.deepEqual(different.map(r=>r.status).sort(),[201,409]);
});
test('pessoas: mesma chave em tenants diferentes nao compartilha resultado',async()=>{
  const key=randomUUID(),data={full_name:'Chave igual'};
  const results=await Promise.all([request(a,'guardians',data,key),request(b,'guardians',data,key)]);
  assert.ok(results.every(r=>r.status===201));const [x,y]=await Promise.all(results.map(r=>r.json()));
  assert.notEqual(x.item.id,y.item.id);assert.equal(x.item.school_id,a.school_id);assert.equal(y.item.school_id,b.school_id);
});
test('pessoas: sem token e perfis nao administrativos negados; role atual prevalece',async()=>{
  for(const resource of ['students','guardians','student-guardians'])assert.equal((await fetch(`${base}/api/people/${resource}`)).status,401);
  for(const role of ['teacher','guardian']){
    await admin.query('UPDATE users SET role=$1 WHERE id=$2',[role,a.sub]);
    try{for(const [resource,data] of [['students',sample],['guardians',{full_name:'Negado'}],['student-guardians',link(a)]]){
      assert.equal((await request(a,resource)).status,403);assert.equal((await request(a,resource,data)).status,403);
    }}finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  }
  await admin.query("UPDATE users SET role='platform_admin' WHERE id=$1",[a.sub]);
  try{const r=await request(a,'students');assert.equal(r.status,200);assert.ok((await r.json()).items.every(i=>i.school_id===a.school_id));}
  finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
});
test('pessoas: escola suspensa bloqueia leitura e escrita',async()=>{
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try{assert.equal((await request(a,'students')).status,401);assert.equal((await request(a,'students',sample)).status,401);}
  finally{await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]);}
});
test('pessoas: RLS bilateral sem WHERE, ausencia de contexto e auth sem leitura inclusive COPY',async()=>{
  await add(b,'student-guardians',link(b));
  for(const table of peopleTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>authPool.query(`COPY public.${table} TO STDOUT`),e=>e.code==='42501');
    for(const f of fixtures)await withTenant(f,async c=>{
      const {rows}=await c.query(`SELECT * FROM public.${table}`);assert.ok(rows.length>0);assert.ok(rows.every(r=>r.school_id===f.school_id));
    });
  }
});
test('pessoas: banco bloqueia escrita cruzada e FKs aluno/responsavel/ator de outro tenant',async()=>{
  await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO students(school_id,full_name,birth_date) VALUES($1,'Cross','2020-01-01')",[b.school_id])),e=>e.code==='42501');
  await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO guardians(school_id,full_name) VALUES($1,'Cross')",[b.school_id])),e=>e.code==='42501');
  for(const [student_id,guardian_id] of [[b.student.id,a.guardian.id],[a.student.id,b.guardian.id]])await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO student_guardians(school_id,student_id,guardian_id,relationship,is_legal) VALUES($1,$2,$3,'Teste',false)",[a.school_id,student_id,guardian_id])),e=>e.code==='23503');
  await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO people_events(school_id,user_id,operation,request_key,payload_hash,entity_id) VALUES($1,$2,'students',$3,'hash',$4)",[a.school_id,b.sub,randomUUID(),a.student.id])),e=>e.code==='23503');
});
test('pessoas: auditoria invalida reverte criacao sem deixar registro ou evento',async()=>{
  const key=randomUUID();
  await assert.rejects(()=>withTenant(a,(c,u)=>create(c,{...u,id:b.sub},'students',{full_name:'ROLLBACK PESSOAS',birth_date:'2020-01-01'},key)),e=>e.code==='23503');
  assert.equal((await admin.query("SELECT id FROM students WHERE full_name='ROLLBACK PESSOAS'")).rowCount,0);
  assert.equal((await admin.query('SELECT id FROM people_events WHERE request_key=$1',[key])).rowCount,0);
});
test('pessoas: runtime sem UPDATE/DELETE; startup exige RLS FORCE em todas as novas tabelas',async()=>{
  for(const table of peopleTables){
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await admin.query(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY`);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/);}
    finally{await admin.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);}
  }
  await testDatabaseConnection();
});
test('pessoas: paginacao estavel sem omissao, repeticao ou mistura de tenant',async()=>{
  await admin.query("INSERT INTO students(school_id,full_name,birth_date) SELECT $1,'Página '||n,'2020-01-01' FROM generate_series(1,101) n",[b.school_id]);
  const first=await (await request(b,'students?page=1')).json();const second=await (await request(b,'students?page=2')).json();
  assert.equal(first.items.length,100);assert.equal(first.has_more,true);assert.equal(second.items.length,2);assert.equal(second.has_more,false);
  const all=[...first.items,...second.items];assert.equal(new Set(all.map(i=>i.id)).size,102);assert.ok(all.every(i=>i.school_id===b.school_id));
  assert.equal((await request(b,'students?page=0')).status,400);
});
