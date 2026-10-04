import type { Request } from 'express';
import type { Db } from '../../shared/db.js';

export type Actor = { type: 'user' | 'guardian' | 'system'; id: string | null };

export function actorFrom(request: Request): Actor {
  if (request.user) return { type: 'user', id: request.user.id };
  if (request.guardian) return { type: 'guardian', id: request.guardian.id };
  return { type: 'system', id: null };
}

type AuditEntry = {
  schoolId: string;
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(db: Db, entry: AuditEntry) {
  await db.query(
    `INSERT INTO audit_logs (school_id, user_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.schoolId,
      entry.actor.type === 'user' ? entry.actor.id : null,
      entry.actor.type,
      entry.actor.id,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.metadata ?? {},
    ],
  );
}

/** Retorna apenas os campos que mudaram, para registrar "antes" e "depois" na auditoria. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { before: before[key] ?? null, after: after[key] ?? null };
    }
  }

  return changes;
}
