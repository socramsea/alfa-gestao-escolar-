import test from 'node:test';
import assert from 'node:assert/strict';
import { staffRequest } from '../src/auth/staff-api.js';
const payload={staff_member_id:'profissional',class_group_id:'turma',role:'regente',starts_on:'2027-02-01',ends_on:null};
test('profissionais preserva credencial e chave de reenvio sem injetar tenant ou periodo',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'/api/staff/assignments');
    assert.equal(options.headers.Authorization,'Bearer token');
    assert.equal(options.headers['Idempotency-Key'],'same-key');
    assert.deepEqual(JSON.parse(options.body),payload);
    return Response.json({item:{id:'fixture'}});
  });
  const data=await staffRequest('token','assignments',{method:'POST',body:JSON.stringify(payload),headers:{'Idempotency-Key':'same-key'}});
  assert.equal(data.item.id,'fixture');
});
test('profissionais distingue validacao, conflito, sessao expirada e falha de rede',async t=>{
  for(const status of [400,401,403,404,409,500]){
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({},{status}));
    await assert.rejects(()=>staffRequest('token','members'),e=>e.status===status);
    mock.mock.restore();
  }
  const conflict=t.mock.method(globalThis,'fetch',async()=>Response.json({},{status:409}));
  await assert.rejects(()=>staffRequest('token','assignments'),/já tem atribuição nesta turma/);
  conflict.mock.restore();
  t.mock.method(globalThis,'fetch',async()=>{throw Error('detalhe interno');});
  await assert.rejects(()=>staffRequest('token','members'),/reenvio não duplica/);
});
