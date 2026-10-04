import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { create, fail, imageTypes, leadDetail, leadStatuses, listLeads, listSlots, resources, siteImage, siteState,
  sniffImage } from './service.js';

const router = Router();
router.use(authMiddleware, requireRole('school_admin','platform_admin'));

const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
const keyOf = req => {
  const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
  if (!key.success || Object.keys(req.query).length) fail(400);
  return key.data;
};
const dbStatus = e => {
  if (e.code === '23505') e.statusCode = 409;
  if (e.code === '23503') e.statusCode = 404;
  return e;
};

router.get('/site', async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) fail(400);
    res.json(await req.withTenant((c,u) => siteState(c,u)));
  } catch (e) { next(e); }
});

// Prévia das fotos para a equipe, inclusive antes de publicar.
router.get('/site/images/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success || Object.keys(req.query).length) fail(400);
    const image = await req.withTenant((c,u) => siteImage(c,u,id.data));
    res.set({ 'Content-Type': image.content_type, 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'" });
    res.send(image.data);
  } catch (e) { next(e); }
});

router.post('/site/images', express.raw({ type: imageTypes, limit: '2mb' }), async (req, res, next) => {
  try {
    const key = keyOf(req);
    const type = req.headers['content-type'];
    if (!Buffer.isBuffer(req.body) || !req.body.length || sniffImage(req.body) !== type) fail(400);
    const data = { content_type: type, bytes: req.body, sha256: createHash('sha256').update(req.body).digest('hex') };
    const result = await req.withTenant((c,u) => create(c,u,'site-images',data,key));
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (e) { next(dbStatus(e)); }
});

router.get('/leads', async (req, res, next) => {
  try {
    const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1),
      status: z.enum(leadStatuses).optional() }).strict().safeParse(req.query);
    if (!parsed.success) fail(400);
    res.json(await req.withTenant((c,u) => listLeads(c,u,parsed.data.page,parsed.data.status ?? null)));
  } catch (e) { next(e); }
});

router.get('/leads/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success || Object.keys(req.query).length) fail(400);
    res.json(await req.withTenant((c,u) => leadDetail(c,u,id.data)));
  } catch (e) { next(e); }
});

router.get('/visit-slots', async (req, res, next) => {
  try {
    const parsed = pageQuery.safeParse(req.query);
    if (!parsed.success) fail(400);
    res.json(await req.withTenant((c,u) => listSlots(c,u,parsed.data.page)));
  } catch (e) { next(e); }
});

const paths = { 'site-address': 'site/address', 'site-versions': 'site/versions', leads: 'leads',
  'lead-updates': 'lead-updates', 'visit-slots': 'visit-slots', 'visit-slot-closures': 'visit-slot-closures',
  'visit-bookings': 'visit-bookings', 'visit-outcomes': 'visit-outcomes' };
for (const [operation, path] of Object.entries(paths)) {
  router.post(`/${path}`, async (req, res, next) => {
    try {
      const data = resources[operation].safeParse(req.body);
      const key = keyOf(req);
      if (!data.success) fail(400);
      const result = await req.withTenant((c,u) => create(c,u,operation,data.data,key));
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) { next(dbStatus(e)); }
  });
}

export default router;
