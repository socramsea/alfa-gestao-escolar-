import { z } from 'zod';
import { pool } from '../config/db.js';
import { identityColumns, validIdentity } from './identity.js';

export class AccessDenied extends Error {
  constructor() { super('Identidade invalida ou acesso bloqueado'); this.statusCode = 401; }
}

// Chamado somente com identidade reconstruida pelo middleware, nunca com req.body/query/params.
export async function withTenant(identity, work, selectedPool = pool) {
  const schoolId = z.string().uuid().parse(identity.school_id);
  const userId = z.string().uuid().parse(identity.sub);
  const client = await selectedPool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_school_id', $1, true)", [schoolId]);
    const { rows: [user] } = await client.query(`SELECT ${identityColumns}
      FROM public.users u JOIN public.schools s ON s.id = u.school_id
      WHERE u.id = $1 AND u.school_id = $2 AND ${validIdentity}`, [userId, schoolId]);
    if (!user) throw new AccessDenied();
    const value = await work(client, user);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally {
    // Defesa adicional contra contexto de sessao introduzido acidentalmente pelo callback.
    if (!destroy) {
      try { await client.query('RESET app.current_school_id'); } catch { destroy = true; }
    }
    client.release(destroy);
  }
}
