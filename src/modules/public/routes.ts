import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { withTransaction } from '../../shared/db.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { idParams, uuid } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { recordAudit } from '../audit/service.js';
import { bookVisit, createLead, leadInputSchema, schoolContactLink } from '../admissions/service.js';

/** Rotas abertas ao público: site da escola, imagens e pré-matrícula. */
export const publicRouter = Router();

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitos envios a partir desta conexão. Tente novamente mais tarde ou fale pelo WhatsApp.' },
});

async function loadPublishedSchool(slug: string) {
  const { rows } = await pool.query<{ id: string; name: string; phone: string | null; content: Record<string, unknown> }>(
    `SELECT s.id, s.name, s.phone, ss.content
       FROM schools s
       JOIN school_sites ss ON ss.school_id = s.id AND ss.published
      WHERE s.slug = $1 AND s.deleted_at IS NULL AND s.status <> 'suspended'`,
    [slug.toLowerCase()],
  );
  if (!rows[0]) throw notFound('Escola não encontrada');
  return rows[0];
}

const slugParams = z.object({ slug: z.string().max(60) });

publicRouter.get('/schools/:slug', async (request, response) => {
  const { slug } = parse(slugParams, request.params);
  const school = await loadPublishedSchool(slug);

  const [units, slots] = await Promise.all([
    pool.query(
      `SELECT id, name, slug, address, phone, whatsapp, opening_hours, accepting_enrollments
         FROM units WHERE school_id = $1 AND active ORDER BY created_at`,
      [school.id],
    ),
    // Horários de visita das próximas 5 semanas com vaga, a partir de 2 horas à frente.
    pool.query(
      `SELECT vs.id, vs.unit_id, vs.starts_at
         FROM visit_slots vs
        WHERE vs.school_id = $1 AND vs.cancelled_at IS NULL
          AND vs.starts_at > now() + interval '2 hours' AND vs.starts_at < now() + interval '35 days'
          AND vs.capacity > (SELECT count(*) FROM visits v WHERE v.slot_id = vs.id AND v.status = 'scheduled')
        ORDER BY vs.starts_at`,
      [school.id],
    ),
  ]);

  response.set('Cache-Control', 'public, max-age=60');
  response.json({ name: school.name, slug, content: school.content, units: units.rows, visit_slots: slots.rows });
});

publicRouter.get('/assets/:id', async (request, response) => {
  const { id } = parse(idParams, request.params);
  const { rows } = await pool.query<{ content_type: string; data: Buffer }>(
    `SELECT a.content_type, a.data FROM site_assets a
       JOIN school_sites ss ON ss.school_id = a.school_id AND ss.published
      WHERE a.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Imagem não encontrada');

  response.set({
    'Content-Type': rows[0].content_type,
    'Cache-Control': 'public, max-age=86400, immutable',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  response.send(rows[0].data);
});

const leadSchema = leadInputSchema.extend({
  slot_id: uuid.optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'É preciso autorizar o contato da escola' }) }),
  // Campo invisível no formulário: robôs costumam preenchê-lo.
  website: z.string().max(0).optional(),
});

publicRouter.post('/schools/:slug/leads', leadLimiter, async (request, response) => {
  const { slug } = parse(slugParams, request.params);
  const input = parse(leadSchema, request.body);
  const school = await loadPublishedSchool(slug);

  const unitCheck = await pool.query<{ accepting_enrollments: boolean; whatsapp: string | null; phone: string | null }>(
    'SELECT accepting_enrollments, whatsapp, phone FROM units WHERE id = $1 AND school_id = $2 AND active',
    [input.unit_id, school.id],
  );
  const unit = unitCheck.rows[0];
  if (!unit) throw notFound('Unidade não encontrada');
  if (!unit.accepting_enrollments) throw badRequest('Esta unidade não está recebendo novas matrículas no momento');

  const actor = { type: 'public' as const, id: null };
  const result = await withTransaction(async (client) => {
    const lead = await createLead(client, school.id, { ...input, source: 'site' }, actor);
    const visit = input.slot_id ? await bookVisit(client, school.id, lead.id, input.slot_id, actor) : null;

    await recordAudit(client, {
      schoolId: school.id,
      actor: { type: 'system', id: null },
      action: 'admission_lead.created_from_site',
      entityType: 'admission_lead',
      entityId: lead.id,
      metadata: { ip: request.ip, with_visit: Boolean(visit) },
    });
    return { lead, visit };
  });

  response.status(201).json({
    code: result.lead.code,
    visit_starts_at: result.visit?.starts_at ?? null,
    whatsapp_url: schoolContactLink(unit.whatsapp ?? unit.phone ?? school.phone, school.name, result.lead.code, input.student_name),
  });
});
