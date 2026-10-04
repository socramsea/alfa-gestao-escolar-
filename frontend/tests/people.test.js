import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleRequest } from '../src/auth/people-api.js';
test('pessoas preserva credencial e chave de reenvio sem injetar tenant',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'/api/people/students');
    assert.equal(options.headers.Authorization,'Bearer token');
    assert.equal(options.headers['Idempotency-Key'],'same-key');
    assert.deepEqual(JSON.parse(options.body),{full_name:'Fictício',birth_date:'2020-01-01'});
    return Response.json({item:{id:'fixture'}});
  });
  const data=await peopleRequest('token','students',{method:'POST',body:JSON.stringify({full_name:'Fictício',birth_date:'2020-01-01'}),headers:{'Idempotency-Key':'same-key'}});
  assert.equal(data.item.id,'fixture');
});
test('pessoas distingue validacao, conflito, sessao expirada e falha de rede',async t=>{
  for(const status of [400,401,403,404,409,500]){
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({},{status}));
    await assert.rejects(()=>peopleRequest('token','guardians'),e=>e.status===status);
    mock.mock.restore();
  }
  t.mock.method(globalThis,'fetch',async()=>{throw Error('detalhe interno');});
  await assert.rejects(()=>peopleRequest('token','guardians'),/reenvio não duplica/);
});
