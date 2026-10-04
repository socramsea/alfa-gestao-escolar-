import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/database/pool.js';
import { PERMISSIONS } from '../src/modules/access/permissions.js';
import { api, createSchool, resetDatabase, staffSession } from './helpers.js';

describe('autorização por perfil', () => {
  let school: Awaited<ReturnType<typeof createSchool>>;

  beforeEach(async () => {
    await resetDatabase();
    school = await createSchool('alfa');
  });

  afterAll(() => pool.end());

  it('professor não acessa usuários, alunos nem renovações', async () => {
    const teacher = await staffSession(school, 'teacher');

    await api().get('/api/users').set(teacher.auth).expect(403);
    await api().get('/api/students').set(teacher.auth).expect(403);
    await api().get('/api/renewal-campaigns').set(teacher.auth).expect(403);
    await api().get('/api/classes').set(teacher.auth).expect(200);
  });

  it('direção acompanha o painel, mas não aprova renovações', async () => {
    const director = await staffSession(school, 'director');

    await api().get('/api/dashboard').set(director.auth).expect(200);
    await api()
      .post('/api/renewal-requests/00000000-0000-0000-0000-000000000000/approve')
      .set(director.auth)
      .expect(403);
  });

  it('somente o administrador da escola cria usuários', async () => {
    const secretary = await staffSession(school, 'secretary');
    const admin = await staffSession(school, 'school_admin');
    const newUser = { name: 'Nova Pessoa', email: 'nova@alfa.test', role: 'teacher', password: 'SenhaForte123' };

    await api().post('/api/users').set(secretary.auth).send(newUser).expect(403);
    await api().post('/api/users').set(admin.auth).send(newUser).expect(201);
    await api().post('/api/users').set(admin.auth).send(newUser).expect(409);
  });

  it('administrador não pode desativar a si mesmo', async () => {
    const admin = await staffSession(school, 'school_admin');
    await api().patch(`/api/users/${admin.user.id}`).set(admin.auth).send({ active: false }).expect(400);
  });

  it('toda permissão está atribuída a pelo menos um perfil', () => {
    for (const roles of Object.values(PERMISSIONS)) expect(roles.length).toBeGreaterThan(0);
  });
});
