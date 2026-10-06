import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { assessmentSchema, createAssessment, createType, gradebook, launchScores, listTypes, parse, reject,
  scoreHistory, scoresSchema, typeSchema } from './service.js';

const router = Router();
router.use(authMiddleware, requireRole('school_admin','platform_admin'));
const pageQuery = z.object({ page: z.coerce.number({ invalid_type_error: 'Página inválida.' }).int('Página inválida.')
  .min(1, 'Página inválida.').max(10000, 'Página inválida.').default(1) }).strict();
const groupQuery = z.object({ class_group_id: z.string({ required_error: 'Escolha a turma.', invalid_type_error: 'Escolha a turma.' })
  .uuid('Turma inválida.') }).strict();
const noQuery = req => { if (Object.keys(req.query).length) reject(400, 'Parâmetro não permitido nesta operação.'); };
const idempotencyKey = req => {
  const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
  if (!key.success) reject(400, 'Envie o cabeçalho Idempotency-Key com um UUID; ele evita gravar duas vezes no reenvio.');
  return key.data;
};
const assessmentId = req => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) reject(404, 'Avaliação não encontrada na sua escola.');
  return id.data;
};
// Erros de regra saem com a mensagem do serviço; violações do banco ganham mensagem própria.
function failure(e, res, next) {
  if (e.expose) return res.status(e.statusCode).json({ error: e.message, ...e.extra });
  if (e.code === '23505') {
    return res.status(409).json({ error: e.constraint === 'assessment_types_school_id_code_key'
      ? 'Já existe um tipo de avaliação com este código.'
      : 'Outra pessoa salvou estes dados ao mesmo tempo. Recarregue a página e confira antes de enviar de novo.' });
  }
  if (e.code === '23503') return res.status(404).json({ error: 'Registro relacionado não encontrado na sua escola.' });
  return next(e);
}
const handle = work => async (req, res, next) => {
  try { await work(req, res); } catch (e) { failure(e, res, next); }
};

router.get('/types', handle(async (req, res) => {
  const { page } = parse(pageQuery, req.query);
  res.json(await req.withTenant((c, u) => listTypes(c, u, page)));
}));
router.post('/types', handle(async (req, res) => {
  noQuery(req);
  const data = parse(typeSchema, req.body), key = idempotencyKey(req);
  const result = await req.withTenant((c, u) => createType(c, u, data, key));
  res.status(result.replayed ? 200 : 201).json(result);
}));
// Lista por turma: avaliações em ordem de data e, por aluno matriculado, as notas vigentes e a média.
router.get('/', handle(async (req, res) => {
  const { class_group_id: classGroupId } = parse(groupQuery, req.query);
  res.json(await req.withTenant((c, u) => gradebook(c, u, classGroupId)));
}));
router.post('/', handle(async (req, res) => {
  noQuery(req);
  const data = parse(assessmentSchema, req.body), key = idempotencyKey(req);
  const result = await req.withTenant((c, u) => createAssessment(c, u, data, key));
  res.status(result.replayed ? 200 : 201).json(result);
}));
router.get('/:id/scores', handle(async (req, res) => {
  noQuery(req);
  const id = assessmentId(req);
  res.json(await req.withTenant((c, u) => scoreHistory(c, u, id)));
}));
router.post('/:id/scores', handle(async (req, res) => {
  noQuery(req);
  const id = assessmentId(req), data = parse(scoresSchema, req.body), key = idempotencyKey(req);
  const result = await req.withTenant((c, u) => launchScores(c, u, id, data, key));
  res.status(result.replayed ? 200 : 201).json(result);
}));
export default router;
