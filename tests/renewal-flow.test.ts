import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/database/pool.js';
import { api, createSchool, createStudent, createYearAndClass, resetDatabase, staffSession } from './helpers.js';

const BIRTH_DATE = '2018-03-15';

function tokenFromUrl(url: string) {
  return url.split('/r/')[1];
}

describe('fluxo de renovação de matrícula', () => {
  let secretary: Awaited<ReturnType<typeof staffSession>>;
  let student: { id: string; guardians: { id: string }[] };
  let nextYearClass: string;
  let campaignId: string;

  async function openPortal(guardianId = student.guardians[0].id, birthDate = BIRTH_DATE) {
    const link = await api().post(`/api/guardians/${guardianId}/access-links`).set(secretary.auth).expect(201);
    const session = await api()
      .post('/api/portal/session')
      .send({ token: tokenFromUrl(link.body.url), student_birth_date: birthDate })
      .expect(200);
    return { link: link.body, auth: { Authorization: `Bearer ${session.body.token}` } };
  }

  beforeEach(async () => {
    await resetDatabase();
    secretary = await staffSession(await createSchool('alfa'), 'secretary');

    const current = await createYearAndClass(secretary.auth, 2026, '1º Ano A');
    const next = await createYearAndClass(secretary.auth, 2027, '2º Ano A');
    nextYearClass = next.classId;

    student = await createStudent(secretary.auth, { birth_date: BIRTH_DATE, current_class_id: current.classId });

    const campaign = await api()
      .post('/api/renewal-campaigns')
      .set(secretary.auth)
      .send({ school_year_id: next.yearId, title: 'Renovação 2027', starts_on: '2026-10-01', ends_on: '2026-11-30' })
      .expect(201);
    campaignId = campaign.body.id;
  });

  afterAll(() => pool.end());

  it('executa o fluxo completo: link, confirmação, análise, aprovação e matrícula', async () => {
    const opened = await api().post(`/api/renewal-campaigns/${campaignId}/open`).set(secretary.auth).expect(200);
    expect(opened.body).toMatchObject({ requests_created: 1, pending: 1 });

    // A Secretaria gera o link e recebe a mensagem pronta para o WhatsApp.
    const portal = await openPortal();
    expect(portal.link.whatsapp_url).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);

    // O responsável vê o aluno e a renovação pendente.
    const me = await api().get('/api/portal/me').set(portal.auth).expect(200);
    const renewal = me.body.students[0].renewals[0];
    expect(renewal).toMatchObject({ status: 'pending', status_label: 'Aguardando responsável' });

    const detail = await api().get(`/api/portal/renewals/${renewal.id}`).set(portal.auth).expect(200);
    expect(detail.body.can_submit).toBe(true);
    expect(detail.body.student.full_name).toBe('Maria Fictícia da Silva');

    // O responsável completa os dados que a escola não tinha.
    const address = { street: 'Rua Fictícia', number: '100', city: 'São Paulo', state: 'SP' };
    await api()
      .post(`/api/portal/renewals/${renewal.id}/submit`)
      .set(portal.auth)
      .send({
        data: {
          student: { full_name: 'Maria Fictícia da Silva', address, health_notes: 'Alergia a amendoim' },
          guardian: { full_name: 'Ana Fictícia da Silva', phone: '11988887777', email: 'ana@example.com', address },
        },
        accept_terms: true,
      })
      .expect(200);

    // A Secretaria vê somente o que mudou.
    const review = await api().get(`/api/renewal-requests/${renewal.id}`).set(secretary.auth).expect(200);
    expect(review.body.status).toBe('submitted');
    expect(review.body.changes.map((change: { field: string }) => change.field).sort()).toEqual(
      ['address', 'address', 'email', 'health_notes'].sort(),
    );

    await api()
      .post(`/api/renewal-requests/${renewal.id}/approve`)
      .set(secretary.auth)
      .send({ target_class_id: nextYearClass })
      .expect(200);

    // Os dados confirmados entram no cadastro e a matrícula do novo ano é criada.
    const updated = await api().get(`/api/students/${student.id}`).set(secretary.auth).expect(200);
    expect(updated.body.health_notes).toBe('Alergia a amendoim');
    expect(updated.body.address).toMatchObject(address);
    expect(updated.body.guardians[0].email).toBe('ana@example.com');
    expect(updated.body.enrollments).toEqual([expect.objectContaining({ year: 2027, class_name: '2º Ano A' })]);

    // Histórico completo, com quem fez cada etapa.
    const history = await api().get(`/api/renewal-requests/${renewal.id}`).set(secretary.auth).expect(200);
    expect(history.body.events.map((event: { to_status: string }) => event.to_status)).toEqual([
      'pending',
      'submitted',
      'approved',
    ]);
    expect(history.body.events[1].actor_name).toBe('Ana Fictícia da Silva');

    const dashboard = await api().get(`/api/dashboard/renewals/${campaignId}`).set(secretary.auth).expect(200);
    expect(dashboard.body).toMatchObject({ total: 1, response_rate: 100, approval_rate: 100 });
  });

  it('permite devolver para correção e receber novo envio', async () => {
    await api().post(`/api/renewal-campaigns/${campaignId}/open`).set(secretary.auth).expect(200);
    const portal = await openPortal();
    const me = await api().get('/api/portal/me').set(portal.auth).expect(200);
    const id = me.body.students[0].renewals[0].id;
    const submission = {
      data: {
        student: { full_name: 'Maria Fictícia da Silva' },
        guardian: { full_name: 'Ana Fictícia da Silva', phone: '11988887777' },
      },
      accept_terms: true,
    };

    await api().post(`/api/portal/renewals/${id}/submit`).set(portal.auth).send(submission).expect(200);
    await api().post(`/api/renewal-requests/${id}/request-changes`).set(secretary.auth).send({}).expect(400);
    await api()
      .post(`/api/renewal-requests/${id}/request-changes`)
      .set(secretary.auth)
      .send({ notes: 'Informe o endereço completo' })
      .expect(200);

    const pending = await api().get('/api/portal/me').set(portal.auth).expect(200);
    expect(pending.body.students[0].renewals[0]).toMatchObject({
      status: 'changes_requested',
      review_notes: 'Informe o endereço completo',
    });

    await api().post(`/api/portal/renewals/${id}/submit`).set(portal.auth).send(submission).expect(200);
    await api().post(`/api/renewal-requests/${id}/reject`).set(secretary.auth).send({ notes: 'Vaga encerrada' }).expect(200);

    // Solicitação finalizada não volta atrás.
    await api().post(`/api/renewal-requests/${id}/approve`).set(secretary.auth).send({}).expect(409);
    await api().post(`/api/portal/renewals/${id}/submit`).set(portal.auth).send(submission).expect(409);
  });

  it('não aprova antes do envio do responsável', async () => {
    await api().post(`/api/renewal-campaigns/${campaignId}/open`).set(secretary.auth).expect(200);
    const list = await api()
      .get('/api/renewal-requests')
      .query({ campaign_id: campaignId })
      .set(secretary.auth)
      .expect(200);

    expect(list.body.data[0].reminder_whatsapp_url).toMatch(/^https:\/\/wa\.me\//);
    await api().post(`/api/renewal-requests/${list.body.data[0].id}/approve`).set(secretary.auth).send({}).expect(409);
  });

  it('recusa turma de destino de outro ano letivo', async () => {
    await api().post(`/api/renewal-campaigns/${campaignId}/open`).set(secretary.auth).expect(200);
    const list = await api().get('/api/renewal-requests').query({ campaign_id: campaignId }).set(secretary.auth);

    await api()
      .patch(`/api/renewal-requests/${list.body.data[0].id}`)
      .set(secretary.auth)
      .send({ target_class_id: student.guardians[0].id })
      .expect(400);
  });

  describe('segurança do portal', () => {
    it('bloqueia o link após 5 datas de nascimento incorretas', async () => {
      const link = await api()
        .post(`/api/guardians/${student.guardians[0].id}/access-links`)
        .set(secretary.auth)
        .expect(201);
      const token = tokenFromUrl(link.body.url);

      for (let attempt = 0; attempt < 5; attempt++) {
        await api().post('/api/portal/session').send({ token, student_birth_date: '2000-01-01' }).expect(401);
      }

      await api().post('/api/portal/session').send({ token, student_birth_date: BIRTH_DATE }).expect(401);
    });

    it('um novo link revoga o anterior', async () => {
      const first = await api().post(`/api/guardians/${student.guardians[0].id}/access-links`).set(secretary.auth);
      await api().post(`/api/guardians/${student.guardians[0].id}/access-links`).set(secretary.auth);

      await api()
        .post('/api/portal/session')
        .send({ token: tokenFromUrl(first.body.url), student_birth_date: BIRTH_DATE })
        .expect(401);
    });

    it('o responsável só acessa a renovação dos próprios alunos', async () => {
      const other = await createStudent(secretary.auth, {
        full_name: 'Outro Aluno',
        birth_date: '2017-05-05',
        guardians: [{ full_name: 'Outro Responsável', phone: '11977776666', relationship: 'father' }],
      });
      await api().post(`/api/renewal-campaigns/${campaignId}/open`).set(secretary.auth).expect(200);

      const list = await api().get('/api/renewal-requests').query({ campaign_id: campaignId }).set(secretary.auth);
      const otherRequest = list.body.data.find((row: { student_id: string }) => row.student_id === other.id);

      const portal = await openPortal();
      await api().get(`/api/portal/renewals/${otherRequest.id}`).set(portal.auth).expect(404);
      await api()
        .post(`/api/portal/renewals/${otherRequest.id}/submit`)
        .set(portal.auth)
        .send({
          data: { student: { full_name: 'X Y' }, guardian: { full_name: 'X Y', phone: '11999999999' } },
          accept_terms: true,
        })
        .expect(404);
    });

    it('não aceita token da equipe no portal', async () => {
      await api().get('/api/portal/me').set(secretary.auth).expect(401);
    });

    it('não mostra campanha em rascunho ao responsável', async () => {
      await pool.query(
        `INSERT INTO renewal_requests (school_id, campaign_id, student_id)
         SELECT school_id, $1, id FROM students`,
        [campaignId],
      );
      const portal = await openPortal();
      const me = await api().get('/api/portal/me').set(portal.auth).expect(200);
      expect(me.body.students[0].renewals).toEqual([]);
    });
  });

  it('importa lista digitada a partir das fichas em papel, reaproveitando o responsável de irmãos', async () => {
    const years = await api().get('/api/school-years').set(secretary.auth);
    const year2026 = years.body.data.find((year: { year: number }) => year.year === 2026);
    const row = { guardian_name: 'Carla Fictícia', guardian_phone: '11955554444', relationship: 'mother' };

    const invalid = await api()
      .post('/api/students/import')
      .set(secretary.auth)
      .send({ school_year_id: year2026.id, rows: [{ ...row, student_name: 'João', birth_date: '2019-02-02', class_name: 'Inexistente' }] })
      .expect(400);
    expect(invalid.body.details[0].linha).toBe(1);

    await api()
      .post('/api/students/import')
      .set(secretary.auth)
      .send({
        school_year_id: year2026.id,
        rows: [
          { ...row, student_name: 'João Fictício', birth_date: '2019-02-02', class_name: '1º Ano A' },
          { ...row, student_name: 'Pedro Fictício', birth_date: '2020-04-04' },
        ],
      })
      .expect(201);

    const { rows } = await pool.query(`SELECT count(*)::int AS count FROM guardians WHERE full_name = 'Carla Fictícia'`);
    expect(rows[0].count).toBe(1);
  });
});
