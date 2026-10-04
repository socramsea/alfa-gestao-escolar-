import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { idParams, isoDate, uuid } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, recordAudit } from '../audit/service.js';
import {
  REQUEST_STATUSES,
  approveRequest,
  changedFields,
  ensureClassInYear,
  lockRequest,
  reminderLink,
  syncCampaignRequests,
  transition,
} from './service.js';

// Campanhas (período de renovação) -------------------------------------------

export const campaignsRouter = Router();

const campaignSchema = z
  .object({
    school_year_id: uuid,
    title: z.string().trim().min(3).max(120),
    starts_on: isoDate,
    ends_on: isoDate,
  })
  .refine((value) => value.ends_on >= value.starts_on, {
    message: 'A data final deve ser igual ou posterior à inicial',
    path: ['ends_on'],
  });

const CAMPAIGN_SELECT = `
  SELECT rc.id, rc.title, rc.status, rc.starts_on::text AS starts_on, rc.ends_on::text AS ends_on,
         rc.school_year_id, sy.year, rc.created_at,
         count(r.id)::int AS total,
         count(r.id) FILTER (WHERE r.status = 'pending')::int AS pending,
         count(r.id) FILTER (WHERE r.status = 'submitted')::int AS submitted,
         count(r.id) FILTER (WHERE r.status = 'changes_requested')::int AS changes_requested,
         count(r.id) FILTER (WHERE r.status = 'approved')::int AS approved,
         count(r.id) FILTER (WHERE r.status = 'rejected')::int AS rejected
    FROM renewal_campaigns rc
    JOIN school_years sy ON sy.id = rc.school_year_id
    LEFT JOIN renewal_requests r ON r.campaign_id = rc.id`;

async function loadCampaign(schoolId: string, id: string) {
  const { rows } = await pool.query(`${CAMPAIGN_SELECT} WHERE rc.id = $1 AND rc.school_id = $2 GROUP BY rc.id, sy.year`, [
    id,
    schoolId,
  ]);
  if (!rows[0]) throw notFound('Campanha não encontrada');
  return rows[0];
}

campaignsRouter.get('/', requirePermission('renewals:read'), async (request, response) => {
  const { rows } = await pool.query(
    `${CAMPAIGN_SELECT} WHERE rc.school_id = $1 GROUP BY rc.id, sy.year ORDER BY rc.created_at DESC`,
    [request.user!.school_id],
  );
  response.json({ data: rows });
});

campaignsRouter.get('/:id', requirePermission('renewals:read'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  response.json(await loadCampaign(request.user!.school_id, id));
});

campaignsRouter.post('/', requirePermission('renewals:manage'), async (request, response) => {
  const input = parse(campaignSchema, request.body);
  const schoolId = request.user!.school_id;

  const id = await withTransaction(async (client) => {
    const year = await client.query('SELECT 1 FROM school_years WHERE id = $1 AND school_id = $2', [
      input.school_year_id,
      schoolId,
    ]);
    if (!year.rowCount) throw notFound('Ano letivo não encontrado');

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO renewal_campaigns (school_id, school_year_id, title, starts_on, ends_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [schoolId, input.school_year_id, input.title, input.starts_on, input.ends_on, request.user!.id],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'renewal_campaign.created',
      entityType: 'renewal_campaign',
      entityId: rows[0].id,
      metadata: { title: input.title },
    });
    return rows[0].id;
  });

  response.status(201).json(await loadCampaign(schoolId, id));
});

async function changeCampaignStatus(schoolId: string, id: string, to: 'open' | 'closed', actor: ReturnType<typeof actorFrom>) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM renewal_campaigns WHERE id = $1 AND school_id = $2 FOR UPDATE',
      [id, schoolId],
    );
    if (!rows[0]) throw notFound('Campanha não encontrada');
    if (rows[0].status === to) throw conflict(to === 'open' ? 'A campanha já está aberta' : 'A campanha já está encerrada');

    await client.query('UPDATE renewal_campaigns SET status = $3 WHERE id = $1 AND school_id = $2', [id, schoolId, to]);
    const created = to === 'open' ? await syncCampaignRequests(client, schoolId, id) : 0;

    await recordAudit(client, {
      schoolId,
      actor,
      action: `renewal_campaign.${to === 'open' ? 'opened' : 'closed'}`,
      entityType: 'renewal_campaign',
      entityId: id,
      metadata: { requests_created: created },
    });
    return created;
  });
}

campaignsRouter.post('/:id/open', requirePermission('renewals:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;
  const created = await changeCampaignStatus(schoolId, id, 'open', actorFrom(request));
  response.json({ ...(await loadCampaign(schoolId, id)), requests_created: created });
});

campaignsRouter.post('/:id/close', requirePermission('renewals:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;
  await changeCampaignStatus(schoolId, id, 'closed', actorFrom(request));
  response.json(await loadCampaign(schoolId, id));
});

// Inclui na campanha aberta os alunos cadastrados depois da abertura.
campaignsRouter.post('/:id/sync', requirePermission('renewals:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;
  const campaign = await loadCampaign(schoolId, id);
  if (campaign.status !== 'open') throw conflict('A campanha precisa estar aberta');

  const created = await withTransaction((client) => syncCampaignRequests(client, schoolId, id));
  response.json({ ...(await loadCampaign(schoolId, id)), requests_created: created });
});

// Solicitações de renovação ---------------------------------------------------

export const renewalRequestsRouter = Router();

const listQuery = z.object({
  campaign_id: uuid,
  status: z.enum(REQUEST_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
});

renewalRequestsRouter.get('/', requirePermission('renewals:read'), async (request, response) => {
  const query = parse(listQuery, request.query);
  const schoolId = request.user!.school_id;

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.submitted_at, r.reviewed_at, r.target_class_id, tc.name AS target_class_name,
            s.id AS student_id, s.full_name AS student_name, c.name AS current_class_name,
            g.full_name AS guardian_name, g.phone AS guardian_phone, sch.name AS school_name
       FROM renewal_requests r
       JOIN students s ON s.id = r.student_id
       JOIN schools sch ON sch.id = r.school_id
       LEFT JOIN classes c ON c.id = s.current_class_id
       LEFT JOIN classes tc ON tc.id = r.target_class_id
       LEFT JOIN LATERAL (
         SELECT g.full_name, g.phone
           FROM student_guardians sg
           JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
          WHERE sg.student_id = s.id
          ORDER BY sg.is_primary_contact DESC, g.full_name
          LIMIT 1
       ) g ON true
      WHERE r.school_id = $1
        AND r.campaign_id = $2
        AND ($3::text IS NULL OR r.status = $3)
        AND ($4::text IS NULL OR lower(s.full_name) LIKE $4)
      ORDER BY r.submitted_at ASC NULLS LAST, lower(s.full_name)`,
    [schoolId, query.campaign_id, query.status ?? null, query.search ? `%${query.search.toLowerCase()}%` : null],
  );

  response.json({
    data: rows.map(({ school_name, ...row }) => ({
      ...row,
      reminder_whatsapp_url: ['pending', 'changes_requested'].includes(row.status)
        ? reminderLink(row.guardian_phone, row.guardian_name, row.student_name, school_name)
        : null,
    })),
  });
});

renewalRequestsRouter.get('/:id', requirePermission('renewals:read'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.campaign_id, rc.title AS campaign_title, rc.school_year_id,
            r.target_class_id, r.proposed_data, r.guardian_notes, r.terms_accepted_at,
            r.submitted_at, r.submitted_by_guardian_id, r.reviewed_at, r.review_notes,
            u.name AS reviewed_by_name,
            json_build_object(
              'id', s.id, 'full_name', s.full_name, 'social_name', s.social_name,
              'birth_date', s.birth_date::text, 'cpf', s.cpf, 'address', s.address,
              'health_notes', s.health_notes, 'current_class_name', c.name
            ) AS student
       FROM renewal_requests r
       JOIN renewal_campaigns rc ON rc.id = r.campaign_id
       JOIN students s ON s.id = r.student_id
       LEFT JOIN classes c ON c.id = s.current_class_id
       LEFT JOIN users u ON u.id = r.reviewed_by
      WHERE r.id = $1 AND r.school_id = $2`,
    [id, schoolId],
  );
  const renewal = rows[0];
  if (!renewal) throw notFound('Solicitação de renovação não encontrada');

  const [guardians, events] = await Promise.all([
    pool.query(
      `SELECT g.id, g.full_name, g.phone, g.email, g.cpf, g.address, sg.relationship, sg.is_primary_contact
         FROM student_guardians sg
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
        WHERE sg.student_id = $1 AND sg.school_id = $2
        ORDER BY sg.is_primary_contact DESC, g.full_name`,
      [renewal.student.id, schoolId],
    ),
    pool.query(
      `SELECT e.from_status, e.to_status, e.actor_type, COALESCE(u.name, g.full_name) AS actor_name, e.notes, e.created_at
         FROM renewal_request_events e
         LEFT JOIN users u ON e.actor_type = 'user' AND u.id = e.actor_id
         LEFT JOIN guardians g ON e.actor_type = 'guardian' AND g.id = e.actor_id
        WHERE e.request_id = $1 AND e.school_id = $2
        ORDER BY e.created_at`,
      [id, schoolId],
    ),
  ]);

  const submitter = guardians.rows.find((guardian) => guardian.id === renewal.submitted_by_guardian_id) ?? null;

  response.json({
    ...renewal,
    guardians: guardians.rows,
    events: events.rows,
    changes:
      renewal.proposed_data && renewal.status !== 'approved'
        ? changedFields({ student: renewal.student, guardian: submitter }, renewal.proposed_data)
        : [],
  });
});

const targetClassSchema = z.object({ target_class_id: uuid.nullable() }).strict();

renewalRequestsRouter.patch('/:id', requirePermission('renewals:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(targetClassSchema, request.body);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const renewal = await lockRequest(client, schoolId, id);
    if (renewal.status === 'approved' || renewal.status === 'rejected') {
      throw conflict('Solicitação já finalizada');
    }
    if (input.target_class_id) await ensureClassInYear(client, schoolId, input.target_class_id, renewal.school_year_id);

    await client.query('UPDATE renewal_requests SET target_class_id = $3 WHERE id = $1 AND school_id = $2', [
      id,
      schoolId,
      input.target_class_id,
    ]);
  });

  response.json({ id, target_class_id: input.target_class_id });
});

const approveSchema = z.object({
  target_class_id: uuid.nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});

renewalRequestsRouter.post('/:id/approve', requirePermission('renewals:review'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(approveSchema, request.body ?? {});
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const renewal = await lockRequest(client, schoolId, id);
    const targetClassId = input.target_class_id === undefined ? renewal.target_class_id : input.target_class_id;
    if (targetClassId) await ensureClassInYear(client, schoolId, targetClassId, renewal.school_year_id);

    await approveRequest(client, renewal, actorFrom(request), targetClassId, input.notes ?? null);
  });

  response.json({ id, status: 'approved' });
});

const decisionSchema = z.object({ notes: z.string().trim().min(3, 'Informe o motivo').max(1000) });

for (const [path, status] of [
  ['reject', 'rejected'],
  ['request-changes', 'changes_requested'],
] as const) {
  renewalRequestsRouter.post(`/:id/${path}`, requirePermission('renewals:review'), async (request, response) => {
    const { id } = parse(idParams, request.params);
    const input = parse(decisionSchema, request.body ?? {});
    const schoolId = request.user!.school_id;

    await withTransaction(async (client) => {
      const renewal = await lockRequest(client, schoolId, id);
      if (renewal.campaign_status === 'draft') throw badRequest('Campanha ainda não foi aberta');

      await transition(client, renewal, status, actorFrom(request), input.notes);
      await client.query(
        `UPDATE renewal_requests
            SET status = $3, reviewed_by = $4, reviewed_at = now(), review_notes = $5
          WHERE id = $1 AND school_id = $2`,
        [id, schoolId, status, request.user!.id, input.notes],
      );
    });

    response.json({ id, status });
  });
}
