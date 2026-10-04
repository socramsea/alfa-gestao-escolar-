import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { notFound } from '../../shared/errors.js';
import { address, cpf, idParams, phone } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { whatsAppLink } from '../../shared/whatsapp.js';
import { actorFrom, diff, recordAudit } from '../audit/service.js';
import { generateOpaqueToken, hashToken } from '../auth/tokens.js';

export const guardiansRouter = Router();

async function loadGuardian(schoolId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT g.id, g.full_name, g.phone, g.email, g.cpf, g.address, g.created_at,
            COALESCE(json_agg(json_build_object(
              'id', s.id, 'full_name', s.full_name, 'relationship', sg.relationship
            ) ORDER BY s.full_name) FILTER (WHERE s.id IS NOT NULL), '[]') AS students,
            (SELECT max(created_at) FROM guardian_access_links l
              WHERE l.guardian_id = g.id AND l.revoked_at IS NULL AND l.expires_at > now()) AS active_link_created_at
       FROM guardians g
       LEFT JOIN student_guardians sg ON sg.guardian_id = g.id
       LEFT JOIN students s ON s.id = sg.student_id AND s.deleted_at IS NULL
      WHERE g.id = $1 AND g.school_id = $2 AND g.deleted_at IS NULL
      GROUP BY g.id`,
    [id, schoolId],
  );
  if (!rows[0]) throw notFound('Responsável não encontrado');
  return rows[0];
}

guardiansRouter.get('/:id', requirePermission('students:read'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  response.json(await loadGuardian(request.user!.school_id, id));
});

const updateSchema = z
  .object({
    full_name: z.string().trim().min(2).max(160),
    phone: phone.nullable(),
    email: z.string().trim().toLowerCase().email('E-mail inválido').nullable(),
    cpf: cpf.nullable(),
    address,
  })
  .partial()
  .strict();

const GUARDIAN_FIELDS = Object.keys(updateSchema.shape) as (keyof z.infer<typeof updateSchema>)[];

guardiansRouter.patch('/:id', requirePermission('students:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(updateSchema, request.body);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const before = await loadGuardian(schoolId, id);
    const fields = GUARDIAN_FIELDS.filter((field) => input[field] !== undefined);
    if (!fields.length) return;

    await client.query(
      `UPDATE guardians SET ${fields.map((field, index) => `${field} = $${index + 3}`).join(', ')}
        WHERE id = $1 AND school_id = $2`,
      [id, schoolId, ...fields.map((field) => input[field])],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'guardian.updated',
      entityType: 'guardian',
      entityId: id,
      metadata: { changes: diff(before, input) },
    });
  });

  response.json(await loadGuardian(schoolId, id));
});

/**
 * Gera o link pessoal do responsável. O token só é exibido nesta resposta; o banco
 * guarda apenas o hash. Links anteriores do mesmo responsável são revogados.
 */
guardiansRouter.post('/:id/access-links', requirePermission('guardians:invite'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;
  const guardian = await loadGuardian(schoolId, id);
  const token = generateOpaqueToken();

  const link = await withTransaction(async (client) => {
    await client.query(
      `UPDATE guardian_access_links SET revoked_at = now()
        WHERE guardian_id = $1 AND school_id = $2 AND revoked_at IS NULL`,
      [id, schoolId],
    );

    const { rows } = await client.query<{ expires_at: Date }>(
      `INSERT INTO guardian_access_links (school_id, guardian_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, now() + make_interval(days => $4), $5)
       RETURNING expires_at`,
      [schoolId, id, hashToken(token), env.PORTAL_LINK_TTL_DAYS, request.user!.id],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'guardian.access_link_created',
      entityType: 'guardian',
      entityId: id,
    });

    return rows[0];
  });

  const school = await pool.query<{ name: string }>('SELECT name FROM schools WHERE id = $1', [schoolId]);
  const url = `${env.PUBLIC_APP_URL}/r/${token}`;
  const firstName = guardian.full_name.split(' ')[0];
  const message =
    `Olá, ${firstName}! Aqui é da ${school.rows[0].name}. ` +
    `Pelo link abaixo você confere e atualiza os dados de matrícula, sem precisar vir à escola nem preencher papel:\n${url}\n` +
    `Para entrar, confirme a data de nascimento do aluno. O link é pessoal, não compartilhe.`;

  response.status(201).json({
    url,
    expires_at: link.expires_at,
    message,
    whatsapp_url: whatsAppLink(guardian.phone, message),
  });
});

guardiansRouter.post('/:id/access-links/revoke', requirePermission('guardians:invite'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;
  await loadGuardian(schoolId, id);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE guardian_access_links SET revoked_at = now()
        WHERE guardian_id = $1 AND school_id = $2 AND revoked_at IS NULL`,
      [id, schoolId],
    );
    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'guardian.access_links_revoked',
      entityType: 'guardian',
      entityId: id,
    });
  });

  response.status(204).end();
});
