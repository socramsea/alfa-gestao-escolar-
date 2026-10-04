import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { create } from '../../src/modules/structure/service.js';
import { structureTables } from '../../src/modules/structure/catalog.js';
if (process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures') throw new Error('Fixtures explicitas obrigatorias');
const base = process.env.TEST_BASE_URL;
const password = randomUUID();
const fixtures = [0,1].map(() => ({ school_id: randomUUID(), sub: randomUUID(), email: `${randomUUID()}@structure.test` }));
const [a,b] = fixtures;
async function request(who, resource, data, key = randomUUID()) {
  return fetch(`${base}/api/structure/${resource}`, { method: data ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type':'application/json','Idempotency-Key':key },
    ...(data ? { body: JSON.stringify(data) } : {}) });
}
async function add(who,resource,data) {
  const response = await request(who,resource,data); assert.equal(response.status,201, await response.clone().text());
  return (await response.json()).item;
}
before(async () => {
  const hash = await bcrypt.hash(password,12);
  for (const f of fixtures) {
    await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Structure fixture','active')", [f.school_id]);
    await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')", [f.sub,f.school_id,f.email,hash]);
    const res = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password}) });
    assert.equal(res.status,200); f.token = (await res.json()).token;
    await add(f,'stages',{code:'infantil'});
    f.year = await add(f,'academic-years',{code:'2027',starts_on:'2027-02-01',ends_on:'2027-12-20'});
    f.shift = await add(f,'shifts',{code:'MANHA',name:'Manhã'});
    f.level = await add(f,'levels',{code:'G1',name:'Grupo 1',stage_code:'infantil'});
  }
});
after(async () => {
  try {
    for (const table of ['structure_events','class_group_levels','class_groups','school_levels','school_shifts','academic_years','school_stages','users']) {
      await admin.query(`DELETE FROM public.${table} WHERE school_id=ANY($1::uuid[])`, [fixtures.map(f=>f.school_id)]);
    }
    await admin.query('DELETE FROM schools WHERE id=ANY($1::uuid[])',[fixtures.map(f=>f.school_id)]);
  } finally { await Promise.all([admin.end(),pool.end(),authPool.end()]); }
});
const classData = (f,code='T1') => ({code,stage_code:'infantil',academic_year_id:f.year.id,shift_id:f.shift.id,level_ids:[f.level.id]});

test('estrutura persiste turma e datas civis; consulta isolada', async () => {
  const item = await add(a,'class-groups',classData(a));
  assert.equal(item.school_id,a.school_id); assert.deepEqual(item.level_ids,[a.level.id]);
  assert.equal(a.year.starts_on,'2027-02-01');
  const rows = (await (await request(a,'class-groups')).json()).items;
  assert.equal(rows[0].id,item.id);
  assert.deepEqual((await (await request(b,'class-groups')).json()).items,[]);
});
test('três etapas coexistem e turma aceita grupos da mesma etapa', async () => {
  for (const [stage,code] of [['fundamental_initial','ANO1'],['fundamental_final','ANO6']]) {
    await add(a,'stages',{code:stage});
    const level = await add(a,'levels',{code,name:code,stage_code:stage});
    const item = await add(a,'class-groups',{...classData(a,code),stage_code:stage,level_ids:[level.id]});
    assert.equal(item.stage_code,stage);
    assert.equal((await request(a,'class-groups',{...classData(a,`${code}INVALID`),level_ids:[level.id]})).status,404);
  }
  const second = await add(a,'levels',{code:'G2',name:'Grupo 2',stage_code:'infantil'});
  const multi = await add(a,'class-groups',{...classData(a,'MULTI'),level_ids:[a.level.id,second.id]});
  assert.equal(multi.level_ids.length,2);
});
test('referencias de outra escola e etapa nao oferecida recusadas', async () => {
  for (const change of [{academic_year_id:b.year.id},{shift_id:b.shift.id},{level_ids:[b.level.id]}]) {
    assert.equal((await request(a,'class-groups',{...classData(a,randomUUID()),...change})).status,404);
  }
  assert.equal((await request(b,'levels',{code:'INVALID',name:'Inválido',stage_code:'fundamental_final'})).status,404);
});
test('tenant no payload, datas invalidas, duplicidade de niveis e query invalidas recusados', async () => {
  assert.equal((await request(a,'shifts',{code:'X',name:'X',school_id:b.school_id})).status,400);
  for (const starts_on of ['2027-02-30','2028-01-01']) {
    assert.equal((await request(a,'academic-years',{code:'BAD',starts_on,ends_on:'2027-12-20'})).status,400);
  }
  assert.equal((await request(a,'class-groups',{...classData(a,'BAD'),level_ids:[a.level.id,a.level.id]})).status,400);
  assert.equal((await request(a,'class-groups',{...classData(a,'EMPTY'),level_ids:[]})).status,400);
  assert.equal((await request(a,'shifts?page=0')).status,400);
  assert.equal((await request(a,`shifts?school_id=${b.school_id}`)).status,400);
  assert.equal((await request(a,'shifts',{code:'BAD',name:'Bad'},'invalid-key')).status,400);
});
test('reenvio concorrente produz um registro e um evento; payload divergente gera conflito', async () => {
  const key = randomUUID(); const body = {code:'REPLAY',name:'Reenvio'};
  const responses = await Promise.all(Array.from({length:5},()=>request(a,'shifts',body,key)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,200,200,201]);
  const data = await Promise.all(responses.map(r=>r.json()));
  assert.equal(new Set(data.map(d=>d.item.id)).size,1);
  assert.equal((await request(a,'shifts',{...body,name:'Diferente'},key)).status,409);
  const count = await admin.query('SELECT count(*)::int AS n FROM structure_events WHERE school_id=$1 AND request_key=$2',[a.school_id,key]);
  assert.equal(count.rows[0].n,1);
});
test('chaves diferentes nao contornam unicidade concorrente', async () => {
  const res = await Promise.all([request(a,'shifts',{code:'UNIQUE',name:'Teste'}),request(a,'shifts',{code:'unique',name:'Teste'})]);
  assert.deepEqual(res.map(r=>r.status).sort(),[201,409]);
});
test('perfis nao administrativos negados e token antigo respeita role atual', async () => {
  await admin.query("UPDATE users SET role='teacher' WHERE id=$1",[a.sub]);
  try {
    assert.equal((await request(a,'shifts')).status,403);
    assert.equal((await request(a,'shifts',{code:'DENIED',name:'Denied'})).status,403);
    assert.equal((await request(a,'catalog')).status,403);
  } finally { await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]); }
});
test('sem token e escola suspensa nao acessam estrutura', async () => {
  assert.equal((await fetch(`${base}/api/structure/shifts`)).status,401);
  await admin.query("UPDATE schools SET status='suspended' WHERE id=$1",[a.school_id]);
  try { assert.equal((await request(a,'shifts')).status,401); }
  finally { await admin.query("UPDATE schools SET status='active' WHERE id=$1",[a.school_id]); }
});
test('RLS sem contexto nega leitura; com contexto filtra mesmo sem WHERE; auth sem grants', async () => {
  for (const table of structureTables) {
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await withTenant(a,async c => {
      const rows = (await c.query(`SELECT * FROM public.${table}`)).rows;
      assert.ok(rows.every(row=>row.school_id===a.school_id));
    });
  }
});
test('RLS de escrita e FK composta bloqueiam tenant e referencias cruzadas diretamente', async () => {
  await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO school_shifts(school_id,code,name) VALUES($1,'CROSS','Cross')",[b.school_id])),e=>e.code==='42501');
  await assert.rejects(()=>withTenant(a,c=>c.query("INSERT INTO class_groups(school_id,academic_year_id,shift_id,stage_code,code) VALUES($1,$2,$3,'infantil','CROSS')",[a.school_id,b.year.id,a.shift.id])),e=>e.code==='23503');
  await assert.rejects(()=>withTenant(a,c=>c.query(`INSERT INTO structure_events(school_id,user_id,operation,request_key,payload_hash,entity_id,result)
    VALUES($1,$2,'cross',$3,'hash',$4,'{}')`,[a.school_id,b.sub,randomUUID(),randomUUID()])),e=>e.code==='23503');
});
test('falha de auditoria reverte cadastro e nao deixa evento', async () => {
  const key = randomUUID();
  await assert.rejects(()=>withTenant(a,(c,u)=>create(c,{...u,id:b.sub},'shifts',{code:'ROLLBACK',name:'Rollback'},key)),e=>e.code==='23503');
  assert.equal((await admin.query("SELECT id FROM school_shifts WHERE school_id=$1 AND code='ROLLBACK'",[a.school_id])).rowCount,0);
  assert.equal((await admin.query('SELECT id FROM structure_events WHERE request_key=$1',[key])).rowCount,0);
});
test('runtime nao altera/apaga eventos ou registros; startup exige RLS nas novas tabelas', async () => {
  for (const table of structureTables) {
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
  }
  await admin.query('ALTER TABLE school_shifts NO FORCE ROW LEVEL SECURITY');
  try { await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/); }
  finally { await admin.query('ALTER TABLE school_shifts FORCE ROW LEVEL SECURITY'); }
  await testDatabaseConnection();
});
test('paginacao retorna todos os registros sem repeticao nem mistura de escolas', async () => {
  await admin.query(`INSERT INTO school_shifts(school_id,code,name)
    SELECT $1,'PAGE_'||n,'Página '||n FROM generate_series(1,101) n`,[b.school_id]);
  const first = await (await request(b,'shifts?page=1')).json();
  const second = await (await request(b,'shifts?page=2')).json();
  assert.equal(first.items.length,100); assert.equal(first.has_more,true);
  assert.equal(second.items.length,2); assert.equal(second.has_more,false);
  const items=[...first.items,...second.items];
  assert.equal(new Set(items.map(i=>i.id)).size,102);
  assert.ok(items.every(i=>i.school_id===b.school_id));
});
