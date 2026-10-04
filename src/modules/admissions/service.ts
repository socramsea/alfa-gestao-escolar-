import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../shared/db.js';
import { conflict, notFound } from '../../shared/errors.js';
import { isoDate, phone } from '../../shared/schemas.js';
import { whatsAppLink } from '../../shared/whatsapp.js';
import { recordAudit } from '../audit/service.js';

export const LEAD_STATUSES = ['new', 'contacted', 'visit_scheduled', 'visited', 'enrolling', 'enrolled', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Novo contato',
  contacted: 'Em conversa',
  visit_scheduled: 'Visita agendada',
  visited: 'Visitou',
  enrolling: 'Matrícula em andamento',
  enrolled: 'Matriculado',
  lost: 'Não seguiu',
};

export const LEAD_SOURCES = ['site', 'whatsapp', 'referral', 'instagram', 'walk_in', 'other'] as const;

type EventActor = { type: 'user' | 'guardian' | 'system' | 'public'; id: string | null };

export async function recordLeadEvent(
  db: Db,
  schoolId: string,
  leadId: string,
  event: { type: string; from?: string | null; to?: string | null; notes?: string | null; actor: EventActor },
) {
  await db.query(
    `INSERT INTO admission_lead_events (school_id, lead_id, type, from_status, to_status, notes, actor_type, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [schoolId, leadId, event.type, event.from ?? null, event.to ?? null, event.notes ?? null, event.actor.type, event.actor.id],
  );
}

// Sem 0/O e 1/I, para o protocolo ser ditado por telefone sem confusão.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newLeadCode = () =>
  `PM-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;

export const leadInputSchema = z.object({
  unit_id: z.string().uuid('Escolha a unidade'),
  guardian_name: z.string().trim().min(3, 'Informe seu nome').max(160),
  guardian_phone: phone,
  guardian_email: z.string().trim().toLowerCase().email('E-mail inválido').optional().or(z.literal('').transform(() => undefined)),
  student_name: z.string().trim().min(2, 'Informe o nome da criança').max(160),
  student_birth_date: isoDate.optional(),
  desired_grade: z.string().trim().max(60).optional(),
  desired_year: z.number().int().min(2000).max(2100).optional(),
  interest: z.enum(['visit', 'enroll', 'info']).default('visit'),
  how_heard: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000).optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export async function createLead(
  db: Db,
  schoolId: string,
  input: LeadInput & { source: (typeof LEAD_SOURCES)[number] },
  actor: EventActor,
) {
  const unit = await db.query('SELECT 1 FROM units WHERE id = $1 AND school_id = $2 AND active', [input.unit_id, schoolId]);
  if (!unit.rowCount) throw notFound('Unidade não encontrada');

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newLeadCode();
    const { rows } = await db.query<{ id: string; code: string }>(
      `INSERT INTO admission_leads (
         school_id, unit_id, code, guardian_name, guardian_phone, guardian_email, student_name, student_birth_date,
         desired_grade, desired_year, interest, source, how_heard, message, consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
       ON CONFLICT (school_id, code) DO NOTHING
       RETURNING id, code`,
      [
        schoolId,
        input.unit_id,
        code,
        input.guardian_name,
        input.guardian_phone,
        input.guardian_email ?? null,
        input.student_name,
        input.student_birth_date ?? null,
        input.desired_grade ?? null,
        input.desired_year ?? null,
        input.interest,
        input.source,
        input.how_heard ?? null,
        input.message ?? null,
      ],
    );
    if (!rows[0]) continue;

    await recordLeadEvent(db, schoolId, rows[0].id, { type: 'created', to: 'new', actor });
    return rows[0];
  }

  throw new Error('Não foi possível gerar o protocolo');
}

/** Reserva um horário de visita respeitando a capacidade, sob trava para evitar reservas duplas. */
export async function bookVisit(db: Db, schoolId: string, leadId: string, slotId: string, actor: EventActor) {
  const { rows: leads } = await db.query<{ unit_id: string; status: LeadStatus }>(
    'SELECT unit_id, status FROM admission_leads WHERE id = $1 AND school_id = $2 FOR UPDATE',
    [leadId, schoolId],
  );
  const lead = leads[0];
  if (!lead) throw notFound('Interessado não encontrado');
  if (lead.status === 'enrolled' || lead.status === 'lost') throw conflict('Este atendimento já foi encerrado');

  const { rows: slots } = await db.query<{ starts_at: Date; capacity: number; unit_id: string }>(
    `SELECT starts_at, capacity, unit_id FROM visit_slots
      WHERE id = $1 AND school_id = $2 AND cancelled_at IS NULL AND starts_at > now()
        FOR UPDATE`,
    [slotId, schoolId],
  );
  const slot = slots[0];
  if (!slot || slot.unit_id !== lead.unit_id) throw notFound('Horário indisponível');

  const taken = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM visits WHERE slot_id = $1 AND status = 'scheduled'`,
    [slotId],
  );
  if (taken.rows[0].count >= slot.capacity) throw conflict('Este horário acabou de ser preenchido. Escolha outro.');

  // Uma visita ativa por interessado: remarcar cancela a anterior.
  await db.query(`UPDATE visits SET status = 'cancelled' WHERE lead_id = $1 AND status = 'scheduled'`, [leadId]);
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO visits (school_id, slot_id, lead_id) VALUES ($1, $2, $3) RETURNING id',
    [schoolId, slotId, leadId],
  );

  const advance = ['new', 'contacted', 'visited'].includes(lead.status);
  if (advance) {
    await db.query(`UPDATE admission_leads SET status = 'visit_scheduled' WHERE id = $1`, [leadId]);
  }
  await recordLeadEvent(db, schoolId, leadId, {
    type: 'visit_scheduled',
    from: lead.status,
    to: advance ? 'visit_scheduled' : lead.status,
    notes: slot.starts_at.toISOString(),
    actor,
  });

  return { id: rows[0].id, starts_at: slot.starts_at };
}

export async function changeLeadStatus(
  db: Db,
  schoolId: string,
  leadId: string,
  to: LeadStatus,
  actor: EventActor & { type: 'user' | 'system' },
  notes: string | null = null,
) {
  const { rows } = await db.query<{ status: LeadStatus }>(
    'SELECT status FROM admission_leads WHERE id = $1 AND school_id = $2 FOR UPDATE',
    [leadId, schoolId],
  );
  if (!rows[0]) throw notFound('Interessado não encontrado');
  if (rows[0].status === to) return;

  await db.query(
    `UPDATE admission_leads SET status = $3::varchar, lost_reason = CASE WHEN $3::varchar = 'lost' THEN $4::varchar ELSE lost_reason END
      WHERE id = $1 AND school_id = $2`,
    [leadId, schoolId, to, notes],
  );
  await recordLeadEvent(db, schoolId, leadId, { type: 'status_changed', from: rows[0].status, to, notes, actor });
  await recordAudit(db, {
    schoolId,
    actor: { type: actor.type, id: actor.id },
    action: 'admission_lead.status_changed',
    entityType: 'admission_lead',
    entityId: leadId,
    metadata: { from: rows[0].status, to },
  });
}

export function schoolContactLink(phoneNumber: string | null, schoolName: string, code: string, studentName: string) {
  return whatsAppLink(
    phoneNumber,
    `Olá! Fiz o contato pelo site da ${schoolName} (protocolo ${code}) sobre a matrícula de ${studentName}.`,
  );
}

export function guardianContactLink(phoneNumber: string, guardianName: string, schoolName: string, studentName: string) {
  return whatsAppLink(
    phoneNumber,
    `Olá, ${guardianName.split(' ')[0]}! Aqui é da ${schoolName}. Recebemos seu interesse na matrícula de ${studentName} e ` +
      `queremos ajudar. Qual o melhor horário para conversarmos?`,
  );
}
