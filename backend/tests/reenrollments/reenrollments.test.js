import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool as admin } from '../../src/config/admin-db.js';
import { pool, authPool, testDatabaseConnection } from '../../src/config/db.js';
import { withTenant } from '../../src/security/tenant-context.js';
import { reenrollmentTables, UNDER_CONSTRUCTION } from '../../src/modules/reenrollments/service.js';
if(process.env.TEST_ALLOW_MUTATION !== 'fictional-fixtures')throw Error('Fixtures explicitas obrigatorias');
// Esqueleto da entrega 10: tabelas com RLS e rotas que ainda respondem 501.
const base=process.env.TEST_BASE_URL;
const password=randomUUID();
const a={school_id:randomUUID(),sub:randomUUID(),email:`${randomUUID()}@renovacao.test`};
const call=(path,method='GET',token)=>fetch(`${base}/api/${path}`,{method,headers:{'Content-Type':'application/json',
  'Idempotency-Key':randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},...(method==='POST'?{body:'{}'}:{})});
before(async()=>{
  await admin.query("INSERT INTO schools(id,name,status) VALUES($1,'Renovacao ficticia','active')",[a.school_id]);
  await admin.query("INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES($1,$2,'Fixture',$3,$4,'school_admin')",
    [a.sub,a.school_id,a.email,await bcrypt.hash(password,12)]);
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password})});
  assert.equal(login.status,200);a.token=(await login.json()).token;
});
after(async()=>{
  try{
    await admin.query('DELETE FROM users WHERE school_id=$1',[a.school_id]);
    await admin.query('DELETE FROM schools WHERE id=$1',[a.school_id]);
  }finally{await Promise.all([admin.end(),pool.end(),authPool.end()]);}
});

test('renovacao (esqueleto): rotas respondem 501 em portugues, com login e perfil exigidos na secretaria',async()=>{
  for(const [path,method] of [['reenrollments/campaigns','GET'],['reenrollments/campaigns','POST'],['reenrollments','GET'],
    ['reenrollments','POST'],['reenrollments/links','POST'],['reenrollments/document-requests','POST'],
    ['reenrollments/reviews','POST'],[`reenrollments/${randomUUID()}`,'GET']]){
    const res=await call(path,method,a.token);
    assert.equal(res.status,501,`${method} ${path}`);assert.deepEqual(await res.json(),{error:UNDER_CONSTRUCTION});
  }
  assert.equal((await call('reenrollments/campaigns')).status,401);
  await admin.query("UPDATE users SET role='teacher' WHERE id=$1",[a.sub]);
  try{assert.equal((await call('reenrollments/campaigns','GET',a.token)).status,403);}
  finally{await admin.query("UPDATE users SET role='school_admin' WHERE id=$1",[a.sub]);}
  for(const path of ['family/reenrollments/access','family/reenrollments/submissions']){
    const res=await call(path,'POST');
    assert.equal(res.status,501,path);assert.deepEqual(await res.json(),{error:UNDER_CONSTRUCTION});
  }
});

test('renovacao (esqueleto): RLS FORCE nas tabelas novas, so insercao e startup exige RLS',async()=>{
  assert.equal(reenrollmentTables.length,9);
  for(const table of reenrollmentTables){
    assert.equal((await pool.query(`SELECT * FROM public.${table}`)).rowCount,0);
    await assert.rejects(()=>authPool.query(`SELECT * FROM public.${table}`),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`DELETE FROM public.${table}`)),e=>e.code==='42501');
    await assert.rejects(()=>withTenant(a,c=>c.query(`UPDATE public.${table} SET school_id=school_id`)),e=>e.code==='42501');
    await admin.query(`ALTER TABLE public.${table} NO FORCE ROW LEVEL SECURITY`);
    try{await assert.rejects(()=>testDatabaseConnection(),/RLS obrigatorio/);}
    finally{await admin.query(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);}
  }
  await testDatabaseConnection();
});
