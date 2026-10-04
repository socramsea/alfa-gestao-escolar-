import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/database/pool.js';
import { signPortalToken } from '../src/modules/auth/tokens.js';
import { PASSWORD, api, createSchool, createUser, login, resetDatabase } from './helpers.js';

describe('autenticação da equipe', () => {
  let school: Awaited<ReturnType<typeof createSchool>>;

  beforeEach(async () => {
    await resetDatabase();
    school = await createSchool('alfa');
  });

  afterAll(() => pool.end());

  it('autentica com escola, e-mail e senha e retorna o perfil com permissões', async () => {
    const user = await createUser(school, 'secretary');
    const token = await login(user);

    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toMatchObject({ role: 'secretary', school: { slug: 'alfa' } });
    expect(me.body.permissions).toContain('renewals:review');
    expect(me.body.permissions).not.toContain('users:manage');
  });

  it('recusa senha incorreta e escola incorreta com a mesma mensagem', async () => {
    const user = await createUser(school, 'secretary');
    await createSchool('beta');

    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ school: 'alfa', email: user.email, password: 'errada123456' })
      .expect(401);
    const wrongSchool = await api()
      .post('/api/auth/login')
      .send({ school: 'beta', email: user.email, password: PASSWORD })
      .expect(401);

    expect(wrongPassword.body.error).toBe(wrongSchool.body.error);
  });

  it('recusa login de usuário inativo', async () => {
    const user = await createUser(school, 'secretary', { active: false });
    await api().post('/api/auth/login').send({ school: 'alfa', email: user.email, password: PASSWORD }).expect(401);
  });

  it('rejeita token de usuário desativado depois do login', async () => {
    const user = await createUser(school, 'secretary');
    const token = await login(user);
    await pool.query('UPDATE users SET active = false WHERE id = $1', [user.id]);

    await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('rejeita requisição sem token, com token inválido ou com header malformado', async () => {
    await api().get('/api/students').expect(401);
    await api().get('/api/students').set('Authorization', 'Bearer token-invalido').expect(401);
    await api().get('/api/students').set('Authorization', 'Token abc').expect(401);
  });

  it('não aceita token do portal do responsável nas rotas da equipe', async () => {
    const user = await createUser(school, 'school_admin');
    const portalToken = signPortalToken({ sub: user.id, school_id: school.id });

    await api().get('/api/students').set('Authorization', `Bearer ${portalToken}`).expect(401);
  });

  it('valida o corpo do login', async () => {
    const response = await api().post('/api/auth/login').send({ email: 'x' }).expect(400);
    expect(response.body.details).toBeInstanceOf(Array);
  });
});
