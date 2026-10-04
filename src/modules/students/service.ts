import { z } from 'zod';
import type { Db } from '../../shared/db.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { address, cpf, isoDate, phone, uuid } from '../../shared/schemas.js';
import { type Actor, recordAudit } from '../audit/service.js';

export const RELATIONSHIPS = ['mother', 'father', 'grandparent', 'uncle_aunt', 'sibling', 'legal_guardian', 'other'] as const;

export const newGuardianSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  phone: phone.optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido').optional(),
  cpf: cpf.optional(),
});

export const guardianLinkSchema = z.object({
  relationship: z.enum(RELATIONSHIPS),
  is_financial_responsible: z.boolean().default(false),
  is_primary_contact: z.boolean().default(false),
});

const guardianInputSchema = z.union([
  guardianLinkSchema.extend({ guardian_id: uuid }),
  guardianLinkSchema.merge(newGuardianSchema),
]);

/**
 * Cadastro mínimo: nome e nascimento do aluno, e nome e telefone de um responsável.
 * O restante dos dados é completado pelo próprio responsável no portal.
 */
export const createStudentSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  birth_date: isoDate,
  current_class_id: uuid.nullable().optional(),
  unit_id: uuid.optional(),
  status: z.enum(['applicant', 'active']).optional(),
  social_name: z.string().trim().max(160).optional(),
  cpf: cpf.optional(),
  address: address.optional(),
  health_notes: z.string().trim().max(2000).optional(),
  guardians: z.array(guardianInputSchema).min(1, 'Informe ao menos um responsável').max(4),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
type GuardianInput = z.infer<typeof guardianInputSchema>;

/**
 * Define a unidade do aluno: a informada, a da turma ou, na falta das duas,
 * a unidade mais antiga da escola (a sede).
 */
async function resolveUnit(db: Db, schoolId: string, classId: string | null | undefined, unitId: string | undefined) {
  if (classId) {
    const { rows } = await db.query<{ unit_id: string | null }>(
      'SELECT unit_id FROM classes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL',
      [classId, schoolId],
    );
    if (!rows[0]) throw notFound('Turma não encontrada');
    if (unitId && rows[0].unit_id && rows[0].unit_id !== unitId) throw badRequest('A turma é de outra unidade');
    if (rows[0].unit_id) return rows[0].unit_id;
  }

  if (unitId) {
    const { rowCount } = await db.query('SELECT 1 FROM units WHERE id = $1 AND school_id = $2', [unitId, schoolId]);
    if (!rowCount) throw notFound('Unidade não encontrada');
    return unitId;
  }

  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM units WHERE school_id = $1 ORDER BY created_at LIMIT 1',
    [schoolId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Localiza o responsável pelo telefone antes de criar um novo, para que irmãos
 * compartilhem o mesmo cadastro de responsável.
 */
async function resolveGuardian(db: Db, schoolId: string, input: GuardianInput, actor: Actor): Promise<string> {
  if ('guardian_id' in input) {
    const { rowCount } = await db.query(
      'SELECT 1 FROM guardians WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL',
      [input.guardian_id, schoolId],
    );
    if (!rowCount) throw notFound('Responsável não encontrado');
    return input.guardian_id;
  }

  if (input.phone) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM guardians
        WHERE school_id = $1 AND phone = $2 AND lower(full_name) = lower($3) AND deleted_at IS NULL
        LIMIT 1`,
      [schoolId, input.phone, input.full_name],
    );
    if (rows[0]) return rows[0].id;
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO guardians (school_id, full_name, phone, email, cpf)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [schoolId, input.full_name, input.phone ?? null, input.email ?? null, input.cpf ?? null],
  );

  await recordAudit(db, {
    schoolId,
    actor,
    action: 'guardian.created',
    entityType: 'guardian',
    entityId: rows[0].id,
  });

  return rows[0].id;
}

export async function linkGuardian(
  db: Db,
  schoolId: string,
  studentId: string,
  guardianId: string,
  link: z.infer<typeof guardianLinkSchema>,
) {
  await db.query(
    `INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship, is_financial_responsible, is_primary_contact)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (student_id, guardian_id) DO UPDATE
       SET relationship = EXCLUDED.relationship,
           is_financial_responsible = EXCLUDED.is_financial_responsible,
           is_primary_contact = EXCLUDED.is_primary_contact`,
    [schoolId, studentId, guardianId, link.relationship, link.is_financial_responsible, link.is_primary_contact],
  );
}

export async function createStudent(db: Db, schoolId: string, input: CreateStudentInput, actor: Actor) {
  const unitId = await resolveUnit(db, schoolId, input.current_class_id, input.unit_id);

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO students (school_id, full_name, social_name, birth_date, cpf, current_class_id, address, health_notes, unit_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      schoolId,
      input.full_name,
      input.social_name ?? null,
      input.birth_date,
      input.cpf ?? null,
      input.current_class_id ?? null,
      input.address ?? {},
      input.health_notes ?? null,
      unitId,
      input.status ?? 'active',
    ],
  );
  const studentId = rows[0].id;

  const hasPrimary = input.guardians.some((guardian) => guardian.is_primary_contact);
  for (const [index, guardian] of input.guardians.entries()) {
    const guardianId = await resolveGuardian(db, schoolId, guardian, actor);
    await linkGuardian(db, schoolId, studentId, guardianId, {
      ...guardian,
      // Sem indicação explícita, o primeiro responsável é o contato principal.
      is_primary_contact: guardian.is_primary_contact || (!hasPrimary && index === 0),
    });
  }

  await recordAudit(db, {
    schoolId,
    actor,
    action: 'student.created',
    entityType: 'student',
    entityId: studentId,
    metadata: { guardians: input.guardians.length },
  });

  return studentId;
}

export async function getStudent(db: Db, schoolId: string, studentId: string) {
  const { rows } = await db.query(
    `SELECT s.id, s.full_name, s.social_name, s.birth_date::text AS birth_date, s.cpf, s.address, s.health_notes,
            s.status, s.current_class_id, c.name AS current_class_name, s.unit_id, un.name AS unit_name,
            s.created_at, s.updated_at
       FROM students s
       LEFT JOIN classes c ON c.id = s.current_class_id
       LEFT JOIN units un ON un.id = s.unit_id
      WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
    [studentId, schoolId],
  );
  if (!rows[0]) throw notFound('Aluno não encontrado');

  const guardians = await db.query(
    `SELECT g.id, g.full_name, g.phone, g.email, g.cpf, g.address,
            sg.relationship, sg.is_financial_responsible, sg.is_primary_contact
       FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id
      WHERE sg.student_id = $1 AND sg.school_id = $2 AND g.deleted_at IS NULL
      ORDER BY sg.is_primary_contact DESC, g.full_name`,
    [studentId, schoolId],
  );

  return { ...rows[0], guardians: guardians.rows };
}

// Importação de listas (ex.: planilha digitada a partir das fichas em papel) ----

export const importSchema = z.object({
  school_year_id: uuid.optional(),
  rows: z
    .array(
      z.object({
        student_name: z.string().trim().min(2).max(160),
        birth_date: isoDate,
        class_name: z.string().trim().max(80).optional(),
        guardian_name: z.string().trim().min(2).max(160),
        guardian_phone: phone,
        relationship: z.enum(RELATIONSHIPS).default('other'),
      }),
    )
    .min(1)
    .max(1000),
});

export async function importStudents(db: Db, schoolId: string, input: z.infer<typeof importSchema>, actor: Actor) {
  const classIds = new Map<string, string>();

  if (input.school_year_id) {
    const { rows } = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM classes WHERE school_id = $1 AND school_year_id = $2 AND deleted_at IS NULL',
      [schoolId, input.school_year_id],
    );
    for (const row of rows) classIds.set(row.name.toLowerCase(), row.id);
  }

  const errors: { linha: number; mensagem: string }[] = [];
  input.rows.forEach((row, index) => {
    if (row.class_name && !classIds.has(row.class_name.toLowerCase())) {
      errors.push({ linha: index + 1, mensagem: `Turma "${row.class_name}" não encontrada no ano letivo` });
    }
  });
  if (errors.length) throw badRequest('Importação não realizada: corrija as linhas indicadas', errors);

  const created: string[] = [];
  for (const row of input.rows) {
    created.push(
      await createStudent(
        db,
        schoolId,
        {
          full_name: row.student_name,
          birth_date: row.birth_date,
          current_class_id: row.class_name ? classIds.get(row.class_name.toLowerCase()) : null,
          status: 'active',
          guardians: [
            {
              full_name: row.guardian_name,
              phone: row.guardian_phone,
              relationship: row.relationship,
              is_financial_responsible: true,
              is_primary_contact: true,
            },
          ],
        },
        actor,
      ),
    );
  }

  return created;
}
