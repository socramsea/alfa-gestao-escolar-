import type { RequestHandler } from 'express';
import { pool } from '../database/pool.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import { type Permission, type StaffRole, roleHasPermission } from '../modules/access/permissions.js';
import { extractBearer, verifyPortalToken, verifyStaffToken } from '../modules/auth/tokens.js';

/**
 * Autentica a equipe escolar. O token não basta: o usuário é recarregado do banco
 * para garantir que continua ativo, não excluído, com o perfil e a escola atuais.
 */
export const requireStaff: RequestHandler = async (request, _response, next) => {
  const payload = verifyStaffToken(extractBearer(request.headers.authorization));

  const { rows } = await pool.query<{ id: string; school_id: string; role: StaffRole; name: string }>(
    `SELECT u.id, u.school_id, u.role, u.name
       FROM users u
       JOIN schools s ON s.id = u.school_id
      WHERE u.id = $1
        AND u.school_id = $2
        AND u.active = true
        AND u.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND s.status <> 'suspended'`,
    [payload.sub, payload.school_id],
  );

  if (!rows[0]) throw unauthorized();

  request.user = rows[0];
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) throw unauthorized();
    if (!roleHasPermission(request.user.role, permission)) throw forbidden();
    next();
  };
}

/** Autentica o responsável no portal, a partir da sessão criada pelo link de acesso. */
export const requireGuardian: RequestHandler = async (request, _response, next) => {
  const payload = verifyPortalToken(extractBearer(request.headers.authorization));

  const { rows } = await pool.query<{ id: string; school_id: string; name: string }>(
    `SELECT g.id, g.school_id, g.full_name AS name
       FROM guardians g
       JOIN schools s ON s.id = g.school_id
      WHERE g.id = $1
        AND g.school_id = $2
        AND g.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND s.status <> 'suspended'`,
    [payload.sub, payload.school_id],
  );

  if (!rows[0]) throw unauthorized();

  request.guardian = rows[0];
  next();
};
