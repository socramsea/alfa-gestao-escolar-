import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { stages } from './catalog.js';
import { resources, administrator, create, list, fail } from './service.js';
const router = Router();
router.use(authMiddleware, requireRole('school_admin','platform_admin'));
router.get('/catalog', async (req,res,next) => {
  try {
    const data = await req.withTenant(async (_c,user) => {
      administrator(user);
      return { stages, modules: [{ code: 'structure', name: 'Estrutura escolar', available: true },
        ...['Matrículas','Pedagógico','Financeiro','Portal da família'].map(name => ({ name, available: false }))] };
    });
    res.json(data);
  } catch(e) { next(e); }
});
for (const resource of Object.keys(resources)) {
  router.get(`/${resource}`, async (req,res,next) => {
    try {
      const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(req.query);
      if (!parsed.success) fail(400);
      res.json(await req.withTenant((c,u) => list(c,u,resource,parsed.data.page)));
    } catch(e) { next(e); }
  });
  router.post(`/${resource}`, async (req,res,next) => {
    try {
      const data = resources[resource].schema.safeParse(req.body);
      const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
      if (!data.success || !key.success || Object.keys(req.query).length) fail(400);
      const result = await req.withTenant((c,u) => create(c,u,resource,data.data,key.data));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch(e) {
      if (e.code === '23505') e.statusCode = 409;
      if (e.code === '23503') e.statusCode = 404;
      next(e);
    }
  });
}
export default router;
