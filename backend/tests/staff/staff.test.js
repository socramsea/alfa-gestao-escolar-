import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { create, staffTables } from '../../src/modules/staff/service.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const fixtures=[0,1].map(()=>({school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@staff.test`}));
const [a,b]=fixtures;
async function api(who,path,data,key=randomUUID(),extra={}) {
  return fetch(`${base}/api/${path}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${who.token}`,'Content-Type':'application/json','Idempotency-Key':key,...extra},...(data?{body:JSON.stringify(data)}:{})});
}
const request=(who,resource,data,key,extra)=>api(who,`staff/${resource}`,data,key,extra);
async function add(who,path,data) {
  const res=await api(who,path,data);assert.equal(res.status,201,await res.clone().text());return (await res.json()).item;
}
const member=(f,full_name='Profissional Fictício')=>add(f,'staff/members',{full_name});
const classData=(f,code,extra={})=>({code,stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.level.id],...extra});
const assignment=(f,extra={})=>({staff_member_id:f.member.id,class_group_id:f.group.id,role:'regente',starts_on:'2027-02-01',...extra});
const events=key=>admin.query('SELECT * FROM staff_events WHERE request_key=$1',[key]);
before(async()=>{
  const hash=await bcrypt.hash(password,12);
  for(const f of fixtures){
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Profissionais ficticios','active')",[f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",[f.sub,f.school_id,f.email,hash]);
    const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password})});
    assert.equal(login.status,200);f.token=(await login.json()).token;
    await add(f,'structure/stages',{code:'infantil'});
    f.year=await add(f,'structure/academic-years',{code:'2027',starts_on:'2027-02-01',ends_on:'2027-12-20'});
    f.shift=await add(f,'structure/shifts',{code:'MANHA',name:'Manhã'});
    f.level=await add(f,'structure/levels',{code:'G1',name:'Grupo 1',stage_code:'infantil'});
    f.group=await add(f,'structure/class-groups',classData(f,'T1'));
    f.member=await member(f);
  }
  a.otherGroup=await add(a,'structure/class-groups',classData(a,'T2'));
  a.nextYear=await add(a,'structure/academic-years',{code:'2028',starts_on:'2028-02-01',ends_on:'2028-12-20'});
});
after(async()=>{
  try{
    for(const table of ['staff_events','class_group_staff_endings','class_group_staff','staff_members','structure_events',
      'class_group_levels','class_groups','school_levels','school_shifts','academic_years','school_stages','users']){
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`,[fixtures.map(f=>f.school_id)]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[fixtures.map(f=>f.school_id)]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('profissionais: contatos opcionais normalizados, homonimos, listagem isolada e nenhuma conta criada',async()=>{
  const before=(await admin.query('SELECT count(*) FROM users')).rows[0].count;
  assert.equal(a.member.school_id,a.school_id);assert.equal(a.member.email,null);assert.equal(a.member.phone,null);
  const contact=await add(a,'staff/members',{full_name:' Com contato ',phone:'(11) 99999-0000',email:'  PROF@EXAMPLE.TEST  '});
  assert.equal(contact.full_name,'Com contato');assert.equal(contact.email,'prof@example.test');
  const blank=await add(a,'staff/members',{full_name:'Sem contato',phone:' ',email:''});
  assert.equal(blank.email,null);assert.equal(blank.phone,null);
  const twin=await member(a);assert.notEqual(twin.id,a.member.id);
  const rows=(await (await request(a,'members')).json()).items;
  assert.equal(rows.length,4);assert.ok(rows.every(r=>r.school_id===a.school_id));
  const other=(await (await request(b,'members')).json()).items;
  assert.equal(other.length,1);assert.equal(other[0].id,b.member.id);
  assert.equal((await admin.query('SELECT count(*) FROM users')).rows[0].count,before);
});
test('atribuicoes: periodo derivado da turma, fim opcional ate o fim do periodo e varios profissionais por turma',async()=>{
  const item=await add(a,'staff/assignments',assignment(a));a.assignment=item;
  assert.equal(item.school_id,a.school_id);assert.equal(item.academic_year_id,a.year.id);assert.equal(item.academic_year_code,'2027');
  assert.equal(item.class_group_code,'T1');assert.equal(item.staff_member_name,'Profissional Fictício');assert.equal(item.role,'regente');
  assert.equal(item.starts_on,'2027-02-01');assert.equal(item.ends_on,null);assert.equal(item.ended_on,null);assert.equal(item.effective_ends_on,'2027-12-20');
  const helper=await member(a,'Auxiliar');
  const second=await add(a,'staff/assignments',assignment(a,{staff_member_id:helper.id,role:'auxiliar',starts_on:'2027-03-01',ends_on:'2027-06-30'}));
  assert.equal(second.ends_on,'2027-06-30');assert.equal(second.effective_ends_on,'2027-06-30');
  const elsewhere=await add(a,'staff/assignments',assignment(a,{class_group_id:a.otherGroup.id,role:'especialista'}));
  assert.equal(elsewhere.class_group_code,'T2');
  const rows=(await (await request(a,'assignments')).json()).items;
  assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.class_group_id===a.group.id).length,2);
  assert.deepEqual((await (await request(b,'assignments')).json()).items,[]);
});
test('atribuicoes: mesmo profissional na mesma turma nao pode ter datas sobrepostas, nem com outro papel',async()=>{
  const m=await member(a,'Sobreposição');const base={staff_member_id:m.id,starts_on:'2027-03-01',ends_on:'2027-04-30'};
  await add(a,'staff/assignments',assignment(a,base));
  for(const delta of [{},{role:'auxiliar'},{starts_on:'2027-04-30',ends_on:'2027-05-31'},{starts_on:'2027-02-01',ends_on:'2027-03-01'},
    {starts_on:'2027-03-10',ends_on:'2027-03-20'},{starts_on:'2027-02-01',ends_on:null}]){
    assert.equal((await request(a,'assignments',assignment(a,{...base,...delta}))).status,409,JSON.stringify(delta));
  }
  await add(a,'staff/assignments',assignment(a,{...base,starts_on:'2027-05-01',ends_on:'2027-05-31'}));
  await add(a,'staff/assignments',assignment(a,{...base,starts_on:'2027-02-01',ends_on:'2027-02-28'}));
  const c=await member(a,'Concorrente');
  const res=await Promise.all([request(a,'assignments',assignment(a,{staff_member_id:c.id})),request(a,'assignments',assignment(a,{staff_member_id:c.id,role:'auxiliar'}))]);
  assert.deepEqual(res.map(r=>r.status).sort(),[201,409]);
  assert.equal((await admin.query('SELECT id FROM class_group_staff WHERE staff_member_id=$1',[c.id])).rowCount,1);
});
test('atribuicoes: datas fora do periodo da turma, fim antes do inicio, datas e papeis invalidos recusados',async()=>{
  const m=await member(a,'Validação');const data=assignment(a,{staff_member_id:m.id});
  for(const delta of [{starts_on:'2027-01-31'},{starts_on:'2027-12-21'},{ends_on:'2027-12-21'},{starts_on:'2027-05-01',ends_on:'2027-04-30'},
    {starts_on:'2027-02-30'},{starts_on:'2027-2-1'},{ends_on:'invalida'},{role:'diretor'},{role:''}]){
    assert.equal((await request(a,'assignments',{...data,...delta})).status,400,JSON.stringify(delta));
  }
  for(const field of ['staff_member_id','class_group_id','role','starts_on']){
    const {[field]:_omitted,...missing}=data;assert.equal((await request(a,'assignments',missing)).status,400);
  }
  for(const full_name of ['   ','a'.repeat(151),'Nome\0Inválido'])assert.equal((await request(a,'members',{full_name})).status,400);
  for(const extra of [{email:'invalido'},{phone:'abc'},{phone:'1'.repeat(31)}])assert.equal((await request(a,'members',{full_name:'Teste',...extra})).status,400);
  assert.equal((await admin.query('SELECT id FROM class_group_staff WHERE staff_member_id=$1',[m.id])).rowCount,0);
});
test('encerramento: registra o fim sem alterar a atribuicao, uma unica vez, e libera nova atribuicao depois',async()=>{
  const m=await member(a,'Encerramento');const item=await add(a,'staff/assignments',assignment(a,{staff_member_id:m.id}));
  for(const ended_on of ['2027-01-31','2027-12-21','2027-02-30'])assert.equal((await request(a,'assignment-endings',{assignment_id:item.id,ended_on})).status,400);
  const ending=await add(a,'staff/assignment-endings',{assignment_id:item.id,ended_on:'2027-06-30'});
  assert.equal(ending.assignment_id,item.id);assert.equal(ending.ended_on,'2027-06-30');
  const current=(await (await request(a,'assignments')).json()).items.find(r=>r.id===item.id);
  assert.equal(current.ends_on,null);assert.equal(current.ended_on,'2027-06-30');assert.equal(current.effective_ends_on,'2027-06-30');
  assert.equal((await request(a,'assignment-endings',{assignment_id:item.id,ended_on:'2027-05-31'})).status,409);
  assert.equal((await request(a,'assignments',assignment(a,{staff_member_id:m.id,starts_on:'2027-06-30'}))).status,409);
  const again=await add(a,'staff/assignments',assignment(a,{staff_member_id:m.id,starts_on:'2027-07-01'}));
  assert.equal(again.effective_ends_on,'2027-12-20');
  const fixed=await add(a,'staff/assignments',assignment(a,{class_group_id:a.otherGroup.id,staff_member_id:m.id,ends_on:'2027-06-30'}));
  assert.equal((await request(a,'assignment-endings',{assignment_id:fixed.id,ended_on:'2027-07-01'})).status,400);
  const res=await Promise.all(['2027-03-31','2027-04-30'].map(ended_on=>request(a,'assignment-endings',{assignment_id:fixed.id,ended_on})));
  assert.deepEqual(res.map(r=>r.status).sort(),[201,409]);
  assert.equal((await admin.query('SELECT id FROM class_group_staff_endings WHERE assignment_id=$1',[fixed.id])).rowCount,1);
});
test('profissionais: IDOR e referencias inexistentes ou de outra escola retornam 404 sem escrita',async()=>{
  b.assignment=await add(b,'staff/assignments',assignment(b));
  for(const delta of [{staff_member_id:b.member.id},{class_group_id:b.group.id},{staff_member_id:randomUUID()},{class_group_id:randomUUID()}]){
    const key=randomUUID();assert.equal((await request(a,'assignments',assignment(a,{starts_on:'2027-08-01',...delta}),key)).status,404);
    assert.equal((await events(key)).rowCount,0);
  }
  for(const assignment_id of [b.assignment.id,randomUUID()]){
    const key=randomUUID();assert.equal((await request(a,'assignment-endings',{assignment_id,ended_on:'2027-06-30'},key)).status,404);
    assert.equal((await events(key)).rowCount,0);
  }
  assert.equal((await admin.query('SELECT id FROM class_group_staff_endings WHERE assignment_id=$1',[b.assignment.id])).rowCount,0);
});
test('profissionais: tenant injetado, periodo declarado, conta de acesso e parametros extras recusados',async()=>{
  const m=await member(a,'Campos extras');
  const samples=[['members',{full_name:'Teste'}],['assignments',assignment(a,{staff_member_id:m.id})],['assignment-endings',{assignment_id:a.assignment.id,ended_on:'2027-06-30'}]];
  for(const [resource,data] of samples){
    assert.equal((await request(a,resource,{...data,school_id:b.school_id})).status,400);
    assert.equal((await request(a,`${resource}?school_id=${b.school_id}`)).status,400);
    assert.equal((await request(a,`${resource}?school_id=${b.school_id}`,data)).status,400);
    assert.equal((await request(a,`${resource}?page=0`)).status,400);
    assert.equal((await request(a,resource,data,'chave-invalida')).status,400);
  }
  for(const extra of [{user_id:a.sub},{password:'segredo-ficticio'},{role:'teacher'}])assert.equal((await request(a,'members',{full_name:'Teste',...extra})).status,400);
  for(const extra of [{academic_year_id:a.nextYear.id},{component:'Matemática'}])assert.equal((await request(a,'assignments',{...samples[1][1],...extra})).status,400);
  const r=await request(a,'members',undefined,randomUUID(),{'X-School-Id':b.school_id});
  assert.ok((await r.json()).items.every(i=>i.school_id===a.school_id));
  assert.equal((await admin.query('SELECT id FROM class_group_staff WHERE staff_member_id=$1',[m.id])).rowCount,0);
  assert.equal((await admin.query('SELECT id FROM class_group_staff_endings WHERE assignment_id=$1',[a.assignment.id])).rowCount,0);
});
test('profissionais: reenvio concorrente cria somente um registro/evento e conflito devolve 409',async()=>{
  const m=await member(a,'Reenvio');
  for(const [resource,data,table] of [['members',{full_name:'Reenvio concorrente'},'staff_members'],
    ['assignments',assignment(a,{staff_member_id:m.id}),'class_group_staff']]){
    const key=randomUUID();const res=await Promise.all(Array.from({length:5},()=>request(a,resource,data,key)));
    assert.deepEqual(res.map(r=>r.status).sort(),[200,200,200,200,201]);
    const items=await Promise.all(res.map(r=>r.json()));assert.equal(new Set(items.map(r=>r.item.id)).size,1);
    assert.equal((await request(a,resource,{...data,...(resource==='members'?{full_name:'Alterado'}:{role:'auxiliar'})},key)).status,409);
    const audit=(await events(key)).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].entity_id,items[0].item.id);assert.equal(audit[0].user_id,a.sub);
    for(const column of ['result','full_name','email'])assert.equal(Object.hasOwn(audit[0],column),false);
    assert.equal((await admin.query(`SELECT id FROM public.${table} WHERE id=$1`,[items[0].item.id])).rowCount,1);
  }
});
test('profissionais: mesma chave em tenants diferentes nao compartilha resultado',async()=>{
  const key=randomUUID(),data={full_name:'Chave igual'};
  const results=await Promise.all([request(a,'members',data,key),request(b,'members',data,key)]);
  assert.ok(results.every(r=>r.status===201));const [x,y]=await Promise.all(results.map(r=>r.json()));
  assert.notEqual(x.item.id,y.item.id);assert.equal(x.item.school_id,a.school_id);assert.equal(y.item.school_id,b.school_id);
});
test('profissionais: sem token e perfis nao administrativos negados; role atual prevalece',async()=>{
  const resources=['members','assignments','assignment-endings'];
  for(const resource of resources)assert.equal((await fetch(`${base}/api/staff/${resource}`)).status,401);
  for(const role of ['teacher','guardian']){
    await admin.query('UPDATE users SET role=$1 WHERE id=$2',[role,a.sub]);
    try{
      for(const resource of resources)assert.equal((await request(a,resource)).status,403);
      assert.equal((await request(a,'members',{full_name:'Negado'})).status,403);
      assert.equal((await request(a,'assignment-endings',{assignment_id:a.assignment.id,ended_on:'2027-06-30'})).status,403);
    }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  }
  await admin.query("UPDATE users SET role='platform_admin' WHERE id=$1",[a.sub]);
  try{
    const r=await request(a,'members');assert.equal(r.status,200);assert.ok((await r.json()).items.every(i=>i.school_id===a.school_id));
    assert.equal((await request(a,'assignment-endings',{assignment_id:b.assignment.id,ended_on:'2027-06-30'})).status,404);
  }finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
});
test('profissionais: escola suspensa bloqueia leitura e escrita',async()=>{
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try{assert.equal((await request(a,'members')).status,401);assert.equal((await request(a,'members',{full_name:'Suspensa'})).status,401);}
  finally{await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]);}
  assert.equal((await admin.query("SELECT id FROM staff_members WHERE full_name='Suspensa'")).rowCount,0);
});
test('profissionais: RLS bilateral sem WHERE, ausencia de contexto e auth sem leitura inclusive COPY',async()=>{
  await add(b,'staff/assignment-endings',{assignment_id:b.assignment.id,ended_on:'2027-06-30'});
  for(const table of staffTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>authPool.query(`COPY public.${table} TO STDOUT`),e=>e.code==='42501');
    for(const f of fixtures)await withTenant(f,async c=>{
      const {rows}=await c.query(`SELECT * FROM public.${table}`);assert.ok(rows.length>0);assert.ok(rows.every(r=>r.school_id===f.school_id));
    });
  }
});
test('profissionais: banco bloqueia escrita cruzada, FKs de outro tenant, periodo divergente e checks de papel e datas',async()=>{
  const insert=values=>withTenant(a,c=>c.query(`INSERT INTO class_group_staff(school_id,staff_member_id,academic_year_id,class_group_id,role,starts_on,ends_on)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,values));
  const valid=[a.school_id,a.member.id,a.year.id,a.group.id,'regente','2027-09-01','2027-09-30'];
  await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO staff_members(school_id,full_name) VALUES($1,'Cross')",[b.school_id])),e=>e.code==='42501');
  await assert.rejects(()=>insert(valid.with(0,b.school_id)),e=>e.code==='42501');
  for(const [index,value] of [[1,b.member.id],[2,b.year.id],[3,b.group.id],[2,a.nextYear.id]])await assert.rejects(()=>insert(valid.with(index,value)),e=>e.code==='23503');
  for(const [index,value] of [[4,'diretor'],[6,'2027-08-31']])await assert.rejects(()=>insert(valid.with(index,value)),e=>e.code==='23514');
  const ending=(assignment_id,school_id=a.school_id)=>withTenant(a,c=>c.query(`INSERT INTO class_group_staff_endings(school_id,assignment_id,ended_on)
    VALUES($1,$2,'2027-06-30')`,[school_id,assignment_id]));
  await assert.rejects(()=>ending(b.assignment.id),e=>e.code==='23503');
  await assert.rejects(()=>ending(b.assignment.id,b.school_id),e=>e.code==='42501');
  await assert.rejects(()=>withTenant(a,c=>c.query(`INSERT INTO staff_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,'members',$3,'hash',$4)`,[a.school_id,b.sub,randomUUID(),a.member.id])),e=>e.code==='23503');
});
test('profissionais: auditoria invalida reverte criacao sem deixar registro ou evento',async()=>{
  const key=randomUUID();
  await assert.rejects(()=>withTenant(a,(c,u)=>create(c,{...u,id:b.sub},'members',{full_name:'ROLLBACK PROFISSIONAL',phone:null,email:null},key)),e=>e.code==='23503');
  assert.equal((await admin.query("SELECT id FROM staff_members WHERE full_name='ROLLBACK PROFISSIONAL'")).rowCount,0);
  assert.equal((await events(key)).rowCount,0);
});
test('profissionais: runtime sem UPDATE/DELETE; startup exige RLS FORCE em todas as novas tabelas',async()=>{
  for(const table of staffTables){
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await admin.query(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY`);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/);}
    finally{await admin.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);}
  }
  await testDatabaseConnection();
});
test('profissionais: paginacao estavel sem omissao, repeticao ou mistura de tenant',async()=>{
  const total=Number((await admin.query('SELECT count(*) FROM staff_members WHERE school_id=$1',[b.school_id])).rows[0].count)+101;
  await admin.query("INSERT INTO staff_members(school_id,full_name) SELECT $1,'Página '||n FROM generate_series(1,101) n",[b.school_id]);
  const first=await (await request(b,'members?page=1')).json();const second=await (await request(b,'members?page=2')).json();
  assert.equal(first.items.length,100);assert.equal(first.has_more,true);assert.equal(second.items.length,total-100);assert.equal(second.has_more,false);
  const all=[...first.items,...second.items];assert.equal(new Set(all.map(i=>i.id)).size,total);assert.ok(all.every(i=>i.school_id===b.school_id));
});
