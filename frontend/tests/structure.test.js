import test from 'node:test';
import assert from 'node:assert/strict';
import { structureRequest } from '../src/auth/structure-api.js';
test('estrutura envia token e preserva chave de idempotencia', async t => {
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(url,'/api/structure/shifts');
    assert.equal(options.headers.Authorization,'Bearer token');
    assert.equal(options.headers['Idempotency-Key'],'same-key');
    return Response.json({item:{id:'fixture'}});
  });
  assert.equal((await structureRequest('token','shifts',{method:'POST',headers:{'Idempotency-Key':'same-key'},body:'{}'})).item.id,'fixture');
});
test('estrutura distingue conflito, expiracao e falha de rede', async t => {
  for (const status of [401,403,404,409,500]) {
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({}, {status}));
    await assert.rejects(()=>structureRequest('token','shifts'), e=>e.status===status);
    mock.mock.restore();
  }
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('network detail');});
  await assert.rejects(()=>structureRequest('token','shifts'),/reenvio não duplica/);
});
