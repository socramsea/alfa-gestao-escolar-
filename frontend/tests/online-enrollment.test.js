import test from 'node:test';
import assert from 'node:assert/strict';
import { familyRequest, onlineEnrollmentRequest } from '../src/auth/online-enrollment-api.js';

test('matricula online da equipe envia credencial e chave de reenvio', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/online-enrollments/reviews');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.headers['Idempotency-Key'], 'k');
    return Response.json({ item: { id: 'r' } }, { status: 201 });
  });
  assert.equal((await onlineEnrollmentRequest('token', 'reviews', { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'k' } })).item.id, 'r');
});

test('area da familia envia link e nascimento no corpo, nunca na URL nem como credencial', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/family/enrollments/access');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { token: 'abc', birth_date: '2021-04-22' });
    return Response.json({ state: 'convidada' });
  });
  assert.equal((await familyRequest('access', { token: 'abc', birth_date: '2021-04-22' })).state, 'convidada');
});

test('area da familia explica data errada, bloqueio, regras alteradas e ficha ja enviada', async t => {
  for (const [status, body, pattern] of [[401, {}, /Verifique a data/], [429, {}, /bloqueado/], [409, { reason: 'settings_changed' }, /Recarregue/],
    [409, { reason: 'closed' }, /já foi enviada/], [400, {}, /CPF válido/]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
    await assert.rejects(() => familyRequest('submissions', {}), pattern);
    mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => { throw Error('rede'); });
  await assert.rejects(() => familyRequest('access', {}), /não duplica sua ficha/);
});
