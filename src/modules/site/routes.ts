import express, { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';
import { withTransaction } from '../../shared/db.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { idParams } from '../../shared/schemas.js';
import { parse } from '../../shared/validate.js';
import { actorFrom, recordAudit } from '../audit/service.js';
import { collectImageIds, siteContentSchema } from './content.js';

export const siteRouter = Router();

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Assinaturas dos formatos aceitos, para não confiar só no Content-Type enviado.
function sniffImageType(buffer: Buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

siteRouter.get('/', requirePermission('site:manage'), async (request, response) => {
  const schoolId = request.user!.school_id;
  const [site, assets, school] = await Promise.all([
    pool.query('SELECT published, content, updated_at FROM school_sites WHERE school_id = $1', [schoolId]),
    pool.query(
      'SELECT id, content_type, size_bytes, created_at FROM site_assets WHERE school_id = $1 ORDER BY created_at DESC',
      [schoolId],
    ),
    pool.query('SELECT slug FROM schools WHERE id = $1', [schoolId]),
  ]);

  response.json({
    slug: school.rows[0].slug,
    published: site.rows[0]?.published ?? false,
    content: site.rows[0]?.content ?? null,
    updated_at: site.rows[0]?.updated_at ?? null,
    assets: assets.rows,
  });
});

const saveSchema = z.object({ published: z.boolean(), content: siteContentSchema });

siteRouter.put('/', requirePermission('site:manage'), async (request, response) => {
  const input = parse(saveSchema, request.body);
  const schoolId = request.user!.school_id;
  const imageIds = collectImageIds(input.content);

  await withTransaction(async (client) => {
    if (imageIds.length) {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM site_assets WHERE school_id = $1 AND id = ANY($2::uuid[])',
        [schoolId, imageIds],
      );
      if (rows.length !== new Set(imageIds).size) throw badRequest('Imagem não encontrada');
    }

    await client.query(
      `INSERT INTO school_sites (school_id, published, content, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id) DO UPDATE
         SET published = EXCLUDED.published, content = EXCLUDED.content, updated_by = EXCLUDED.updated_by`,
      [schoolId, input.published, input.content, request.user!.id],
    );

    await recordAudit(client, {
      schoolId,
      actor: actorFrom(request),
      action: 'site.updated',
      entityType: 'school_site',
      entityId: schoolId,
      metadata: { published: input.published },
    });
  });

  response.json({ ok: true });
});

siteRouter.post(
  '/assets',
  requirePermission('site:manage'),
  express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
  async (request, response) => {
    const body = request.body;
    if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Envie uma imagem JPG, PNG ou WebP de até 2 MB');

    const type = sniffImageType(body);
    if (!type || type !== request.headers['content-type']) throw badRequest('Arquivo não é uma imagem válida');

    const schoolId = request.user!.school_id;
    const { rows } = await pool.query(
      `INSERT INTO site_assets (school_id, content_type, size_bytes, data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, content_type, size_bytes, created_at`,
      [schoolId, type, body.length, body, request.user!.id],
    );
    await recordAudit(pool, {
      schoolId,
      actor: actorFrom(request),
      action: 'site.asset_uploaded',
      entityType: 'site_asset',
      entityId: rows[0].id,
      metadata: { size: body.length },
    });

    response.status(201).json(rows[0]);
  },
);

siteRouter.delete('/assets/:id', requirePermission('site:manage'), async (request, response) => {
  const { id } = parse(idParams, request.params);
  const schoolId = request.user!.school_id;

  const site = await pool.query('SELECT content FROM school_sites WHERE school_id = $1', [schoolId]);
  if (site.rows[0] && JSON.stringify(site.rows[0].content).includes(id)) {
    throw badRequest('A imagem está em uso no site. Remova-a do conteúdo antes de excluir.');
  }

  const { rowCount } = await pool.query('DELETE FROM site_assets WHERE id = $1 AND school_id = $2', [id, schoolId]);
  if (!rowCount) throw notFound('Imagem não encontrada');
  response.status(204).end();
});
