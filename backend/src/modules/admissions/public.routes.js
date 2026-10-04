import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { fail, hash, publicLeadSchema } from './service.js';

// Rotas sem identidade: tudo passa pelas funções de site_public, nunca por consultas com tenant.
const router = Router();
const slugOf = req => {
  const slug = z.string().min(3).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).safeParse(req.params.slug);
  if (!slug.success) fail(404);
  return slug.data;
};

// Limite por endereço de origem para envios; o nginx aplica outro limite antes da API.
export function submissionLimiter({ max, windowMs = 10 * 60 * 1000, trustProxy = false, now = Date.now }) {
  const seen = new Map();
  return (req, _res, next) => {
    // X-Real-IP só vale quando a API está atrás do nginx do deploy, que sobrescreve o cabeçalho.
    const origin = String((trustProxy && req.headers['x-real-ip']) || req.socket?.remoteAddress || 'desconhecido');
    const t = now(), recent = (seen.get(origin) || []).filter(at => t - at < windowMs);
    if (recent.length >= max) { seen.set(origin, recent); return next(Object.assign(new Error('limite'), { statusCode: 429 })); }
    recent.push(t); seen.set(origin, recent);
    if (seen.size > 10000) for (const [k, v] of seen) if (v.every(at => t - at >= windowMs)) seen.delete(k);
    return next();
  };
}
const limitSubmissions = submissionLimiter({ max: Number(process.env.PUBLIC_LEADS_PER_WINDOW || 20),
  trustProxy: process.env.TRUST_PROXY_IP === '1' });

router.get('/sites/:slug', async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) fail(400);
    const { rows: [row] } = await pool.query('SELECT site_public.site($1) AS site', [slugOf(req)]);
    if (!row.site) fail(404);
    res.json(row.site);
  } catch (e) { next(e); }
});

router.get('/sites/:slug/images/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success || Object.keys(req.query).length) fail(404);
    const { rows: [image] } = await pool.query('SELECT content_type,data FROM site_public.image($1,$2)', [slugOf(req), id.data]);
    if (!image) fail(404);
    res.set({ 'Content-Type': image.content_type, 'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.send(image.data);
  } catch (e) { next(e); }
});

router.post('/sites/:slug/leads', limitSubmissions, async (req, res, next) => {
  try {
    const slug = slugOf(req);
    const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
    const parsed = publicLeadSchema.safeParse(req.body);
    if (!key.success || !parsed.success || Object.keys(req.query).length) fail(400);
    const { slot_id, consent: _consent, website: _website, ...lead } = parsed.data;
    const { rows: [row] } = await pool.query('SELECT site_public.submit_lead($1,$2,$3,$4,$5) AS result',
      [slug, key.data, hash({ lead, slot_id }), lead, slot_id]);
    const result = row.result;
    if (!result) fail(404);
    if (result.status === 'conflict' || result.status === 'slot_unavailable') {
      return res.status(409).json({ error: result.status === 'slot_unavailable'
        ? 'Horario indisponivel' : 'Registro duplicado ou requisicao conflitante', reason: result.status });
    }
    res.status(result.status === 'replayed' ? 200 : 201).json({ protocol: result.protocol, visit_starts_at: result.visit_starts_at });
  } catch (e) {
    if (e.code === '23514' || e.code === '22007' || e.code === '22008') e.statusCode = 400;
    next(e);
  }
});

export default router;
