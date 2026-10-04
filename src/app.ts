import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { requireStaff } from './middlewares/auth.js';
import { errorHandler } from './middlewares/error-handler.js';
import { academicRouter } from './modules/academic/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { guardiansRouter } from './modules/guardians/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { campaignsRouter, renewalRequestsRouter } from './modules/renewals/routes.js';
import { schoolsRouter } from './modules/schools/routes.js';
import { studentsRouter } from './modules/students/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { logger } from './shared/logger.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) }));
app.use(express.json({ limit: '1mb' }));
if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));

app.get('/health', async (_request, response) => {
  await pool.query('SELECT 1');
  response.status(200).json({ status: 'ok' });
});

const api = Router();

// Rotas públicas ou com autenticação própria.
api.use('/auth', authRouter);
api.use('/portal', portalRouter);

// Rotas da equipe escolar: exigem token válido e usuário ativo no banco.
const staff = Router();
staff.use(requireStaff);
staff.use('/schools', schoolsRouter);
staff.use('/users', usersRouter);
staff.use('/', academicRouter);
staff.use('/students', studentsRouter);
staff.use('/guardians', guardiansRouter);
staff.use('/renewal-campaigns', campaignsRouter);
staff.use('/renewal-requests', renewalRequestsRouter);
staff.use('/dashboard', dashboardRouter);
staff.use('/audit-logs', auditRouter);
api.use(staff);

app.use('/api', api);

app.use((_request, response) => {
  response.status(404).json({ error: 'Rota não encontrada' });
});

app.use(errorHandler);
