import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { requireGuardian } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { conflict, notFound, unauthorized } from '../../shared/errors.js';
import { idParams, isoDate } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, recordAudit } from '../audit/service.js';
import { hashToken, signPortalToken } from '../auth/tokens.js';
import { STATUS_LABELS, lockRequest, proposedDataSchema, transition } from '../renewals/service.js';

export const portalRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;

const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
});

const sessionSchema = z.object({
  token: z.string().min(20).max(100),
  student_birth_date: isoDate,
});

/**
 * Troca o link pessoal por uma sessão do portal. Como o link pode ser repassado
 * no WhatsApp, o responsável também confirma a data de nascimento de um aluno.
 * Após 5 erros o link é bloqueado e a escola precisa gerar outro.
 */
portalRouter.post('/session', sessionLimiter, async (request, response) => {
  const input = parse(sessionSchema, request.body);

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      school_id: string;
      guardian_id: string;
      guardian_name: string;
      failed_attempts: number;
    }>(
      `SELECT l.id, l.school_id, l.guardian_id, g.full_name AS guardian_name, l.failed_attempts
         FROM guardian_access_links l
         JOIN guardians g ON g.id = l.guardian_id AND g.deleted_at IS NULL
         JOIN schools s ON s.id = l.school_id AND s.deleted_at IS NULL AND s.status <> 'suspended'
        WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND l.expires_at > now()
          FOR UPDATE OF l`,
      [hashToken(input.token)],
    );
    const link = rows[0];
    if (!link) return { ok: false as const };

    const match = await client.query(
      `SELECT 1 FROM student_guardians sg
         JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
        WHERE sg.guardian_id = $1 AND sg.school_id = $2 AND s.birth_date = $3`,
      [link.guardian_id, link.school_id, input.student_birth_date],
    );

    if (!match.rowCount) {
      const attempts = link.failed_attempts + 1;
      await client.query(
        `UPDATE guardian_access_links
            SET failed_attempts = $2::int, revoked_at = CASE WHEN $2::int >= $3::int THEN now() ELSE NULL END
          WHERE id = $1`,
        [link.id, attempts, MAX_FAILED_ATTEMPTS],
      );
      await recordAudit(client, {
        schoolId: link.school_id,
        actor: { type: 'guardian', id: link.guardian_id },
        action: attempts >= MAX_FAILED_ATTEMPTS ? 'portal.link_blocked' : 'portal.session_failed',
        entityType: 'guardian',
        entityId: link.guardian_id,
        metadata: { attempts, ip: request.ip },
      });
      return { ok: false as const };
    }

    await client.query(
      `UPDATE guardian_access_links
          SET use_count = use_count + 1, last_used_at = now(), failed_attempts = 0
        WHERE id = $1`,
      [link.id],
    );
    await recordAudit(client, {
      schoolId: link.school_id,
      actor: { type: 'guardian', id: link.guardian_id },
      action: 'portal.session_started',
      entityType: 'guardian',
      entityId: link.guardian_id,
      metadata: { ip: request.ip },
    });

    return { ok: true as const, link };
  });

  if (!result.ok) throw unauthorized('Link inválido, expirado ou data de nascimento incorreta');

  response.json({
    token: signPortalToken({ sub: result.link.guardian_id, school_id: result.link.school_id }),
    guardian_name: result.link.guardian_name,
  });
});

portalRouter.use(requireGuardian);

portalRouter.get('/me', async (request, response) => {
  const guardian = request.guardian!;

  const [school, students] = await Promise.all([
    pool.query('SELECT name FROM schools WHERE id = $1', [guardian.school_id]),
    pool.query(
      `SELECT s.id, s.full_name, c.name AS current_class_name,
              COALESCE(json_agg(json_build_object(
                'id', r.id, 'status', r.status, 'campaign_title', rc.title, 'campaign_kind', rc.kind,
                'ends_on', rc.ends_on::text, 'review_notes', r.review_notes
              ) ORDER BY rc.created_at DESC) FILTER (WHERE rc.id IS NOT NULL), '[]') AS renewals
         FROM student_guardians sg
         JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
         LEFT JOIN classes c ON c.id = s.current_class_id
         LEFT JOIN renewal_requests r ON r.student_id = s.id
         LEFT JOIN renewal_campaigns rc ON rc.id = r.campaign_id AND rc.status <> 'draft'
        WHERE sg.guardian_id = $1 AND sg.school_id = $2
        GROUP BY s.id, c.name
        ORDER BY s.full_name`,
      [guardian.id, guardian.school_id],
    ),
  ]);

  response.json({
    guardian: { id: guardian.id, name: guardian.name },
    school: { name: school.rows[0].name },
    students: students.rows.map((student) => ({
      ...student,
      renewals: student.renewals.map((renewal: { status: keyof typeof STATUS_LABELS }) => ({
        ...renewal,
        status_label: STATUS_LABELS[renewal.status],
      })),
    })),
  });
});

/** Garante que a solicitação é de um aluno vinculado ao responsável autenticado. */
async function loadOwnRequest(guardianId: string, schoolId: string, requestId: string) {
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.proposed_data, r.guardian_notes, r.review_notes, r.submitted_at,
            rc.title AS campaign_title, rc.kind AS campaign_kind, rc.status AS campaign_status, rc.ends_on::text AS ends_on,
            json_build_object(
              'full_name', s.full_name, 'social_name', s.social_name, 'birth_date', s.birth_date::text,
              'cpf', s.cpf, 'address', s.address, 'health_notes', s.health_notes,
              'current_class_name', c.name
            ) AS student,
            json_build_object(
              'full_name', g.full_name, 'phone', g.phone, 'email', g.email, 'cpf', g.cpf, 'address', g.address
            ) AS guardian
       FROM renewal_requests r
       JOIN renewal_campaigns rc ON rc.id = r.campaign_id AND rc.status <> 'draft'
       JOIN students s ON s.id = r.student_id AND s.deleted_at IS NULL
       JOIN student_guardians sg ON sg.student_id = s.id AND sg.guardian_id = $1
       JOIN guardians g ON g.id = sg.guardian_id
       LEFT JOIN classes c ON c.id = s.current_class_id
      WHERE r.id = $3 AND r.school_id = $2`,
    [guardianId, schoolId, requestId],
  );
  // 404 também quando o aluno não é do responsável: não revela que o registro existe.
  if (!rows[0]) throw notFound('Solicitação não encontrada');
  return rows[0];
}

portalRouter.get('/renewals/:id', async (request, response) => {
  const { id } = parse(idParams, request.params);
  const guardian = request.guardian!;
  const renewal = await loadOwnRequest(guardian.id, guardian.school_id, id);

  response.json({
    ...renewal,
    status_label: STATUS_LABELS[renewal.status as keyof typeof STATUS_LABELS],
    can_submit: renewal.campaign_status === 'open' && ['pending', 'submitted', 'changes_requested'].includes(renewal.status),
  });
});

const submitSchema = z.object({
  data: proposedDataSchema,
  notes: z.string().trim().max(1000).optional(),
  accept_terms: z.literal(true, { errorMap: () => ({ message: 'É necessário confirmar que os dados são verdadeiros' }) }),
});

portalRouter.post('/renewals/:id/submit', async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(submitSchema, request.body);
  const guardian = request.guardian!;

  await loadOwnRequest(guardian.id, guardian.school_id, id);

  await withTransaction(async (client) => {
    const renewal = await lockRequest(client, guardian.school_id, id);
    if (renewal.campaign_status !== 'open') throw conflict('O período de renovação não está aberto');

    await transition(client, renewal, 'submitted', actorFrom(request), input.notes ?? null);
    await client.query(
      `UPDATE renewal_requests
          SET status = 'submitted', proposed_data = $3, guardian_notes = $4,
              submitted_by_guardian_id = $5, submitted_at = now(), terms_accepted_at = now()
        WHERE id = $1 AND school_id = $2`,
      [id, guardian.school_id, input.data, input.notes ?? null, guardian.id],
    );
  });

  response.json(await loadOwnRequest(guardian.id, guardian.school_id, id));
});
