import test from 'node:test';
import assert from 'node:assert/strict';
import { request, canAccessSecretaria } from '../src/auth/api.js';

const user = { id: 'user-id', school_id: 'school-id', role: 'school_admin' };
test('login envia somente credenciais ao endpoint', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/auth/login');
    assert.deepEqual(JSON.parse(options.body), { email: 'admin@example.test', password: 'example' });
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ user, token: 'token' });
  });
  assert.equal((await request('login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.test', password: 'example' }) })).token, 'token');
});
test('consulta de identidade envia bearer e usa perfil retornado pela API', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/auth/me');
    assert.equal(options.headers.Authorization, 'Bearer session-token');
    return Response.json({ user });
  });
  assert.deepEqual((await request('me', { token: 'session-token' })).user, user);
});
test('401 distingue sessao invalida de indisponibilidade', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'invalid' }, { status: 401 }));
  await assert.rejects(request('me'), error => error.status === 401);
});
test('falha de rede retorna mensagem sem expor detalhes internos', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('internal connection detail'); });
  await assert.rejects(request('login'), /Não foi possível conectar ao servidor/);
});
test('resposta sem identidade nao permite autenticacao', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ token: 'token' }));
  await assert.rejects(request('login'), /Resposta de autenticação inválida/);
});
test('resposta HTML do proxy nao e aceita como autenticacao', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>error</html>'));
  await assert.rejects(request('me'), /Resposta de autenticação inválida/);
});
test('secretaria permite apenas os dois perfis administrativos existentes', () => {
  for (const role of ['school_admin', 'platform_admin']) assert.equal(canAccessSecretaria({ role }), true);
  for (const role of ['teacher', 'guardian', 'parent', '', undefined]) assert.equal(canAccessSecretaria({ role }), false);
  assert.equal(canAccessSecretaria(null), false);
});
