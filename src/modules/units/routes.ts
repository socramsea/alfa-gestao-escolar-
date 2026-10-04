import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { conflict, notFound } from '../../shared/errors.js';
import { address, idParams, phone } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, recordAudit } from '../audit/service.js';

export const unitsRouter = Router();

export const UNIT_COLUMNS =
  'id, name, slug, address, phone, whatsapp, opening_hours, accepting_enrollments, active';

const unitSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens')
    .max(60),
  address: address.default({}),
  phone: phone.nullable().optional(),
  whatsapp: phone.nullable().optional(),
  opening_hours: z.string().trim().max(160).nullable().optional(),
  accepting_enrollments: z.boolean().default(true),
  active: z.boolean().default(true),
});

unitsRouter.get('/', requirePermission('school:read'), async (request, response) => {
  const { rows } = await pool.query(
    `SELECT ${UNIT_COLUMNS},
            (SELECT count(*)::int FROM students s
              WHERE s.unit_id = u.id AND s.deleted_at IS NULL AND s.status = 'active') AS active_students
       FROM units u WHERE school_id = $1 ORDER BY created_at`,
    [request.user!.school_id],
  );
  response.json({ data: rows });
});

unitsRouter.post('/', requirePermission('units:manage'), async (request, response) => {
  const input = parse(unitSchema, request.body);
  const schoolId = request.user!.school_id;

  const unit = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO units (school_id, name, slug, address, phone, whatsapp, opening_hours, accepting_enrollments, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (school_id, slug) DO NOTHING
       RETURNING ${UNIT_COLUMNS}`,
      [
        schoolId,
        input.name,
        input.slug,
        input.address,
        input.phone ?? null,
        input.whatsapp ?? null,
        input.opening_hours ?? null,
        input.accepting_enrollments,
        input.active,
      ],
    );
    if (!rows[0]) throw conflict('Já existe uma unidade com este identificador');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'unit.created',
      entityType: 'unit',
      entityId: rows[0].id,
      metadata: { name: input.name },
    });
    return rows[0];
  });

  response.status(201).json(unit);
});

const UNIT_FIELDS = ['name', 'address', 'phone', 'whatsapp', 'opening_hours', 'accepting_enrollments', 'active'] as const;
const updateSchema = unitSchema.omit({ slug: true }).partial().strict();

unitsRouter.patch('/:id', requirePermission('units:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(updateSchema, request.body);
  const schoolId = request.user!.school_id;
  const fields = UNIT_FIELDS.filter((field) => request.body?.[field] !== undefined);

  const unit = await withTransaction(async (client) => {
    if (fields.length) {
      await client.query(
        `UPDATE units SET ${fields.map((field, index) => `${field} = $${index + 3}`).join(', ')}
          WHERE id = $1 AND school_id = $2`,
        [id, schoolId, ...fields.map((field) => input[field] ?? null)],
      );
    }
    const { rows } = await client.query(`SELECT ${UNIT_COLUMNS} FROM units WHERE id = $1 AND school_id = $2`, [id, schoolId]);
    if (!rows[0]) throw notFound('Unidade não encontrada');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'unit.updated',
      entityType: 'unit',
      entityId: id,
      metadata: { fields },
    });
    return rows[0];
  });

  response.json(unit);
});

export async function ensureUnit(db: { query: typeof pool.query }, schoolId: string, unitId: string) {
  const { rowCount } = await db.query('SELECT 1 FROM units WHERE id = $1 AND school_id = $2', [unitId, schoolId]);
  if (!rowCount) throw notFound('Unidade não encontrada');
}
