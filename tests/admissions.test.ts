import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/database/pool.js';
import { api, createSchool, resetDatabase, staffSession } from './helpers.js';

const CONTENT = {
  hero: { title: 'Escola Teste', subtitle: 'Educação de verdade' },
  about: { title: 'Sobre', text: 'Texto' },
  segments: [{ name: '1º Ano', ages: '6 anos' }],
  uniform: { items: [{ name: 'Camiseta', price: 'R$ 45' }] },
  faq: [{ question: 'Tem integral?', answer: 'Sim.' }],
};

// PNG de 1x1 pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function tomorrow() {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

describe('site público e captação de novos alunos', () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let admin: Awaited<ReturnType<typeof staffSession>>;
  let newUnitId: string;

  const lead = (overrides: Record<string, unknown> = {}) => ({
    unit_id: newUnitId,
    guardian_name: 'Juliana Fictícia',
    guardian_phone: '(11) 98765-4321',
    student_name: 'Lucas Fictício',
    student_birth_date: '2019-04-22',
    desired_grade: '1º Ano',
    interest: 'visit',
    consent: true,
    ...overrides,
  });

  beforeEach(async () => {
    await resetDatabase();
    school = await createSchool('alfa');
    admin = await staffSession(school, 'school_admin');
    const unit = await api()
      .post('/api/units')
      .set(admin.auth)
      .send({ name: 'Unidade Jardim', slug: 'jardim', whatsapp: '11955554444' })
      .expect(201);
    newUnitId = unit.body.id;
    await api().put('/api/site').set(admin.auth).send({ published: true, content: CONTENT }).expect(200);
  });

  afterAll(() => pool.end());

  it('só mostra o site publicado, com unidades e horários de visita livres', async () => {
    await api().put('/api/site').set(admin.auth).send({ published: false, content: CONTENT }).expect(200);
    await api().get('/api/public/schools/alfa').expect(404);

    await api().put('/api/site').set(admin.auth).send({ published: true, content: CONTENT }).expect(200);
    await api()
      .post('/api/visit-slots')
      .set(admin.auth)
      .send({ unit_id: newUnitId, dates: [tomorrow()], times: ['09:00', '14:00'], capacity: 2 })
      .expect(201);

    const site = await api().get('/api/public/schools/alfa').expect(200);
    expect(site.body.content.hero.title).toBe('Escola Teste');
    expect(site.body.units.map((unit: { slug: string }) => unit.slug)).toEqual(['sede', 'jardim']);
    expect(site.body.visit_slots).toHaveLength(2);
  });

  it('recebe a pré-matrícula com visita agendada e respeita a capacidade do horário', async () => {
    await api()
      .post('/api/visit-slots')
      .set(admin.auth)
      .send({ unit_id: newUnitId, dates: [tomorrow()], times: ['09:00'], capacity: 1 })
      .expect(201);
    const site = await api().get('/api/public/schools/alfa');
    const slotId = site.body.visit_slots[0].id;

    const created = await api().post('/api/public/schools/alfa/leads').send(lead({ slot_id: slotId })).expect(201);
    expect(created.body.code).toMatch(/^PM-[A-Z2-9]{6}$/);
    expect(created.body.visit_starts_at).toBeTruthy();
    expect(created.body.whatsapp_url).toMatch(/^https:\/\/wa\.me\/5511955554444/);

    await api()
      .post('/api/public/schools/alfa/leads')
      .send(lead({ slot_id: slotId, student_name: 'Outra Criança' }))
      .expect(409);

    const after = await api().get('/api/public/schools/alfa');
    expect(after.body.visit_slots).toHaveLength(0);

    const list = await api().get('/api/admission-leads').set(admin.auth).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ status: 'visit_scheduled', unit_name: 'Unidade Jardim' });
  });

  it('recusa envio sem consentimento, com campo-isca preenchido ou para unidade fechada', async () => {
    await api().post('/api/public/schools/alfa/leads').send(lead({ consent: false })).expect(400);
    await api().post('/api/public/schools/alfa/leads').send(lead({ website: 'spam' })).expect(400);

    await api().patch(`/api/units/${newUnitId}`).set(admin.auth).send({ accepting_enrollments: false }).expect(200);
    await api().post('/api/public/schools/alfa/leads').send(lead()).expect(400);
  });

  it('outra escola não enxerga os interessados', async () => {
    const created = await api().post('/api/public/schools/alfa/leads').send(lead()).expect(201);
    const other = await staffSession(await createSchool('beta'), 'school_admin');

    const list = await api().get('/api/admission-leads').set(other.auth).expect(200);
    expect(list.body.data).toEqual([]);

    const mine = await api().get('/api/admission-leads').set(admin.auth);
    const id = mine.body.data.find((row: { code: string }) => row.code === created.body.code).id;
    await api().get(`/api/admission-leads/${id}`).set(other.auth).expect(404);
    await api().post(`/api/admission-leads/${id}/notes`).set(other.auth).send({ notes: 'x' }).expect(404);
  });

  it('converte o interessado em matrícula online e conclui ao aprovar', async () => {
    const secretary = await staffSession(school, 'secretary');
    await api().post('/api/public/schools/alfa/leads').send(lead()).expect(201);
    const leadId = (await api().get('/api/admission-leads').set(secretary.auth)).body.data[0].id;

    const year = await api().post('/api/school-years').set(secretary.auth).send({ year: 2027 }).expect(201);
    const klass = await api()
      .post('/api/classes')
      .set(secretary.auth)
      .send({ school_year_id: year.body.id, unit_id: newUnitId, name: '1º Ano J', grade: '1º Ano', shift: 'morning' })
      .expect(201);
    const campaign = await api()
      .post('/api/renewal-campaigns')
      .set(secretary.auth)
      .send({
        kind: 'admission',
        unit_id: newUnitId,
        school_year_id: year.body.id,
        title: 'Matrícula 2027 Jardim',
        starts_on: '2026-10-01',
        ends_on: '2027-02-28',
      })
      .expect(201);
    const opened = await api().post(`/api/renewal-campaigns/${campaign.body.id}/open`).set(secretary.auth).expect(200);
    expect(opened.body.requests_created).toBe(0);

    const converted = await api()
      .post(`/api/admission-leads/${leadId}/convert`)
      .set(secretary.auth)
      .send({ campaign_id: campaign.body.id, target_class_id: klass.body.id })
      .expect(201);
    expect(converted.body.link.message).toMatch(/completa a matrícula/);

    // Candidato ainda não conta como aluno ativo.
    const dashboard = await api().get('/api/dashboard').set(secretary.auth);
    expect(dashboard.body.active_students).toBe(0);
    await api().post(`/api/admission-leads/${leadId}/convert`).set(secretary.auth).send({ campaign_id: campaign.body.id }).expect(409);

    // A família completa pelo portal.
    const token = converted.body.link.url.split('/r/')[1];
    const session = await api().post('/api/portal/session').send({ token, student_birth_date: '2019-04-22' }).expect(200);
    const portal = { Authorization: `Bearer ${session.body.token}` };
    const me = await api().get('/api/portal/me').set(portal).expect(200);
    expect(me.body.students[0].renewals[0]).toMatchObject({ campaign_kind: 'admission', status: 'pending' });

    await api()
      .post(`/api/portal/renewals/${converted.body.request_id}/submit`)
      .set(portal)
      .send({
        data: {
          student: { full_name: 'Lucas Fictício Andrade', health_notes: 'Nenhuma' },
          guardian: { full_name: 'Juliana Fictícia Andrade', phone: '11987654321', cpf: '12345678909' },
        },
        accept_terms: true,
      })
      .expect(200);

    await api().post(`/api/renewal-requests/${converted.body.request_id}/approve`).set(secretary.auth).send({}).expect(200);

    const student = await api().get(`/api/students/${converted.body.student_id}`).set(secretary.auth).expect(200);
    expect(student.body).toMatchObject({ status: 'active', full_name: 'Lucas Fictício Andrade', unit_name: 'Unidade Jardim' });
    expect(student.body.enrollments[0]).toMatchObject({ year: 2027, class_name: '1º Ano J' });

    const detail = await api().get(`/api/admission-leads/${leadId}`).set(secretary.auth).expect(200);
    expect(detail.body.status).toBe('enrolled');
    expect(detail.body.events.map((event: { to_status: string | null }) => event.to_status)).toEqual(['new', 'enrolling', 'enrolled']);

    const funnel = await api().get('/api/dashboard/admissions').set(secretary.auth).expect(200);
    expect(funnel.body).toMatchObject({ total: 1, conversion_rate: 100 });
  });

  it('matrícula de aluno novo rejeitada encerra o atendimento', async () => {
    await api().post('/api/public/schools/alfa/leads').send(lead()).expect(201);
    const leadId = (await api().get('/api/admission-leads').set(admin.auth)).body.data[0].id;
    const year = await api().post('/api/school-years').set(admin.auth).send({ year: 2027 });
    const campaign = await api()
      .post('/api/renewal-campaigns')
      .set(admin.auth)
      .send({ kind: 'admission', school_year_id: year.body.id, title: 'Matrícula 2027', starts_on: '2026-10-01', ends_on: '2027-02-28' });
    await api().post(`/api/renewal-campaigns/${campaign.body.id}/open`).set(admin.auth).expect(200);
    const converted = await api()
      .post(`/api/admission-leads/${leadId}/convert`)
      .set(admin.auth)
      .send({ campaign_id: campaign.body.id })
      .expect(201);

    const token = converted.body.link.url.split('/r/')[1];
    const session = await api().post('/api/portal/session').send({ token, student_birth_date: '2019-04-22' });
    await api()
      .post(`/api/portal/renewals/${converted.body.request_id}/submit`)
      .set({ Authorization: `Bearer ${session.body.token}` })
      .send({ data: { student: { full_name: 'Lucas F' }, guardian: { full_name: 'Juliana F', phone: '11987654321' } }, accept_terms: true })
      .expect(200);
    await api()
      .post(`/api/renewal-requests/${converted.body.request_id}/reject`)
      .set(admin.auth)
      .send({ notes: 'Sem vagas na turma' })
      .expect(200);

    const detail = await api().get(`/api/admission-leads/${leadId}`).set(admin.auth);
    expect(detail.body).toMatchObject({ status: 'lost', lost_reason: 'Sem vagas na turma' });
  });

  it('renovação não inclui candidatos nem alunos de outra unidade', async () => {
    const year = await api().post('/api/school-years').set(admin.auth).send({ year: 2027 });
    for (const [name, unit, status] of [
      ['Ativo Sede', school.unitId, 'active'],
      ['Ativo Jardim', newUnitId, 'active'],
      ['Candidato Sede', school.unitId, 'applicant'],
    ]) {
      await pool.query(
        `INSERT INTO students (school_id, unit_id, full_name, birth_date, status) VALUES ($1, $2, $3, '2018-01-01', $4)`,
        [school.id, unit, name, status],
      );
    }
    const campaign = await api()
      .post('/api/renewal-campaigns')
      .set(admin.auth)
      .send({ unit_id: school.unitId, school_year_id: year.body.id, title: 'Renovação Sede', starts_on: '2026-10-01', ends_on: '2026-11-30' });

    const opened = await api().post(`/api/renewal-campaigns/${campaign.body.id}/open`).set(admin.auth).expect(200);
    expect(opened.body.requests_created).toBe(1);
  });

  it('aceita imagens reais do uniforme e recusa arquivo disfarçado', async () => {
    const uploaded = await api()
      .post('/api/site/assets')
      .set(admin.auth)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(201);

    await api()
      .post('/api/site/assets')
      .set(admin.auth)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg onload="alert(1)"></svg>'))
      .expect(400);

    const content = { ...CONTENT, uniform: { items: [{ name: 'Camiseta', image_id: uploaded.body.id }] } };
    await api().put('/api/site').set(admin.auth).send({ published: true, content }).expect(200);

    const image = await api().get(`/api/public/assets/${uploaded.body.id}`).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    await api().delete(`/api/site/assets/${uploaded.body.id}`).set(admin.auth).expect(400);

    const other = await staffSession(await createSchool('beta'), 'school_admin');
    await api()
      .put('/api/site')
      .set(other.auth)
      .send({ published: true, content })
      .expect(400);
  });

  it('professor não acessa captação nem o editor do site', async () => {
    const teacher = await staffSession(school, 'teacher');
    await api().get('/api/admission-leads').set(teacher.auth).expect(403);
    await api().get('/api/site').set(teacher.auth).expect(403);
  });
});
