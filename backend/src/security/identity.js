import { authPool } from '../config/db.js';

// A regra de escola reside exclusivamente em school_allows_access (migration 002).
export const identityColumns = `u.id, u.school_id, u.name, u.email, u.role, u.active`;
export const validIdentity = `u.active = true AND u.deleted_at IS NULL
  AND public.school_allows_access(s.status, s.deleted_at)`;

function singleIdentity(result) {
  return result.rows.length === 1 ? result.rows[0] : null;
}

export async function authenticateIdentity(email, password) {
  return singleIdentity(await authPool.query(
    'SELECT id, school_id, name, email, role, active FROM auth_private.authenticate($1::text, $2::text)',
    [email, password]));
}

// Chamada pelo middleware somente depois de verificar a assinatura/claims do JWT.
export async function resolveIdentity(userId) {
  return singleIdentity(await authPool.query(
    'SELECT id, school_id, name, email, role, active FROM auth_private.resolve_identity($1::uuid)',
    [userId]));
}

export function publicIdentity(user) {
  const { id, school_id, name, email, role, active } = user;
  return { id, school_id, name, email, role, active };
}
