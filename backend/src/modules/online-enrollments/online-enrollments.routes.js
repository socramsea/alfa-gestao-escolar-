import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { applicationDetail, applicationStates, create, currentSettings, fail, listApplications, resources } from './service.js';

const router = Router();
router.use(authMiddleware, requireRole('school_admin','platform_admin'));

router.get('/settings', async (req, res, next) => {
  try { if (Object.keys(req.query).length) fail(400); res.json(await req.withTenant((c,u) => currentSettings(c,u))); }
  catch (e) { next(e); }
});
router.get('/applications', async (req, res, next) => {
  try {
    const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1),
      state: z.enum(applicationStates).optional() }).strict().safeParse(req.query);
    if (!parsed.success) fail(400);
    res.json(await req.withTenant((c,u) => listApplications(c,u,parsed.data.page,parsed.data.state ?? null)));
  } catch (e) { next(e); }
});
router.get('/applications/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success || Object.keys(req.query).length) fail(400);
    res.json(await req.withTenant((c,u) => applicationDetail(c,u,id.data)));
  } catch (e) { next(e); }
});
for (const operation of Object.keys(resources)) {
  router.post(`/${operation}`, async (req, res, next) => {
    try {
      const data = resources[operation].safeParse(req.body);
      const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
      if (!data.success || !key.success || Object.keys(req.query).length) fail(400);
      const result = await req.withTenant((c,u) => create(c,u,operation,data.data,key.data));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) {
      if (e.code === '23505') e.statusCode = 409;
      if (e.code === '23503') e.statusCode = 404;
      next(e);
    }
  });
}
export default router;
