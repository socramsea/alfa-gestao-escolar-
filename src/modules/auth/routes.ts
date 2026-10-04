import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { requireStaff } from '../../middlewares/auth.js';
import { unauthorized } from '../../shared/errors.js';
import { parse } from '../../shared/validate.js';
import { permissionsForRole, type StaffRole } from '../access/permissions.js';
import { recordAudit } from '../audit/service.js';
import { verifyPassword } from './passwords.js';
import { signStaffToken } from './tokens.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos.' },
});

const loginSchema = z.object({
  school: z.string().trim().toLowerCase().min(1).max(60),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', loginLimiter, async (request, response) => {
  const input = parse(loginSchema, request.body);

  const { rows } = await pool.query<{
    id: string;
    school_id: string;
    role: StaffRole;
    name: string;
    password_hash: string;
  }>(
    `SELECT u.id, u.school_id, u.role, u.name, u.password_hash
       FROM users u
       JOIN schools s ON s.id = u.school_id
      WHERE s.slug = $1
        AND lower(u.email) = $2
        AND u.active = true
        AND u.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND s.status <> 'suspended'`,
    [input.school, input.email],
  );

  const user = rows[0];
  if (!(await verifyPassword(input.password, user?.password_hash)) || !user) {
    throw unauthorized('E-mail ou senha inválidos');
  }

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await recordAudit(pool, {
    schoolId: user.school_id,
    actor: { type: 'user', id: user.id },
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    metadata: { ip: request.ip },
  });

  response.json({
    token: signStaffToken({ sub: user.id, school_id: user.school_id, role: user.role }),
  });
});

authRouter.get('/me', requireStaff, async (request, response) => {
  const user = request.user!;

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, s.id AS school_id, s.name AS school_name, s.slug AS school_slug
       FROM users u
       JOIN schools s ON s.id = u.school_id
      WHERE u.id = $1 AND u.school_id = $2`,
    [user.id, user.school_id],
  );
  const me = rows[0];

  response.json({
    id: me.id,
    name: me.name,
    email: me.email,
    role: me.role,
    school: { id: me.school_id, name: me.school_name, slug: me.school_slug },
    permissions: permissionsForRole(user.role),
  });
});
