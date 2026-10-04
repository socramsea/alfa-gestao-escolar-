import supertest from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/database/pool.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import type { StaffRole } from '../src/modules/access/permissions.js';

export const api = () => supertest(app);
export const PASSWORD = 'SenhaForte123';

export async function resetDatabase() {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  await pool.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(', ')} CASCADE`);
}

let passwordHash: string | undefined;

export async function createSchool(slug: string) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO schools (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
    [`Escola ${slug}`, slug],
  );
  return { id: rows[0].id, slug };
}

export async function createUser(school: { id: string; slug: string }, role: StaffRole, overrides: { active?: boolean } = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  const email = `${role}-${Math.random().toString(36).slice(2, 8)}@${school.slug}.test`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (school_id, name, email, role, password_hash, active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [school.id, `Usuário ${role}`, email, role, passwordHash, overrides.active ?? true],
  );
  return { id: rows[0].id, email, school };
}

export async function login(user: { email: string; school: { slug: string } }) {
  const response = await api()
    .post('/api/auth/login')
    .send({ school: user.school.slug, email: user.email, password: PASSWORD })
    .expect(200);
  return response.body.token as string;
}

export async function staffSession(school: { id: string; slug: string }, role: StaffRole) {
  const user = await createUser(school, role);
  const token = await login(user);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

export async function createYearAndClass(auth: Record<string, string>, year = 2027, name = '1º Ano A') {
  const yearResponse = await api().post('/api/school-years').set(auth).send({ year }).expect(201);
  const classResponse = await api()
    .post('/api/classes')
    .set(auth)
    .send({ school_year_id: yearResponse.body.id, name, grade: name.replace(/ [A-Z]$/, ''), shift: 'morning' })
    .expect(201);
  return { yearId: yearResponse.body.id as string, classId: classResponse.body.id as string };
}

export async function createStudent(auth: Record<string, string>, overrides: Record<string, unknown> = {}) {
  const response = await api()
    .post('/api/students')
    .set(auth)
    .send({
      full_name: 'Maria Fictícia da Silva',
      birth_date: '2018-03-15',
      guardians: [{ full_name: 'Ana Fictícia da Silva', phone: '(11) 98888-7777', relationship: 'mother' }],
      ...overrides,
    })
    .expect(201);
  return response.body;
}
