/**
 * Dados FICTÍCIOS para demonstração. Nunca execute em produção.
 *
 *   npm run db:seed            cria a Escola Alfa Reis (demo) se ainda não existir
 *   npm run db:seed -- --reset apaga TODOS os dados e recria a demonstração
 */
import { env } from '../config/env.js';
import { hashPassword } from '../modules/auth/passwords.js';
import { generateOpaqueToken, hashToken } from '../modules/auth/tokens.js';
import type { StaffRole } from '../modules/access/permissions.js';
import { approveRequest, lockRequest, syncCampaignRequests, transition } from '../modules/renewals/service.js';
import { createStudent } from '../modules/students/service.js';
import type { PoolClient } from 'pg';
import {
  type LeadStatus,
  LEAD_SOURCES,
  bookVisit,
  changeLeadStatus,
  createLead,
} from '../modules/admissions/service.js';
import { withTransaction } from '../shared/db.js';
import { DEMO_SITE_CONTENT } from './demo-site.js';
import { pool } from './pool.js';

export const DEMO_PASSWORD = 'AlfaDemo2026';

const FIRST_NAMES = ['Ana', 'Bruno', 'Clara', 'Davi', 'Elisa', 'Felipe', 'Giovana', 'Heitor', 'Isabela', 'João',
  'Lara', 'Miguel', 'Nina', 'Otávio', 'Pietra', 'Rafael', 'Sofia', 'Theo', 'Valentina', 'Arthur', 'Helena',
  'Lucas', 'Manuela', 'Gabriel', 'Alice', 'Samuel', 'Laura', 'Enzo', 'Beatriz', 'Pedro'];
const MOTHER_NAMES = ['Mariana', 'Patrícia', 'Fernanda', 'Juliana', 'Camila', 'Renata', 'Aline', 'Tatiane'];
const FATHER_NAMES = ['Carlos', 'Ricardo', 'Rodrigo', 'André', 'Marcelo', 'Paulo', 'Fábio'];
const SURNAMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Lima', 'Carvalho', 'Ferreira', 'Rodrigues',
  'Almeida', 'Costa', 'Gomes', 'Martins', 'Araújo', 'Barbosa'];

const CLASSES = [
  { name: 'Infantil 5 A', grade: 'Infantil 5', next: '1º Ano A', age: 5 },
  { name: '1º Ano A', grade: '1º Ano', next: '2º Ano A', age: 6 },
  { name: '2º Ano A', grade: '2º Ano', next: '3º Ano A', age: 7 },
  { name: '3º Ano A', grade: '3º Ano', next: '4º Ano A', age: 8 },
  { name: '4º Ano A', grade: '4º Ano', next: '5º Ano A', age: 9 },
  { name: '5º Ano A', grade: '5º Ano', next: null, age: 10 },
];

const STAFF: { name: string; role: StaffRole; email: string }[] = [
  { name: 'Admin Demo', role: 'school_admin', email: 'admin@alfareis.demo' },
  { name: 'Diretora Demo', role: 'director', email: 'direcao@alfareis.demo' },
  { name: 'Secretária Demo', role: 'secretary', email: 'secretaria@alfareis.demo' },
  { name: 'Financeiro Demo', role: 'finance', email: 'financeiro@alfareis.demo' },
  { name: 'Coordenação Demo', role: 'coordinator', email: 'coordenacao@alfareis.demo' },
  { name: 'Professor Demo', role: 'teacher', email: 'professor@alfareis.demo' },
];

// Gerador determinístico para que a demonstração seja sempre igual.
let state = 42;
const random = () => ((state = (state * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

async function seed() {
  if (env.NODE_ENV === 'production') throw new Error('Seed de demonstração não pode rodar em produção');

  if (process.argv.includes('--reset')) {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
    );
    await pool.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(', ')} CASCADE`);
  }

  const existing = await pool.query(`SELECT 1 FROM schools WHERE slug = 'alfa-reis'`);
  if (existing.rowCount) {
    console.log('A escola de demonstração já existe. Use --reset para recriar.');
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const system = { type: 'system' as const, id: null };

  const result = await withTransaction(async (client) => {
    const school = await client.query<{ id: string }>(
      `INSERT INTO schools (name, legal_name, slug, email, phone, status)
       VALUES ('Escola Alfa Reis (Demo)', 'Escola Alfa Reis Ltda (fictícia)', 'alfa-reis',
               'contato@alfareis.demo', '1130000000', 'active')
       RETURNING id`,
    );
    const schoolId = school.rows[0].id;

    // Unidade atual (sede) e a nova unidade, que é a referência digital.
    const units: Record<string, string> = {};
    for (const unit of [
      { slug: 'centro', name: 'Unidade Centro', street: 'Rua das Flores (fictícia)', number: '120', district: 'Centro', whatsapp: '11930000000', accepting: false },
      { slug: 'jardim', name: 'Unidade Jardim (nova)', street: 'Avenida dos Ipês (fictícia)', number: '850', district: 'Jardim', whatsapp: '11955554444', accepting: true },
    ]) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO units (school_id, name, slug, address, whatsapp, phone, opening_hours, accepting_enrollments)
         VALUES ($1, $2, $3, $4, $5, $5, 'Segunda a sexta, 7h às 18h', $6) RETURNING id`,
        [schoolId, unit.name, unit.slug, { street: unit.street, number: unit.number, district: unit.district, city: 'São Paulo', state: 'SP' }, unit.whatsapp, unit.accepting],
      );
      units[unit.slug] = rows[0].id;
    }

    // Segunda escola, para demonstrar o isolamento entre clientes.
    const other = await client.query<{ id: string }>(
      `INSERT INTO schools (name, slug, status) VALUES ('Colégio Beta (Demo)', 'colegio-beta', 'active') RETURNING id`,
    );
    await client.query(`INSERT INTO units (school_id, name, slug) VALUES ($1, 'Unidade Única', 'unica')`, [other.rows[0].id]);
    await client.query(
      `INSERT INTO users (school_id, name, email, role, password_hash)
       VALUES ($1, 'Admin Beta', 'admin@beta.demo', 'school_admin', $2)`,
      [other.rows[0].id, passwordHash],
    );

    const users: Record<string, string> = {};
    for (const user of STAFF) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (school_id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, user.name, user.email, user.role, passwordHash],
      );
      users[user.role] = rows[0].id;
    }

    const years: Record<number, string> = {};
    for (const [year, status] of [[2026, 'active'], [2027, 'planning']] as const) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO school_years (school_id, year, starts_on, ends_on, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, year, `${year}-02-01`, `${year}-12-15`, status],
      );
      years[year] = rows[0].id;
    }

    const classIds: Record<string, Record<string, string>> = { 2026: {}, 2027: {} };
    for (const year of [2026, 2027]) {
      for (const [index, item] of CLASSES.entries()) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO classes (school_id, school_year_id, name, grade, shift, capacity, unit_id)
           VALUES ($1, $2, $3, $4, $5, 25, $6) RETURNING id`,
          [schoolId, years[year], item.name, item.grade, index < 3 ? 'morning' : 'afternoon', units.centro],
        );
        classIds[year][item.name] = rows[0].id;
      }
    }

    // Alunos: 6 a 8 por turma, alguns irmãos compartilhando o responsável.
    const studentIds: { id: string; className: string }[] = [];
    type DemoGuardian = { name: string; phone: string; surname: string; relationship: 'mother' | 'father' };
    let lastGuardian: DemoGuardian | null = null;

    for (const item of CLASSES) {
      const count = 6 + Math.floor(random() * 3);
      for (let i = 0; i < count; i++) {
        const sibling: DemoGuardian | null = lastGuardian && random() < 0.15 ? lastGuardian : null;
        const surname = sibling ? sibling.surname : pick(SURNAMES);
        const relationship = random() < 0.7 ? 'mother' : 'father';
        const guardian: DemoGuardian = sibling ?? {
          relationship,
          name: `${pick(relationship === 'mother' ? MOTHER_NAMES : FATHER_NAMES)} ${pick(SURNAMES)} ${surname}`,
          phone: `119${String(Math.floor(10_000_000 + random() * 89_999_999))}`,
          surname,
        };
        lastGuardian = guardian;

        const month = String(1 + Math.floor(random() * 12)).padStart(2, '0');
        const day = String(1 + Math.floor(random() * 28)).padStart(2, '0');
        const id = await createStudent(
          client,
          schoolId,
          {
            full_name: `${pick(FIRST_NAMES)} ${pick(SURNAMES)} ${surname}`,
            birth_date: `${2026 - item.age - 1}-${month}-${day}`,
            current_class_id: classIds[2026][item.name],
            guardians: [
              {
                full_name: guardian.name,
                phone: guardian.phone,
                relationship: guardian.relationship,
                is_financial_responsible: true,
                is_primary_contact: true,
              },
            ],
          },
          system,
        );
        studentIds.push({ id, className: item.name });
      }
    }

    // Campanha de renovação em andamento, com respostas em diferentes etapas.
    const campaign = await client.query<{ id: string }>(
      `INSERT INTO renewal_campaigns (school_id, school_year_id, title, starts_on, ends_on, status, created_by, unit_id)
       VALUES ($1, $2, 'Renovação de Matrícula 2027', current_date - 10, current_date + 20, 'open', $3, $4)
       RETURNING id`,
      [schoolId, years[2027], users.secretary, units.centro],
    );
    await syncCampaignRequests(client, schoolId, campaign.rows[0].id);

    const secretary = { type: 'user' as const, id: users.secretary };
    const requests = await client.query<{ id: string; student_id: string }>(
      'SELECT id, student_id FROM renewal_requests WHERE campaign_id = $1 ORDER BY id',
      [campaign.rows[0].id],
    );

    for (const [index, row] of requests.rows.entries()) {
      const roll = random();
      if (roll < 0.35) continue; // ainda não respondeu

      const student = await client.query(
        `SELECT s.full_name, g.id AS guardian_id, g.full_name AS guardian_name, g.phone
           FROM students s
           JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary_contact
           JOIN guardians g ON g.id = sg.guardian_id
          WHERE s.id = $1`,
        [row.student_id],
      );
      const info = student.rows[0];
      const guardianActor = { type: 'guardian' as const, id: info.guardian_id };
      const address = { street: `Rua Fictícia ${index + 1}`, number: String(10 + index), city: 'São Paulo', state: 'SP' };

      let request = await lockRequest(client, schoolId, row.id);
      await transition(client, request, 'submitted', guardianActor);
      await client.query(
        `UPDATE renewal_requests
            SET status = 'submitted', submitted_by_guardian_id = $2, submitted_at = now() - make_interval(days => $3),
                terms_accepted_at = now(), proposed_data = $4
          WHERE id = $1`,
        [
          row.id,
          info.guardian_id,
          Math.floor(random() * 9),
          {
            student: { full_name: info.full_name, address },
            guardian: { full_name: info.guardian_name, phone: info.phone, address },
          },
        ],
      );
      await client.query(
        `UPDATE renewal_request_events SET created_at = now() - make_interval(days => $2)
          WHERE request_id = $1 AND to_status = 'submitted'`,
        [row.id, Math.floor(random() * 9)],
      );

      if (roll < 0.6) continue; // enviado, aguardando análise

      request = await lockRequest(client, schoolId, row.id);
      if (roll < 0.68) {
        await transition(client, request, 'changes_requested', secretary, 'Por favor, informe o CEP do endereço.');
        await client.query(
          `UPDATE renewal_requests SET status = 'changes_requested', review_notes = 'Por favor, informe o CEP do endereço.',
                  reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
          [row.id, users.secretary],
        );
        continue;
      }

      const className = studentIds.find((item) => item.id === row.student_id)!.className;
      const next = CLASSES.find((item) => item.name === className)!.next;
      await approveRequest(client, request, secretary, next ? classIds[2027][next] : null, null);
    }

    // Link de acesso de um responsável com renovação pendente, para testar o portal.
    const pending = await client.query<{ guardian_id: string; full_name: string; birth_date: string }>(
      `SELECT sg.guardian_id, s.full_name, s.birth_date::text AS birth_date
         FROM renewal_requests r
         JOIN students s ON s.id = r.student_id
         JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary_contact
        WHERE r.campaign_id = $1 AND r.status = 'pending'
        LIMIT 1`,
      [campaign.rows[0].id],
    );
    const token = generateOpaqueToken();
    await client.query(
      `INSERT INTO guardian_access_links (school_id, guardian_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, now() + interval '30 days', $4)`,
      [schoolId, pending.rows[0].guardian_id, hashToken(token), users.secretary],
    );

    const leads = await seedAdmissions(client, schoolId, units.jardim, years[2027], users.secretary);

    return { students: studentIds.length, token, pending: pending.rows[0], leads };
  });

  console.log(`
Demonstração criada com ${result.students} alunos fictícios.

Equipe (escola: alfa-reis, senha: ${DEMO_PASSWORD})
${STAFF.map((user) => `  ${user.role.padEnd(13)} ${user.email}`).join('\n')}

Outra escola para testar isolamento (escola: colegio-beta)
  school_admin  admin@beta.demo

Site público da escola
  ${env.PUBLIC_APP_URL}/escola/alfa-reis
  ${result.leads} interessados de exemplo na captação da Unidade Jardim

Portal do responsável
  ${env.PUBLIC_APP_URL}/r/${result.token}
  Aluno: ${result.pending.full_name} — data de nascimento: ${result.pending.birth_date}
`);
}

const LEAD_SAMPLES: { student: string; guardian: string; grade: string; status: string; source: string; daysAgo: number }[] = [
  { student: 'Miguel Fictício Prado', guardian: 'Renata Prado', grade: 'Infantil 4', status: 'new', source: 'site', daysAgo: 0 },
  { student: 'Laura Fictícia Nunes', guardian: 'Carlos Nunes', grade: '1º Ano', status: 'new', source: 'site', daysAgo: 1 },
  { student: 'Enzo Fictício Moraes', guardian: 'Aline Moraes', grade: 'Infantil 5', status: 'new', source: 'instagram', daysAgo: 1 },
  { student: 'Sofia Fictícia Teles', guardian: 'Patrícia Teles', grade: 'Infantil 4', status: 'contacted', source: 'whatsapp', daysAgo: 3 },
  { student: 'Davi Fictício Rocha', guardian: 'Rodrigo Rocha', grade: '2º ao 5º Ano', status: 'contacted', source: 'referral', daysAgo: 4 },
  { student: 'Helena Fictícia Brito', guardian: 'Fernanda Brito', grade: 'Infantil 5', status: 'visit_scheduled', source: 'site', daysAgo: 2 },
  { student: 'Arthur Fictício Lins', guardian: 'Juliana Lins', grade: '1º Ano', status: 'visit_scheduled', source: 'site', daysAgo: 5 },
  { student: 'Valentina Fictícia Reis', guardian: 'Marcelo Reis', grade: 'Infantil 4', status: 'visit_scheduled', source: 'referral', daysAgo: 6 },
  { student: 'Theo Fictício Campos', guardian: 'Camila Campos', grade: '1º Ano', status: 'visited', source: 'site', daysAgo: 9 },
  { student: 'Alice Fictícia Duarte', guardian: 'André Duarte', grade: 'Infantil 5', status: 'visited', source: 'instagram', daysAgo: 12 },
  { student: 'Gabriel Fictício Melo', guardian: 'Tatiane Melo', grade: 'Infantil 4', status: 'enrolled', source: 'site', daysAgo: 20 },
  { student: 'Manuela Fictícia Paz', guardian: 'Paulo Paz', grade: '1º Ano', status: 'enrolled', source: 'referral', daysAgo: 26 },
  { student: 'Pedro Fictício Vidal', guardian: 'Mariana Vidal', grade: '2º ao 5º Ano', status: 'lost', source: 'site', daysAgo: 15 },
];

/** Captação da nova unidade: horários de visita, período de matrícula e interessados em várias etapas. */
async function seedAdmissions(client: PoolClient, schoolId: string, unitId: string, yearId: string, secretaryId: string) {
  await client.query(
    `INSERT INTO school_sites (school_id, published, content, updated_by) VALUES ($1, true, $2, $3)`,
    [schoolId, DEMO_SITE_CONTENT, secretaryId],
  );

  for (const [name, grade] of [['Infantil 4 J', 'Infantil 4'], ['Infantil 5 J', 'Infantil 5'], ['1º Ano J', '1º Ano']]) {
    await client.query(
      `INSERT INTO classes (school_id, school_year_id, unit_id, name, grade, shift, capacity) VALUES ($1, $2, $3, $4, $5, 'morning', 20)`,
      [schoolId, yearId, unitId, name, grade],
    );
  }

  await client.query(
    `INSERT INTO renewal_campaigns (school_id, school_year_id, unit_id, kind, title, starts_on, ends_on, status, created_by)
     VALUES ($1, $2, $3, 'admission', 'Matrícula 2027 · Unidade Jardim', current_date - 30, current_date + 90, 'open', $4)`,
    [schoolId, yearId, unitId, secretaryId],
  );

  // Visitas em dias úteis das próximas 3 semanas, às 9h e às 14h30 (horário de Brasília).
  await client.query(
    `INSERT INTO visit_slots (school_id, unit_id, starts_at, capacity, created_by)
     SELECT $1, $2, (d::date + t::time) AT TIME ZONE 'America/Sao_Paulo', 3, $3
       FROM generate_series(current_date + 1, current_date + 21, interval '1 day') AS d,
            unnest(ARRAY['09:00', '14:30']) AS t
      WHERE extract(isodow FROM d) < 6`,
    [schoolId, unitId, secretaryId],
  );
  const { rows: slots } = await client.query<{ id: string }>(
    'SELECT id FROM visit_slots WHERE unit_id = $1 ORDER BY starts_at LIMIT 6',
    [unitId],
  );

  const secretary = { type: 'user' as const, id: secretaryId };
  for (const [index, sample] of LEAD_SAMPLES.entries()) {
    const lead = await createLead(
      client,
      schoolId,
      {
        unit_id: unitId,
        guardian_name: `${sample.guardian} (fictícia)`,
        guardian_phone: `1196${String(1_000_000 + index * 7919).padStart(7, '0')}`,
        student_name: sample.student,
        student_birth_date: `${2027 - 4 - (index % 3)}-0${1 + (index % 9)}-1${index % 9}`,
        desired_grade: sample.grade,
        desired_year: 2027,
        interest: sample.status === 'new' && index % 2 ? 'enroll' : 'visit',
        how_heard: sample.source === 'referral' ? 'Indicação de outra família' : undefined,
        source: sample.source as (typeof LEAD_SOURCES)[number],
      },
      sample.source === 'site' ? { type: 'public', id: null } : secretary,
    );

    if (sample.status === 'visit_scheduled') {
      await bookVisit(client, schoolId, lead.id, slots[index % slots.length].id, { type: 'public', id: null });
    } else if (sample.status !== 'new') {
      await changeLeadStatus(client, schoolId, lead.id, sample.status as LeadStatus, secretary, sample.status === 'lost' ? 'Escolheu escola mais perto do trabalho' : null);
    }

    await client.query(
      `UPDATE admission_leads SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [lead.id, sample.daysAgo],
    );
    await client.query(
      `UPDATE admission_lead_events SET created_at = now() - make_interval(days => $2) WHERE lead_id = $1 AND type = 'created'`,
      [lead.id, sample.daysAgo],
    );
  }

  return LEAD_SAMPLES.length;
}

seed()
  .catch((error) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
