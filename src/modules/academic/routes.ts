import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { conflict, notFound } from '../../shared/errors.js';
import { idParams, isoDate, uuid } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, recordAudit } from '../audit/service.js';

export const academicRouter = Router();

const yearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  starts_on: isoDate.optional(),
  ends_on: isoDate.optional(),
  status: z.enum(['planning', 'active', 'closed']).default('planning'),
});

const classSchema = z.object({
  school_year_id: uuid,
  unit_id: uuid.optional(),
  name: z.string().trim().min(1).max(80),
  grade: z.string().trim().min(1).max(60),
  shift: z.enum(['morning', 'afternoon', 'evening', 'full_time']),
  capacity: z.number().int().positive().nullable().optional(),
});

const classUpdateSchema = classSchema.omit({ school_year_id: true, unit_id: true }).partial().strict();

const CLASS_COLUMNS = 'c.id, c.school_year_id, sy.year, c.unit_id, c.name, c.grade, c.shift, c.capacity';

academicRouter.get('/school-years', requirePermission('academic:read'), async (request, response) => {
  const { rows } = await pool.query(
    `SELECT id, year, starts_on, ends_on, status FROM school_years WHERE school_id = $1 ORDER BY year DESC`,
    [request.user!.school_id],
  );
  response.json({ data: rows });
});

academicRouter.post('/school-years', requirePermission('academic:manage'), async (request, response) => {
  const input = parse(yearSchema, request.body);
  const schoolId = request.user!.school_id;

  const year = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO school_years (school_id, year, starts_on, ends_on, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, year) DO NOTHING
       RETURNING id, year, starts_on, ends_on, status`,
      [schoolId, input.year, input.starts_on ?? null, input.ends_on ?? null, input.status],
    );
    if (!rows[0]) throw conflict('Ano letivo já cadastrado');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'school_year.created',
      entityType: 'school_year',
      entityId: rows[0].id,
      metadata: { year: input.year },
    });
    return rows[0];
  });

  response.status(201).json(year);
});

const classQuery = z.object({ school_year_id: uuid.optional(), unit_id: uuid.optional() });

academicRouter.get('/classes', requirePermission('academic:read'), async (request, response) => {
  const query = parse(classQuery, request.query);

  const { rows } = await pool.query(
    `SELECT ${CLASS_COLUMNS},
            (SELECT count(*)::int FROM students s
              WHERE s.current_class_id = c.id AND s.deleted_at IS NULL AND s.status = 'active') AS student_count
       FROM classes c
       JOIN school_years sy ON sy.id = c.school_year_id
      WHERE c.school_id = $1
        AND c.deleted_at IS NULL
        AND ($2::uuid IS NULL OR c.school_year_id = $2)
        AND ($3::uuid IS NULL OR c.unit_id = $3)
      ORDER BY sy.year DESC, c.grade, c.name`,
    [request.user!.school_id, query.school_year_id ?? null, query.unit_id ?? null],
  );
  response.json({ data: rows });
});

academicRouter.post('/classes', requirePermission('academic:manage'), async (request, response) => {
  const input = parse(classSchema, request.body);
  const schoolId = request.user!.school_id;

  const created = await withTransaction(async (client) => {
    const year = await client.query('SELECT 1 FROM school_years WHERE id = $1 AND school_id = $2', [
      input.school_year_id,
      schoolId,
    ]);
    if (!year.rowCount) throw notFound('Ano letivo não encontrado');

    const unit = await client.query<{ id: string }>(
      input.unit_id
        ? 'SELECT id FROM units WHERE id = $2 AND school_id = $1'
        : 'SELECT id FROM units WHERE school_id = $1 AND $2::uuid IS NULL ORDER BY created_at LIMIT 1',
      [schoolId, input.unit_id ?? null],
    );
    if (!unit.rows[0]) throw notFound('Unidade não encontrada');

    const duplicate = await client.query(
      `SELECT 1 FROM classes
        WHERE school_year_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
      [input.school_year_id, input.name],
    );
    if (duplicate.rowCount) throw conflict('Já existe uma turma com este nome no ano letivo');

    const { rows } = await client.query(
      `INSERT INTO classes (school_id, school_year_id, name, grade, shift, capacity, unit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [schoolId, input.school_year_id, input.name, input.grade, input.shift, input.capacity ?? null, unit.rows[0].id],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'class.created',
      entityType: 'class',
      entityId: rows[0].id,
      metadata: { name: input.name, grade: input.grade },
    });
    return rows[0].id as string;
  });

  const { rows } = await pool.query(
    `SELECT ${CLASS_COLUMNS} FROM classes c JOIN school_years sy ON sy.id = c.school_year_id WHERE c.id = $1`,
    [created],
  );
  response.status(201).json(rows[0]);
});

academicRouter.patch('/classes/:id', requirePermission('academic:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(classUpdateSchema, request.body);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE classes
          SET name = COALESCE($3, name),
              grade = COALESCE($4, grade),
              shift = COALESCE($5, shift),
              capacity = CASE WHEN $6::boolean THEN $7 ELSE capacity END
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId, input.name, input.grade, input.shift, input.capacity !== undefined, input.capacity ?? null],
    );
    if (!rowCount) throw notFound('Turma não encontrada');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'class.updated',
      entityType: 'class',
      entityId: id,
      metadata: { changes: input },
    });
  });

  const { rows } = await pool.query(
    `SELECT ${CLASS_COLUMNS} FROM classes c JOIN school_years sy ON sy.id = c.school_year_id WHERE c.id = $1`,
    [id],
  );
  response.json(rows[0]);
});
