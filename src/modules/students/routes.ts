import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { notFound } from '../../shared/errors.js';
import { address, cpf, idParams, isoDate, uuid } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, diff, recordAudit } from '../audit/service.js';
import {
  createStudent,
  createStudentSchema,
  getStudent,
  guardianLinkSchema,
  importSchema,
  importStudents,
  linkGuardian,
  newGuardianSchema,
} from './service.js';

export const studentsRouter = Router();

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  class_id: uuid.optional(),
  without_class: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(30),
});

studentsRouter.get('/', requirePermission('students:read'), async (request, response) => {
  const query = parse(listQuery, request.query);
  const schoolId = request.user!.school_id;
  const params = [
    schoolId,
    query.search ? `%${query.search.toLowerCase()}%` : null,
    query.class_id ?? null,
    query.without_class === 'true',
  ];
  const where = `
      WHERE s.school_id = $1
        AND s.deleted_at IS NULL
        AND ($2::text IS NULL OR lower(s.full_name) LIKE $2)
        AND ($3::uuid IS NULL OR s.current_class_id = $3)
        AND (NOT $4::boolean OR s.current_class_id IS NULL)`;

  const [{ rows }, total] = await Promise.all([
    pool.query(
      `SELECT s.id, s.full_name, s.birth_date::text AS birth_date, s.status,
              s.current_class_id, c.name AS current_class_name,
              pg.id AS primary_guardian_id, pg.full_name AS primary_guardian_name, pg.phone AS primary_guardian_phone
         FROM students s
         LEFT JOIN classes c ON c.id = s.current_class_id
         LEFT JOIN LATERAL (
           SELECT g.id, g.full_name, g.phone
             FROM student_guardians sg
             JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
            WHERE sg.student_id = s.id
            ORDER BY sg.is_primary_contact DESC, g.full_name
            LIMIT 1
         ) pg ON true
         ${where}
        ORDER BY lower(s.full_name)
        LIMIT $5 OFFSET $6`,
      [...params, query.page_size, (query.page - 1) * query.page_size],
    ),
    pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM students s ${where}`, params),
  ]);

  response.json({ data: rows, page: query.page, page_size: query.page_size, total: total.rows[0].count });
});

studentsRouter.post('/', requirePermission('students:manage'), async (request, response) => {
  const input = parse(createStudentSchema, request.body);
  const schoolId = request.user!.school_id;

  const studentId = await withTransaction((client) => createStudent(client, schoolId, input, actorFrom(request)));

  response.status(201).json(await getStudent(pool, schoolId, studentId));
});

studentsRouter.post('/import', requirePermission('students:manage'), async (request, response) => {
  const input = parse(importSchema, request.body);
  const schoolId = request.user!.school_id;

  const ids = await withTransaction(async (client) => {
    const created = await importStudents(client, schoolId, input, actorFrom(request));
    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'student.imported',
      entityType: 'student',
      metadata: { count: created.length },
    });
    return created;
  });

  response.status(201).json({ created: ids.length });
});

studentsRouter.get('/:id', requirePermission('students:read'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  const [student, enrollments, renewals] = await Promise.all([
    getStudent(pool, schoolId, id),
    pool.query(
      `SELECT e.id, sy.year, e.status, c.name AS class_name, e.created_at
         FROM enrollments e
         JOIN school_years sy ON sy.id = e.school_year_id
         LEFT JOIN classes c ON c.id = e.class_id
        WHERE e.student_id = $1 AND e.school_id = $2
        ORDER BY sy.year DESC`,
      [id, schoolId],
    ),
    pool.query(
      `SELECT r.id, r.status, rc.title AS campaign_title, r.submitted_at, r.reviewed_at
         FROM renewal_requests r
         JOIN renewal_campaigns rc ON rc.id = r.campaign_id
        WHERE r.student_id = $1 AND r.school_id = $2
        ORDER BY r.created_at DESC`,
      [id, schoolId],
    ),
  ]);

  response.json({ ...student, enrollments: enrollments.rows, renewals: renewals.rows });
});

const updateSchema = z
  .object({
    full_name: z.string().trim().min(2).max(160),
    social_name: z.string().trim().max(160).nullable(),
    birth_date: isoDate,
    cpf: cpf.nullable(),
    current_class_id: uuid.nullable(),
    address,
    health_notes: z.string().trim().max(2000).nullable(),
    status: z.enum(['active', 'inactive', 'transferred', 'graduated']),
  })
  .partial()
  .strict();

const STUDENT_FIELDS = Object.keys(updateSchema.shape) as (keyof z.infer<typeof updateSchema>)[];

studentsRouter.patch('/:id', requirePermission('students:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(updateSchema, request.body);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const before = await getStudent(client, schoolId, id);

    if (input.current_class_id) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL',
        [input.current_class_id, schoolId],
      );
      if (!rowCount) throw notFound('Turma não encontrada');
    }

    const fields = STUDENT_FIELDS.filter((field) => input[field] !== undefined);
    if (!fields.length) return;

    await client.query(
      `UPDATE students SET ${fields.map((field, index) => `${field} = $${index + 3}`).join(', ')}
        WHERE id = $1 AND school_id = $2`,
      [id, schoolId, ...fields.map((field) => input[field])],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'student.updated',
      entityType: 'student',
      entityId: id,
      metadata: { changes: diff(before, input) },
    });
  });

  response.json(await getStudent(pool, schoolId, id));
});

studentsRouter.delete('/:id', requirePermission('students:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE students SET deleted_at = now(), status = 'inactive'
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!rowCount) throw notFound('Aluno não encontrado');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'student.deleted',
      entityType: 'student',
      entityId: id,
    });
  });

  response.status(204).end();
});

const addGuardianSchema = z.union([
  guardianLinkSchema.extend({ guardian_id: uuid }),
  guardianLinkSchema.merge(newGuardianSchema),
]);

studentsRouter.post('/:id/guardians', requirePermission('students:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const input = parse(addGuardianSchema, request.body);
  const schoolId = request.user!.school_id;
  const actor = actorFrom(request);

  await withTransaction(async (client) => {
    await getStudent(client, schoolId, id);

    let guardianId: string;
    if ('guardian_id' in input) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM guardians WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL',
        [input.guardian_id, schoolId],
      );
      if (!rowCount) throw notFound('Responsável não encontrado');
      guardianId = input.guardian_id;
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO guardians (school_id, full_name, phone, email, cpf) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, input.full_name, input.phone ?? null, input.email ?? null, input.cpf ?? null],
      );
      guardianId = rows[0].id;
    }

    await linkGuardian(client, schoolId, id, guardianId, input);
    await recordAudit(client, {
      schoolId,
      actor,
      action: 'student.guardian_linked',
      entityType: 'student',
      entityId: id,
      metadata: { guardian_id: guardianId, relationship: input.relationship },
    });
  });

  response.status(201).json(await getStudent(pool, schoolId, id));
});

const unlinkParams = z.object({ id: uuid, guardianId: uuid });

studentsRouter.delete('/:id/guardians/:guardianId', requirePermission('students:manage'), async (request, response) => {
  const { id, guardianId } = parse(unlinkParams, request.params);
  const schoolId = request.user!.school_id;

  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM student_guardians WHERE student_id = $1 AND guardian_id = $2 AND school_id = $3',
      [id, guardianId, schoolId],
    );
    if (!rowCount) throw notFound('Vínculo não encontrado');

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'student.guardian_unlinked',
      entityType: 'student',
      entityId: id,
      metadata: { guardian_id: guardianId },
    });
  });

  response.status(204).end();
});
