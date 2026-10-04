import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { resources, list, create, fail } from './service.js';
import { importSchema, previewImport, commitImport } from './import.js';

const router = Router();
router.use(authMiddleware,requireRole('school_admin','platform_admin'));
// Importação de planilha: a prévia não grava nada; a importação grava tudo ou nada.
router.post('/imports/preview',async (req,res,next) => {
  try {
    const data = importSchema.safeParse(req.body);
    if (!data.success || Object.keys(req.query).length) fail(400);
    res.json(await previewImport(req.withTenant,data.data));
  } catch (e) { next(e); }
});
router.post('/imports',async (req,res,next) => {
  try {
    const data = importSchema.safeParse(req.body);
    const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
    if (!data.success || !key.success || Object.keys(req.query).length) fail(400);
    const result = await req.withTenant((c,u)=>commitImport(c,u,data.data,key.data));
    if (!result.ok) return res.status(400).json({ error:'Importação não realizada: corrija as linhas indicadas.', rows:result.rows, summary:result.summary });
    res.status(result.replayed ? 200 : 201).json({ rows:result.rows, summary:result.summary, replayed:result.replayed });
  } catch (e) {
    if (e.code === '23505') e.statusCode = 409;
    if (e.code === '23503') e.statusCode = 404;
    next(e);
  }
});
for (const resource of Object.keys(resources)) {
  router.get(`/${resource}`,async (req,res,next) => {
    try {
      const parsed = z.object({ page:z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(req.query);
      if (!parsed.success) fail(400);
      res.json(await req.withTenant((c,u)=>list(c,u,resource,parsed.data.page)));
    } catch (e) { next(e); }
  });
  router.post(`/${resource}`,async (req,res,next) => {
    try {
      const data = resources[resource].schema.safeParse(req.body);
      const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
      if (!data.success || !key.success || Object.keys(req.query).length) fail(400);
      const result = await req.withTenant((c,u)=>create(c,u,resource,data.data,key.data));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) {
      if (e.code === '23505') e.statusCode = 409;
      if (e.code === '23503') e.statusCode = 404;
      next(e);
    }
  });
}
export default router;
