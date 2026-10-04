import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/database/pool.js';
import { api, createSchool, createStudent, createYearAndClass, resetDatabase, staffSession } from './helpers.js';

describe('isolamento entre escolas', () => {
  let schoolA: Awaited<ReturnType<typeof staffSession>>;
  let schoolB: Awaited<ReturnType<typeof staffSession>>;
  let studentA: { id: string; guardians: { id: string }[] };
  let classA: string;

  beforeEach(async () => {
    await resetDatabase();
    schoolA = await staffSession(await createSchool('escola-a'), 'school_admin');
    schoolB = await staffSession(await createSchool('escola-b'), 'school_admin');
    ({ classId: classA } = await createYearAndClass(schoolA.auth));
    studentA = await createStudent(schoolA.auth, { full_name: 'Aluno Da Escola A', current_class_id: classA });
  });

  afterAll(() => pool.end());

  it('lista apenas os alunos da própria escola', async () => {
    await createStudent(schoolB.auth, { full_name: 'Aluno Da Escola B' });

    const response = await api().get('/api/students').set(schoolB.auth).expect(200);
    expect(response.body.data.map((student: { full_name: string }) => student.full_name)).toEqual(['Aluno Da Escola B']);
  });

  it('ignora school_id enviado pelo cliente', async () => {
    const response = await api()
      .get('/api/users')
      .query({ school_id: schoolA.user.school.id })
      .set(schoolB.auth)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(schoolB.user.id);
  });

  it('responde 404 ao acessar diretamente registros de outra escola', async () => {
    await api().get(`/api/students/${studentA.id}`).set(schoolB.auth).expect(404);
    await api().patch(`/api/students/${studentA.id}`).set(schoolB.auth).send({ full_name: 'Invadido' }).expect(404);
    await api().delete(`/api/students/${studentA.id}`).set(schoolB.auth).expect(404);
    await api().get(`/api/guardians/${studentA.guardians[0].id}`).set(schoolB.auth).expect(404);
    await api().post(`/api/guardians/${studentA.guardians[0].id}/access-links`).set(schoolB.auth).expect(404);
    await api().patch(`/api/users/${schoolA.user.id}`).set(schoolB.auth).send({ active: false }).expect(404);

    const student = await api().get(`/api/students/${studentA.id}`).set(schoolA.auth).expect(200);
    expect(student.body.full_name).toBe('Aluno Da Escola A');
  });

  it('não permite vincular aluno a turma ou responsável de outra escola', async () => {
    await api()
      .post('/api/students')
      .set(schoolB.auth)
      .send({
        full_name: 'Aluno B',
        birth_date: '2018-01-01',
        current_class_id: classA,
        guardians: [{ full_name: 'Resp B', relationship: 'father' }],
      })
      .expect(404);

    await api()
      .post('/api/students')
      .set(schoolB.auth)
      .send({
        full_name: 'Aluno B',
        birth_date: '2018-01-01',
        guardians: [{ guardian_id: studentA.guardians[0].id, relationship: 'father' }],
      })
      .expect(404);
  });

  it('o banco recusa referências cruzadas mesmo que o código falhe', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO students (school_id, full_name, birth_date) VALUES ($1, 'Aluno B', '2018-01-01') RETURNING id`,
      [schoolB.user.school.id],
    );

    await expect(
      pool.query('UPDATE students SET current_class_id = $1 WHERE id = $2', [classA, rows[0].id]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('dashboard e auditoria mostram apenas dados da própria escola', async () => {
    const dashboard = await api().get('/api/dashboard').set(schoolB.auth).expect(200);
    expect(dashboard.body.active_students).toBe(0);

    const audit = await api().get('/api/audit-logs').set(schoolB.auth).expect(200);
    expect(audit.body.data.every((entry: { action: string }) => entry.action === 'auth.login')).toBe(true);
  });
});
