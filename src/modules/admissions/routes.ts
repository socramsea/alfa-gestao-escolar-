import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { idParams, isoDate, uuid } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, recordAudit } from '../audit/service.js';
import { createAccessLink } from '../guardians/service.js';
import { ensureClassInYear } from '../renewals/service.js';
import { createStudent } from '../students/service.js';
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  bookVisit,
  changeLeadStatus,
  createLead,
  guardianContactLink,
  leadInputSchema,
  recordLeadEvent,
} from './service.js';

export const admissionsRouter = Router();

const listQuery = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  unit_id: uuid.optional(),
  search: z.string().trim().max(100).optional(),
});

admissionsRouter.get('/', requirePermission('admissions:read'), async (request, response) => {
  const query = parse(listQuery, request.query);
  const schoolId = request.user!.school_id;

  const [{ rows }, counts] = await Promise.all([
    pool.query(
      `SELECT l.id, l.code, l.status, l.interest, l.source, l.guardian_name, l.guardian_phone, l.student_name,
              l.desired_grade, l.created_at, u.name AS unit_name, nv.starts_at AS next_visit_at
         FROM admission_leads l
         JOIN units u ON u.id = l.unit_id
         LEFT JOIN LATERAL (
           SELECT vs.starts_at FROM visits v JOIN visit_slots vs ON vs.id = v.slot_id
            WHERE v.lead_id = l.id AND v.status = 'scheduled' ORDER BY vs.starts_at LIMIT 1
         ) nv ON true
        WHERE l.school_id = $1
          AND ($2::text IS NULL OR l.status = $2)
          AND ($3::uuid IS NULL OR l.unit_id = $3)
          AND ($4::text IS NULL OR lower(l.student_name || ' ' || l.guardian_name || ' ' || l.code) LIKE $4)
        ORDER BY (l.status = 'new') DESC, nv.starts_at ASC NULLS LAST, l.created_at DESC
        LIMIT 300`,
      [schoolId, query.status ?? null, query.unit_id ?? null, query.search ? `%${query.search.toLowerCase()}%` : null],
    ),
    pool.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM admission_leads
        WHERE school_id = $1 AND ($2::uuid IS NULL OR unit_id = $2) GROUP BY status`,
      [schoolId, query.unit_id ?? null],
    ),
  ]);

  response.json({
    data: rows,
    counts: Object.fromEntries(LEAD_STATUSES.map((status) => [status, counts.rows.find((row) => row.status === status)?.count ?? 0])),
  });
});

// Cadastro manual: contato que chegou pelo WhatsApp, por indicação ou na portaria.
const manualSchema = leadInputSchema.extend({ source: z.enum(LEAD_SOURCES).default('whatsapp') });

admissionsRouter.post('/', requirePermission('admissions:manage'), async (request, response) => {
  const input = parse(manualSchema, request.body);
  const schoolId = request.user!.school_id;
  const lead = await withTransaction((client) =>
    createLead(client, schoolId, input, { type: 'user', id: request.user!.id }),
  );
  response.status(201).json(lead);
});

admissionsRouter.get('/:id', requirePermission('admissions:read'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  const { rows } = await pool.query(
    `SELECT l.*, l.student_birth_date::text AS student_birth_date, u.name AS unit_name, s.name AS school_name
       FROM admission_leads l
       JOIN units u ON u.id = l.unit_id
       JOIN schools s ON s.id = l.school_id
      WHERE l.id = $1 AND l.school_id = $2`,
    [id, schoolId],
  );
  const lead = rows[0];
  if (!lead) throw notFound('Interessado não encontrado');

  const [events, visits, request_] = await Promise.all([
    pool.query(
      `SELECT e.type, e.from_status, e.to_status, e.notes, e.actor_type, u.name AS actor_name, e.created_at
         FROM admission_lead_events e LEFT JOIN users u ON e.actor_type = 'user' AND u.id = e.actor_id
        WHERE e.lead_id = $1 AND e.school_id = $2 ORDER BY e.created_at`,
      [id, schoolId],
    ),
    pool.query(
      `SELECT v.id, v.status, vs.starts_at FROM visits v JOIN visit_slots vs ON vs.id = v.slot_id
        WHERE v.lead_id = $1 AND v.school_id = $2 ORDER BY vs.starts_at DESC`,
      [id, schoolId],
    ),
    pool.query(
      `SELECT r.id, r.status, rc.title AS campaign_title FROM renewal_requests r
         JOIN renewal_campaigns rc ON rc.id = r.campaign_id
        WHERE r.admission_lead_id = $1 AND r.school_id = $2 ORDER BY r.created_at DESC LIMIT 1`,
      [id, schoolId],
    ),
  ]);

  const { school_name, ...rest } = lead;
  response.json({
    ...rest,
    status_label: LEAD_STATUS_LABELS[lead.status as keyof typeof LEAD_STATUS_LABELS],
    whatsapp_url: guardianContactLink(lead.guardian_phone, lead.guardian_name, school_name, lead.student_name),
    events: events.rows,
    visits: visits.rows,
    enrollment_request: request_.rows[0] ?? null,
  });
});

const statusSchema = z.object({
  status: z.enum(['new', 'contacted', 'visited', 'lost']),
  notes: z.string().trim().max(500).optional(),
});

admissionsRouter.post('/:id/status', requirePermission('admissions:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(statusSchema, request.body);
  if (input.status === 'lost' && !input.notes) throw badRequest('Informe o motivo');

  await withTransaction((client) =>
    changeLeadStatus(client, request.user!.school_id, id, input.status, { type: 'user', id: request.user!.id }, input.notes ?? null),
  );
  response.json({ id, status: input.status });
});

const noteSchema = z.object({ notes: z.string().trim().min(1).max(2000) });

admissionsRouter.post('/:id/notes', requirePermission('admissions:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(noteSchema, request.body);
  const schoolId = request.user!.school_id;

  const lead = await pool.query('SELECT 1 FROM admission_leads WHERE id = $1 AND school_id = $2', [id, schoolId]);
  if (!lead.rowCount) throw notFound('Interessado não encontrado');

  await recordLeadEvent(pool, schoolId, id, { type: 'note', notes: input.notes, actor: { type: 'user', id: request.user!.id } });
  response.status(201).json({ ok: true });
});

const visitSchema = z.object({ slot_id: uuid });

admissionsRouter.post('/:id/visits', requirePermission('admissions:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(visitSchema, request.body);
  const visit = await withTransaction((client) =>
    bookVisit(client, request.user!.school_id, id, input.slot_id, { type: 'user', id: request.user!.id }),
  );
  response.status(201).json(visit);
});

const visitStatusParams = z.object({ id: uuid, visitId: uuid });
const visitStatusSchema = z.object({ status: z.enum(['attended', 'no_show', 'cancelled']) });

admissionsRouter.patch('/:id/visits/:visitId', requirePermission('admissions:manage'), async (request, response) => {
  const { id, visitId } = parse(visitStatusParams, request.params);
  const input = parse(visitStatusSchema, request.body);
  const schoolId = request.user!.school_id;
  const actor = { type: 'user' as const, id: request.user!.id };

  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE visits SET status = $4 WHERE id = $1 AND lead_id = $2 AND school_id = $3 AND status = 'scheduled'`,
      [visitId, id, schoolId, input.status],
    );
    if (!rowCount) throw notFound('Visita agendada não encontrada');

    await recordLeadEvent(client, schoolId, id, { type: `visit_${input.status}`, actor });
    if (input.status === 'attended') await changeLeadStatus(client, schoolId, id, 'visited', actor);
    if (input.status !== 'attended') await changeLeadStatus(client, schoolId, id, 'contacted', actor);
  });

  response.json({ id: visitId, status: input.status });
});

/**
 * Converte o interessado em aluno e abre a matrícula online: cria aluno (ainda como
 * candidato), responsável e a solicitação na campanha de matrícula, e gera o link
 * para a família completar os dados pelo celular.
 */
const convertSchema = z.object({
  campaign_id: uuid,
  target_class_id: uuid.nullable().optional(),
  student_birth_date: isoDate.optional(),
});

admissionsRouter.post('/:id/convert', requirePermission('admissions:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(convertSchema, request.body);
  const schoolId = request.user!.school_id;
  const actor = actorFrom(request);

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * , student_birth_date::text AS student_birth_date FROM admission_leads
        WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [id, schoolId],
    );
    const lead = rows[0];
    if (!lead) throw notFound('Interessado não encontrado');
    if (lead.student_id) throw conflict('Este interessado já foi convertido em matrícula');
    if (lead.status === 'lost') throw conflict('Reabra o atendimento antes de converter');

    const birthDate = input.student_birth_date ?? lead.student_birth_date;
    if (!birthDate) throw badRequest('Informe a data de nascimento da criança: ela protege o acesso da família ao link');

    const { rows: campaigns } = await client.query(
      `SELECT id, kind, status, school_year_id, unit_id FROM renewal_campaigns WHERE id = $1 AND school_id = $2`,
      [input.campaign_id, schoolId],
    );
    const campaign = campaigns[0];
    if (!campaign || campaign.kind !== 'admission') throw badRequest('Escolha um período de matrícula de novos alunos');
    if (campaign.status !== 'open') throw conflict('O período de matrícula precisa estar aberto');
    if (campaign.unit_id && campaign.unit_id !== lead.unit_id) throw badRequest('O período de matrícula é de outra unidade');
    if (input.target_class_id) await ensureClassInYear(client, schoolId, input.target_class_id, campaign.school_year_id);

    const studentId = await createStudent(
      client,
      schoolId,
      {
        full_name: lead.student_name,
        birth_date: birthDate,
        unit_id: lead.unit_id,
        status: 'applicant',
        guardians: [
          {
            full_name: lead.guardian_name,
            phone: lead.guardian_phone,
            email: lead.guardian_email ?? undefined,
            relationship: 'other',
            is_financial_responsible: true,
            is_primary_contact: true,
          },
        ],
      },
      actor,
    );
    const { rows: links } = await client.query<{ guardian_id: string }>(
      'SELECT guardian_id FROM student_guardians WHERE student_id = $1 AND is_primary_contact',
      [studentId],
    );
    const guardianId = links[0].guardian_id;

    const { rows: requests } = await client.query<{ id: string }>(
      `INSERT INTO renewal_requests (school_id, campaign_id, student_id, target_class_id, admission_lead_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [schoolId, campaign.id, studentId, input.target_class_id ?? null, id],
    );
    await client.query(
      `INSERT INTO renewal_request_events (school_id, request_id, to_status, actor_type, actor_id)
       VALUES ($1, $2, 'pending', 'user', $3)`,
      [schoolId, requests[0].id, request.user!.id],
    );

    await client.query(
      `UPDATE admission_leads SET student_id = $3, guardian_id = $4, student_birth_date = $5 WHERE id = $1 AND school_id = $2`,
      [id, schoolId, studentId, guardianId, birthDate],
    );
    await changeLeadStatus(client, schoolId, id, 'enrolling', { type: 'user', id: request.user!.id });

    const link = await createAccessLink(client, schoolId, guardianId, actor, 'admission');
    await recordAudit(client, {
      schoolId,
      actor,
      action: 'admission_lead.converted',
      entityType: 'admission_lead',
      entityId: id,
      metadata: { student_id: studentId, request_id: requests[0].id },
    });

    return { student_id: studentId, request_id: requests[0].id, link };
  });

  response.status(201).json(result);
});

// Horários de visita ------------------------------------------------------------

export const visitSlotsRouter = Router();

const slotsQuery = z.object({ unit_id: uuid.optional(), from: isoDate.optional() });

visitSlotsRouter.get('/', requirePermission('admissions:read'), async (request, response) => {
  const query = parse(slotsQuery, request.query);

  const { rows } = await pool.query(
    `SELECT vs.id, vs.unit_id, u.name AS unit_name, vs.starts_at, vs.capacity,
            COALESCE(json_agg(json_build_object(
              'visit_id', v.id, 'lead_id', l.id, 'student_name', l.student_name,
              'guardian_name', l.guardian_name, 'guardian_phone', l.guardian_phone
            ) ORDER BY v.created_at) FILTER (WHERE v.id IS NOT NULL), '[]') AS visits
       FROM visit_slots vs
       JOIN units u ON u.id = vs.unit_id
       LEFT JOIN visits v ON v.slot_id = vs.id AND v.status = 'scheduled'
       LEFT JOIN admission_leads l ON l.id = v.lead_id
      WHERE vs.school_id = $1 AND vs.cancelled_at IS NULL
        AND vs.starts_at >= COALESCE($2::date, current_date)
        AND ($3::uuid IS NULL OR vs.unit_id = $3)
      GROUP BY vs.id, u.name
      ORDER BY vs.starts_at
      LIMIT 200`,
    [request.user!.school_id, query.from ?? null, query.unit_id ?? null],
  );
  response.json({ data: rows });
});

const createSlotsSchema = z.object({
  unit_id: uuid,
  dates: z.array(isoDate).min(1).max(60),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM')).min(1).max(12),
  capacity: z.number().int().min(1).max(50).default(3),
  timezone: z.string().max(60).default('America/Sao_Paulo'),
});

visitSlotsRouter.post('/', requirePermission('admissions:manage'), async (request, response) => {
  const input = parse(createSlotsSchema, request.body);
  const schoolId = request.user!.school_id;

  const created = await withTransaction(async (client) => {
    const unit = await client.query('SELECT 1 FROM units WHERE id = $1 AND school_id = $2', [input.unit_id, schoolId]);
    if (!unit.rowCount) throw notFound('Unidade não encontrada');

    const { rowCount } = await client.query(
      `INSERT INTO visit_slots (school_id, unit_id, starts_at, capacity, created_by)
       SELECT $1, $2, (d::date + t::time) AT TIME ZONE $6, $3, $4
         FROM unnest($5::text[]) AS d, unnest($7::text[]) AS t
        WHERE (d::date + t::time) AT TIME ZONE $6 > now()
       ON CONFLICT (unit_id, starts_at) DO NOTHING`,
      [schoolId, input.unit_id, input.capacity, request.user!.id, input.dates, input.timezone, input.times],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'visit_slots.created',
      entityType: 'unit',
      entityId: input.unit_id,
      metadata: { count: rowCount },
    });
    return rowCount ?? 0;
  });

  response.status(201).json({ created });
});

visitSlotsRouter.delete('/:id', requirePermission('admissions:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const busy = await client.query(`SELECT 1 FROM visits WHERE slot_id = $1 AND status = 'scheduled'`, [id]);
    if (busy.rowCount) throw conflict('Há visitas agendadas neste horário. Remarque-as antes de cancelar.');

    const { rowCount } = await client.query(
      'UPDATE visit_slots SET cancelled_at = now() WHERE id = $1 AND school_id = $2 AND cancelled_at IS NULL',
      [id, schoolId],
    );
    if (!rowCount) throw notFound('Horário não encontrado');
  });

  response.status(204).end();
});
