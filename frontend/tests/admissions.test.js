import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionsRequest, publicSiteRequest } from '../src/auth/admissions-api.js';

test('captacao preserva credencial e chave de reenvio sem injetar escola', async t => {
  const payload = { lead_id: 'interessado', status: 'em_contato', note: null };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/admissions/lead-updates');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.headers['Idempotency-Key'], 'same-key');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), payload);
    return Response.json({ item: { id: 'fixture' } });
  });
  const data = await admissionsRequest('token', 'lead-updates', { method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': 'same-key' } });
  assert.equal(data.item.id, 'fixture');
});

test('captacao envia foto com o tipo do arquivo, sem forcar JSON', async t => {
  const file = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers['Content-Type'], 'image/png');
    assert.equal(options.body, file);
    return Response.json({ item: { id: 'foto' } }, { status: 201 });
  });
  const data = await admissionsRequest('token', 'site/images', { method: 'POST', body: file, headers: { 'Content-Type': 'image/png', 'Idempotency-Key': 'k' } });
  assert.equal(data.item.id, 'foto');
});

test('captacao distingue validacao, conflito, sessao, foto grande e falha de rede', async t => {
  for (const status of [400, 401, 403, 404, 409, 413, 500]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status }));
    await assert.rejects(() => admissionsRequest('token', 'leads'), e => e.status === status);
    mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => { throw Error('detalhe interno'); });
  await assert.rejects(() => admissionsRequest('token', 'leads'), /reenvio não duplica/);
});

test('site publico nao envia credencial, codifica o endereco e explica horario lotado', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith('/leads')) return Response.json({ error: 'x', reason: 'slot_unavailable' }, { status: 409 });
    return Response.json({ school_name: 'Escola' });
  });
  await publicSiteRequest('alfa reis');
  assert.equal(calls[0][0], '/api/public/sites/alfa%20reis');
  assert.equal(calls[0][1].headers.Authorization, undefined);
  await assert.rejects(() => publicSiteRequest('alfa-reis', '/leads', { method: 'POST', body: '{}' }), /horário acabou de ser preenchido/);
});

test('site publico distingue reenvio divergente, limite e indisponibilidade', async t => {
  for (const [status, body, pattern] of [[409, { reason: 'conflict' }, /já foi registrado/], [429, {}, /Muitos envios/],
    [404, {}, /não está disponível/], [400, {}, /Confira os campos/]]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
    await assert.rejects(() => publicSiteRequest('alfa-reis', '/leads', { method: 'POST' }), pattern);
    mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => { throw Error('rede'); });
  await assert.rejects(() => publicSiteRequest('alfa-reis'), /não duplica sua pré-matrícula/);
});
