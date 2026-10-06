import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRole } from '../../middlewares/require-role.js';
import { notYet } from './service.js';

// Secretaria: abre a campanha, inclui os alunos, gera o link, pede documentos e analisa as confirmações.
const router = Router();
router.use(authMiddleware, requireRole('school_admin','platform_admin'));
router.get('/campaigns', notYet);
router.post('/campaigns', notYet);
router.get('/', notYet);
router.post('/', notYet);
router.post('/links', notYet);
router.post('/document-requests', notYet);
router.post('/reviews', notYet);
router.get('/:id', notYet);
export default router;
