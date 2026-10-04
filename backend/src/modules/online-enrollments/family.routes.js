import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { submissionLimiter } from '../admissions/public.routes.js';
import { fail, hash, hashToken, requirementsCheck, submissionSchema } from './service.js';

// Área da família: sem identidade de usuário; tudo passa pelas funções de family_public.
const router = Router();
const limit = submissionLimiter({ max: Number(process.env.FAMILY_REQUESTS_PER_WINDOW || 60),
  trustProxy: process.env.TRUST_PROXY_IP === '1' });
const access = z.object({ token: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

async function open(token, birthDate) {
  const { rows:[row] } = await pool.query('SELECT family_public.application($1,$2::date) AS result', [hashToken(token), birthDate]);
  return row.result;
}
function denied(result) {
  // Mesma resposta para link inexistente, expirado ou data errada; bloqueio é informado para orientar a família.
  if (result.status === 'blocked') return Object.assign(new Error('bloqueado'), { statusCode: 429 });
  return Object.assign(new Error('negado'), { statusCode: 401 });
}

router.post('/access', limit, async (req, res, next) => {
  try {
    const parsed = access.strict().safeParse(req.body);
    if (!parsed.success || Object.keys(req.query).length) fail(400);
    const result = await open(parsed.data.token, parsed.data.birth_date);
    if (result.status !== 'ok') throw denied(result);
    const { status: _status, ...body } = result;
    res.json(body);
  } catch (e) { if (e.code === '22008' || e.code === '22007') e.statusCode = 401; next(e); }
});

router.post('/submissions', limit, async (req, res, next) => {
  try {
    const parsed = access.extend({ settings_id: z.string().uuid().nullable(), data: z.unknown() }).strict().safeParse(req.body);
    const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
    if (!parsed.success || !key.success || Object.keys(req.query).length) fail(400);
    const opened = await open(parsed.data.token, parsed.data.birth_date);
    if (opened.status !== 'ok') throw denied(opened);
    const data = submissionSchema.safeParse(parsed.data.data);
    // Regras da escola vigentes: a função recusa se mudarem entre a leitura e o envio.
    if (!data.success || !requirementsCheck(data.data, opened.settings.required_fields)) fail(400);
    const { accept_terms: _accept, ...ficha } = data.data;
    const { rows:[row] } = await pool.query('SELECT family_public.submit($1,$2::date,$3,$4,$5,$6) AS result',
      [hashToken(parsed.data.token), parsed.data.birth_date, key.data, hash({ settings: parsed.data.settings_id, ficha }),
        parsed.data.settings_id, ficha]);
    const result = row.result;
    if (result.status === 'created' || result.status === 'replayed') return res.status(result.status === 'created' ? 201 : 200).json({ state: 'enviada' });
    if (['denied','blocked'].includes(result.status)) throw denied(result);
    return res.status(409).json({ error: 'Registro duplicado ou requisicao conflitante', reason: result.status });
  } catch (e) { if (e.code === '22008' || e.code === '22007') e.statusCode = 401; next(e); }
});

export default router;
