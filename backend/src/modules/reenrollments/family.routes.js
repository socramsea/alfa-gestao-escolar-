import { Router } from 'express';
import { notYet } from './service.js';

// Família, sem conta: entra pelo link pessoal com a data de nascimento, vê a prévia e confirma (ADR-009).
const router = Router();
router.post('/access', notYet);
router.post('/submissions', notYet);
export default router;
