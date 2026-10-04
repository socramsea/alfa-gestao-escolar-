import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { requirePermission } from '../../middlewares/auth.js';

export const schoolsRouter = Router();

// Não existe listagem de escolas para a equipe: o escopo é sempre a escola do token.
schoolsRouter.get('/current', requirePermission('school:read'), async (request, response) => {
  const { rows } = await pool.query(
    `SELECT id, name, legal_name, slug, email, phone, status, created_at
       FROM schools
      WHERE id = $1 AND deleted_at IS NULL`,
    [request.user!.school_id],
  );

  response.json(rows[0]);
});
