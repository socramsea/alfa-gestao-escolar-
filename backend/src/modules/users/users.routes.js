import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
const router = Router();
router.get('/', authMiddleware, requireRole('platform_admin', 'school_admin'), async (req, res, next) => {
  try {
    const users = await req.withTenant(async (client, currentUser) => {
      if (!['platform_admin', 'school_admin'].includes(currentUser.role)) {
        const error = new Error('Permissao insuficiente'); error.statusCode = 403; throw error;
      }
      const result = await client.query(`SELECT id, school_id, name, email, role, active, created_at
        FROM public.users WHERE school_id = $1 AND deleted_at IS NULL ORDER BY name ASC`, [req.user.school_id]);
      return result.rows;
    });
    return res.json({ users });
  } catch (error) { return next(error); }
});
export default router;
