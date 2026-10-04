import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { uuid } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';

export const auditRouter = Router();

const querySchema = z.object({
  entity_type: z.string().max(80).optional(),
  entity_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get('/', requirePermission('audit:read'), async (request, response) => {
  const query = parse(querySchema, request.query);

  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_type, a.actor_id,
            COALESCE(u.name, g.full_name) AS actor_name, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON a.actor_type = 'user' AND u.id = a.actor_id
       LEFT JOIN guardians g ON a.actor_type = 'guardian' AND g.id = a.actor_id
      WHERE a.school_id = $1
        AND ($2::text IS NULL OR a.entity_type = $2)
        AND ($3::uuid IS NULL OR a.entity_id = $3)
      ORDER BY a.created_at DESC
      LIMIT $4`,
    [request.user!.school_id, query.entity_type ?? null, query.entity_id ?? null, query.limit],
  );

  response.json({ data: rows });
});
