import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { idParams } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { STAFF_ROLES } from '../access/permissions.js';
import { actorFrom, diff, recordAudit } from '../audit/service.js';
import { hashPassword, passwordRule } from '../auth/passwords.js';

export const usersRouter = Router();

const USER_COLUMNS = 'id, name, email, role, active, last_login_at, created_at';

const password = z
  .string()
  .max(200)
  .refine(passwordRule, 'A senha deve ter ao menos 10 caracteres, com letras e números');

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  role: z.enum(STAFF_ROLES),
  password,
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    role: z.enum(STAFF_ROLES).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
  })
  .strict();

usersRouter.get('/', requirePermission('users:read'), async (request, response) => {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users
      WHERE school_id = $1 AND deleted_at IS NULL
      ORDER BY lower(name)`,
    [request.user!.school_id],
  );

  response.json({ data: rows });
});

usersRouter.post('/', requirePermission('users:manage'), async (request, response) => {
  const input = parse(createSchema, request.body);
  const schoolId = request.user!.school_id;

  const user = await withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM users WHERE school_id = $1 AND lower(email) = $2 AND deleted_at IS NULL',
      [schoolId, input.email],
    );
    if (existing.rowCount) throw conflict('Já existe um usuário com este e-mail na escola');

    const { rows } = await client.query(
      `INSERT INTO users (school_id, name, email, role, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_COLUMNS}`,
      [schoolId, input.name, input.email, input.role, await hashPassword(input.password)],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'user.created',
      entityType: 'user',
      entityId: rows[0].id,
      metadata: { email: input.email, role: input.role },
    });

    return rows[0];
  });

  response.status(201).json(user);
});

usersRouter.patch('/:id', requirePermission('users:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(updateSchema, request.body);
  const schoolId = request.user!.school_id;

  if (id === request.user!.id && (input.active === false || (input.role && input.role !== request.user!.role))) {
    throw badRequest('Você não pode desativar nem alterar o próprio perfil');
  }

  const user = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, schoolId],
    );
    if (!current.rows[0]) throw notFound('Usuário não encontrado');

    const { rows } = await client.query(
      `UPDATE users
          SET name = COALESCE($3, name),
              role = COALESCE($4, role),
              active = COALESCE($5, active),
              password_hash = COALESCE($6, password_hash)
        WHERE id = $1 AND school_id = $2
        RETURNING ${USER_COLUMNS}`,
      [id, schoolId, input.name, input.role, input.active, input.password ? await hashPassword(input.password) : null],
    );

    const { name, role, active } = rows[0];
    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: {
        changes: diff(current.rows[0], { name, role, active }),
        password_changed: Boolean(input.password),
      },
    });

    return rows[0];
  });

  response.json(user);
});

usersRouter.delete('/:id', requirePermission('users:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  if (id === request.user!.id) throw badRequest('Você não pode excluir o próprio usuário');

  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET active = false, deleted_at = now()
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!rowCount) throw notFound('Usuário não encontrado');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'user.deleted',
      entityType: 'user',
      entityId: id,
    });
  });

  response.status(204).end();
});
