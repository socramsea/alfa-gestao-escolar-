import { z } from 'zod';
import type { Db } from '../../shared/db.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { address, cpf, phone } from '../../shared/schemas.js';
import { whatsAppLink } from '../../shared/whatsapp.js';
import { type Actor, recordAudit } from '../audit/service.js';

export const REQUEST_STATUSES = ['pending', 'submitted', 'changes_requested', 'approved', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Transições permitidas e quem pode executá-las.
 * - O responsável envia (ou reenvia, enquanto a escola não analisou).
 * - A Secretaria aprova, rejeita ou devolve para correção.
 */
const TRANSITIONS: Record<RequestStatus, Partial<Record<RequestStatus, Actor['type']>>> = {
  pending: { submitted: 'guardian' },
  changes_requested: { submitted: 'guardian' },
  submitted: { submitted: 'guardian', approved: 'user', rejected: 'user', changes_requested: 'user' },
  approved: {},
  rejected: {},
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Aguardando responsável',
  submitted: 'Enviado para análise',
  changes_requested: 'Correção solicitada',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

/** Dados que o responsável pode confirmar ou corrigir no portal. */
export const proposedDataSchema = z
  .object({
    student: z
      .object({
        full_name: z.string().trim().min(2).max(160),
        social_name: z.string().trim().max(160).nullable().optional(),
        cpf: cpf.nullable().optional(),
        address: address.optional(),
        health_notes: z.string().trim().max(2000).nullable().optional(),
      })
      .strict(),
    guardian: z
      .object({
        full_name: z.string().trim().min(2).max(160),
        phone,
        email: z.string().trim().toLowerCase().email('E-mail inválido').nullable().optional(),
        cpf: cpf.nullable().optional(),
        address: address.optional(),
      })
      .strict(),
  })
  .strict();

export type ProposedData = z.infer<typeof proposedDataSchema>;

type RequestRow = {
  id: string;
  school_id: string;
  campaign_id: string;
  student_id: string;
  status: RequestStatus;
  submitted_by_guardian_id: string | null;
  proposed_data: ProposedData | null;
  target_class_id: string | null;
  campaign_status: 'draft' | 'open' | 'closed';
  campaign_kind: 'renewal' | 'admission';
  school_year_id: string;
  admission_lead_id: string | null;
};

export async function lockRequest(db: Db, schoolId: string, requestId: string): Promise<RequestRow> {
  const { rows } = await db.query<RequestRow>(
    `SELECT r.id, r.school_id, r.campaign_id, r.student_id, r.status, r.submitted_by_guardian_id,
            r.proposed_data, r.target_class_id, rc.status AS campaign_status, rc.kind AS campaign_kind,
            rc.school_year_id, r.admission_lead_id
       FROM renewal_requests r
       JOIN renewal_campaigns rc ON rc.id = r.campaign_id
      WHERE r.id = $1 AND r.school_id = $2
        FOR UPDATE OF r`,
    [requestId, schoolId],
  );
  if (!rows[0]) throw notFound('Solicitação de renovação não encontrada');
  return rows[0];
}

export async function transition(
  db: Db,
  request: RequestRow,
  to: RequestStatus,
  actor: Actor,
  notes: string | null = null,
) {
  const allowedActor = TRANSITIONS[request.status][to];
  if (!allowedActor || allowedActor !== actor.type) {
    throw conflict(`Não é possível passar de "${STATUS_LABELS[request.status]}" para "${STATUS_LABELS[to]}"`);
  }

  await db.query(
    `INSERT INTO renewal_request_events (school_id, request_id, from_status, to_status, actor_type, actor_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [request.school_id, request.id, request.status, to, actor.type, actor.id, notes],
  );

  await recordAudit(db, {
    schoolId: request.school_id,
    actor,
    action: `renewal.${to}`,
    entityType: 'renewal_request',
    entityId: request.id,
    metadata: { from: request.status, to, notes },
  });
}

/**
 * Renovação: cria as solicitações dos alunos ativos (da unidade, se a campanha for
 * de uma unidade) que ainda não estão na campanha. Matrícula de novos alunos não
 * sincroniza: as solicitações nascem da conversão de cada interessado.
 */
export async function syncCampaignRequests(db: Db, schoolId: string, campaignId: string) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO renewal_requests (school_id, campaign_id, student_id)
     SELECT s.school_id, rc.id, s.id
       FROM students s
       JOIN renewal_campaigns rc ON rc.id = $2 AND rc.school_id = s.school_id AND rc.kind = 'renewal'
      WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
        AND (rc.unit_id IS NULL OR s.unit_id = rc.unit_id)
     ON CONFLICT (campaign_id, student_id) DO NOTHING
     RETURNING id`,
    [schoolId, campaignId],
  );

  if (rows.length) {
    await db.query(
      `INSERT INTO renewal_request_events (school_id, request_id, to_status, actor_type)
       SELECT $1, unnest($2::uuid[]), 'pending', 'system'`,
      [schoolId, rows.map((row) => row.id)],
    );
  }

  return rows.length;
}

export async function ensureClassInYear(db: Db, schoolId: string, classId: string, schoolYearId: string) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM classes WHERE id = $1 AND school_id = $2 AND school_year_id = $3 AND deleted_at IS NULL`,
    [classId, schoolId, schoolYearId],
  );
  if (!rowCount) throw badRequest('A turma de destino deve pertencer ao ano letivo da campanha');
}

/**
 * Na aprovação, os dados confirmados pelo responsável são gravados no cadastro
 * e a matrícula do novo ano é criada. A Secretaria não redigita nada.
 */
export async function approveRequest(
  db: Db,
  request: RequestRow,
  actor: Actor,
  targetClassId: string | null,
  notes: string | null,
) {
  await transition(db, request, 'approved', actor, notes);

  const data = request.proposed_data;
  if (data) {
    await db.query(
      `UPDATE students
          SET full_name = $3,
              social_name = $4,
              cpf = $5,
              address = COALESCE($6, address),
              health_notes = $7
        WHERE id = $1 AND school_id = $2`,
      [
        request.student_id,
        request.school_id,
        data.student.full_name,
        data.student.social_name ?? null,
        data.student.cpf ?? null,
        data.student.address ?? null,
        data.student.health_notes ?? null,
      ],
    );

    if (request.submitted_by_guardian_id) {
      await db.query(
        `UPDATE guardians
            SET full_name = $3, phone = $4, email = $5, cpf = $6, address = COALESCE($7, address)
          WHERE id = $1 AND school_id = $2`,
        [
          request.submitted_by_guardian_id,
          request.school_id,
          data.guardian.full_name,
          data.guardian.phone,
          data.guardian.email ?? null,
          data.guardian.cpf ?? null,
          data.guardian.address ?? null,
        ],
      );
    }
  }

  await db.query(
    `UPDATE renewal_requests
        SET status = 'approved', target_class_id = $3, reviewed_by = $4, reviewed_at = now(), review_notes = $5
      WHERE id = $1 AND school_id = $2`,
    [request.id, request.school_id, targetClassId, actor.id, notes],
  );

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO enrollments (school_id, student_id, school_year_id, class_id, source_renewal_request_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, school_year_id) DO UPDATE
       SET class_id = EXCLUDED.class_id,
           status = 'active',
           source_renewal_request_id = EXCLUDED.source_renewal_request_id
     RETURNING id`,
    [request.school_id, request.student_id, request.school_year_id, targetClassId, request.id],
  );

  // Aluno novo deixa de ser candidato e o atendimento de captação é concluído.
  await db.query(
    `UPDATE students SET status = 'active' WHERE id = $1 AND school_id = $2 AND status = 'applicant'`,
    [request.student_id, request.school_id],
  );
  if (request.admission_lead_id) {
    await finishLead(db, request, 'enrolled', actor, null);
  }

  await recordAudit(db, {
    schoolId: request.school_id,
    actor,
    action: 'enrollment.created_from_renewal',
    entityType: 'enrollment',
    entityId: rows[0].id,
    metadata: { renewal_request_id: request.id, class_id: targetClassId },
  });
}

async function finishLead(db: Db, request: RequestRow, to: 'enrolled' | 'lost', actor: Actor, notes: string | null) {
  const { rows } = await db.query<{ status: string }>(
    'SELECT status FROM admission_leads WHERE id = $1 AND school_id = $2 FOR UPDATE',
    [request.admission_lead_id, request.school_id],
  );
  if (!rows[0] || rows[0].status === to) return;

  await db.query(
    `UPDATE admission_leads SET status = $3::varchar, lost_reason = CASE WHEN $3::varchar = 'lost' THEN $4::varchar ELSE lost_reason END
      WHERE id = $1 AND school_id = $2`,
    [request.admission_lead_id, request.school_id, to, notes],
  );
  await db.query(
    `INSERT INTO admission_lead_events (school_id, lead_id, type, from_status, to_status, notes, actor_type, actor_id)
     VALUES ($1, $2, 'status_changed', $3, $4, $5, $6, $7)`,
    [request.school_id, request.admission_lead_id, rows[0].status, to, notes, actor.type, actor.id],
  );
}

/** Matrícula de aluno novo rejeitada: o atendimento de captação é encerrado com o motivo. */
export async function afterRejection(db: Db, request: RequestRow, actor: Actor, notes: string) {
  if (request.admission_lead_id) await finishLead(db, request, 'lost', actor, notes);
}

/** Mensagem de lembrete para quem ainda não respondeu. */
export function reminderLink(guardianPhone: string | null, guardianName: string | null, studentName: string, schoolName: string) {
  const firstName = guardianName?.split(' ')[0] ?? '';
  return whatsAppLink(
    guardianPhone,
    `Olá, ${firstName}! Lembrete da ${schoolName}: a renovação de matrícula de ${studentName} ainda está pendente. ` +
      `Use o link que enviamos para confirmar os dados pelo celular. Qualquer dúvida, é só responder esta mensagem.`,
  );
}

type Comparable = Record<string, unknown>;

/** Lista campo a campo o que o responsável alterou, para a Secretaria conferir só o que mudou. */
export function changedFields(current: { student: Comparable; guardian: Comparable | null }, proposed: ProposedData) {
  const changes: { section: 'student' | 'guardian'; field: string; before: unknown; after: unknown }[] = [];
  const normalize = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'object') return JSON.stringify(value);
    const entries = Object.entries(value as Comparable)
      .filter(([, inner]) => normalize(inner) !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? JSON.stringify(entries) : null;
  };

  for (const section of ['student', 'guardian'] as const) {
    const before = current[section] ?? {};
    for (const [field, after] of Object.entries(proposed[section])) {
      if (normalize(before[field]) !== normalize(after)) {
        changes.push({ section, field, before: before[field] ?? null, after: after ?? null });
      }
    }
  }

  return changes;
}
