import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { notFound } from '../../shared/errors.js';
import { idParams } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';

export const dashboardRouter = Router();

/** Visão geral da escola: o que a Direção nunca conseguiu enxergar no papel. */
dashboardRouter.get('/', requirePermission('dashboard:read'), async (request, response) => {
  const schoolId = request.user!.school_id;

  const [overview, campaigns] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT count(*)::int FROM students WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active') AS active_students,
         (SELECT count(*)::int FROM students WHERE school_id = $1 AND deleted_at IS NULL AND status = 'active'
             AND current_class_id IS NULL) AS students_without_class,
         (SELECT count(*)::int FROM classes WHERE school_id = $1 AND deleted_at IS NULL) AS classes,
         (SELECT count(*)::int FROM guardians WHERE school_id = $1 AND deleted_at IS NULL) AS guardians,
         (SELECT count(*)::int FROM guardians WHERE school_id = $1 AND deleted_at IS NULL AND phone IS NOT NULL) AS guardians_with_phone`,
      [schoolId],
    ),
    pool.query(
      `SELECT rc.id, rc.title, rc.status, rc.ends_on::text AS ends_on,
              count(r.id)::int AS total,
              count(r.id) FILTER (WHERE r.status <> 'pending')::int AS responded,
              count(r.id) FILTER (WHERE r.status = 'approved')::int AS approved
         FROM renewal_campaigns rc
         LEFT JOIN renewal_requests r ON r.campaign_id = rc.id
        WHERE rc.school_id = $1 AND rc.status = 'open'
        GROUP BY rc.id
        ORDER BY rc.created_at DESC`,
      [schoolId],
    ),
  ]);

  response.json({ ...overview.rows[0], open_campaigns: campaigns.rows });
});

/** Andamento de uma campanha de renovação, por situação, por turma e por dia. */
dashboardRouter.get('/renewals/:id', requirePermission('dashboard:read'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  const campaign = await pool.query(
    `SELECT id, title, status, starts_on::text AS starts_on, ends_on::text AS ends_on,
            GREATEST(0, ends_on - current_date) AS days_left
       FROM renewal_campaigns WHERE id = $1 AND school_id = $2`,
    [id, schoolId],
  );
  if (!campaign.rows[0]) throw notFound('Campanha não encontrada');

  const [totals, byClass, timeline] = await Promise.all([
    pool.query(
      `SELECT status, count(*)::int AS count FROM renewal_requests
        WHERE campaign_id = $1 AND school_id = $2 GROUP BY status`,
      [id, schoolId],
    ),
    pool.query(
      `SELECT COALESCE(c.name, 'Sem turma') AS class_name,
              count(*)::int AS total,
              count(*) FILTER (WHERE r.status <> 'pending')::int AS responded,
              count(*) FILTER (WHERE r.status = 'approved')::int AS approved
         FROM renewal_requests r
         JOIN students s ON s.id = r.student_id
         LEFT JOIN classes c ON c.id = s.current_class_id
        WHERE r.campaign_id = $1 AND r.school_id = $2
        GROUP BY c.name
        ORDER BY c.name NULLS LAST`,
      [id, schoolId],
    ),
    pool.query(
      `SELECT to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') AS day, count(DISTINCT e.request_id)::int AS submissions
         FROM renewal_request_events e
         JOIN renewal_requests r ON r.id = e.request_id
        WHERE r.campaign_id = $1 AND e.school_id = $2 AND e.to_status = 'submitted'
        GROUP BY 1 ORDER BY 1`,
      [id, schoolId],
    ),
  ]);

  const byStatus = Object.fromEntries(
    ['pending', 'submitted', 'changes_requested', 'approved', 'rejected'].map((status) => [
      status,
      totals.rows.find((row) => row.status === status)?.count ?? 0,
    ]),
  );
  const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const responded = total - byStatus.pending;

  response.json({
    campaign: campaign.rows[0],
    total,
    by_status: byStatus,
    response_rate: total ? Math.round((responded / total) * 100) : 0,
    approval_rate: total ? Math.round((byStatus.approved / total) * 100) : 0,
    by_class: byClass.rows,
    timeline: timeline.rows,
  });
});

/** Funil de captação de novos alunos: do primeiro contato à matrícula. */
dashboardRouter.get('/admissions', requirePermission('dashboard:read'), async (request, response) => {
  const schoolId = request.user!.school_id;

  const [byStatus, bySource, byUnit, weekly, upcoming] = await Promise.all([
    pool.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM admission_leads WHERE school_id = $1 GROUP BY status`,
      [schoolId],
    ),
    pool.query(
      `SELECT source, count(*)::int AS total, count(*) FILTER (WHERE status = 'enrolled')::int AS enrolled
         FROM admission_leads WHERE school_id = $1 GROUP BY source ORDER BY total DESC`,
      [schoolId],
    ),
    pool.query(
      `SELECT u.name AS unit_name, count(l.id)::int AS total,
              count(l.id) FILTER (WHERE l.status = 'enrolled')::int AS enrolled
         FROM units u LEFT JOIN admission_leads l ON l.unit_id = u.id
        WHERE u.school_id = $1 AND u.active GROUP BY u.id ORDER BY u.created_at`,
      [schoolId],
    ),
    pool.query(
      `SELECT to_char(w, 'YYYY-MM-DD') AS week,
              (SELECT count(*)::int FROM admission_leads l
                WHERE l.school_id = $1 AND l.created_at >= w AND l.created_at < w + interval '7 days') AS leads
         FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS w`,
      [schoolId],
    ),
    pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM visits v JOIN visit_slots vs ON vs.id = v.slot_id
        WHERE v.school_id = $1 AND v.status = 'scheduled' AND vs.starts_at BETWEEN now() AND now() + interval '7 days'`,
      [schoolId],
    ),
  ]);

  const count = (status: string) => byStatus.rows.find((row) => row.status === status)?.count ?? 0;
  const total = byStatus.rows.reduce((sum, row) => sum + row.count, 0);
  // Cada etapa conta quem chegou nela ou passou dela.
  const reachedVisit = ['visit_scheduled', 'visited', 'enrolling', 'enrolled'].reduce((sum, s) => sum + count(s), 0);
  const visited = ['visited', 'enrolling', 'enrolled'].reduce((sum, s) => sum + count(s), 0);
  const enrolling = count('enrolling') + count('enrolled');

  response.json({
    total,
    funnel: [
      { stage: 'leads', label: 'Contatos', count: total },
      { stage: 'visit', label: 'Visita agendada', count: reachedVisit },
      { stage: 'visited', label: 'Visitaram', count: visited },
      { stage: 'enrolling', label: 'Matrícula iniciada', count: enrolling },
      { stage: 'enrolled', label: 'Matriculados', count: count('enrolled') },
    ],
    new_waiting: count('new'),
    lost: count('lost'),
    conversion_rate: total ? Math.round((count('enrolled') / total) * 100) : 0,
    visits_next_7_days: upcoming.rows[0].count,
    by_source: bySource.rows,
    by_unit: byUnit.rows,
    weekly: weekly.rows,
  });
});
