import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentRequest } from '../src/auth/enrollment-api.js';
const payload={student_id:'aluno',class_group_id:'turma',level_id:'serie'};
test('matricula preserva credencial e chave de reenvio sem injetar tenant ou periodo',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'/api/enrollments/');
    assert.equal(options.headers.Authorization,'Bearer token');
    assert.equal(options.headers['Idempotency-Key'],'same-key');
    assert.deepEqual(JSON.parse(options.body),payload);
    return Response.json({item:{id:'fixture'}});
  });
  const data=await enrollmentRequest('token','',{method:'POST',body:JSON.stringify(payload),headers:{'Idempotency-Key':'same-key'}});
  assert.equal(data.item.id,'fixture');
});
test('matricula distingue validacao, conflito, sessao expirada e falha de rede',async t=>{
  for(const status of [400,401,403,404,409,500]){
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({},{status}));
    await assert.rejects(()=>enrollmentRequest('token',''),e=>e.status===status);
    mock.mock.restore();
  }
  const conflict=t.mock.method(globalThis,'fetch',async()=>Response.json({},{status:409}));
  await assert.rejects(()=>enrollmentRequest('token',''),/já possui matrícula neste período/);
  conflict.mock.restore();
  const invalid=t.mock.method(globalThis,'fetch',async()=>new Response('texto'));
  await assert.rejects(()=>enrollmentRequest('token',''),/Resposta inválida/);
  invalid.mock.restore();
  t.mock.method(globalThis,'fetch',async()=>{throw Error('detalhe interno');});
  await assert.rejects(()=>enrollmentRequest('token',''),/reenvio não duplica/);
});
