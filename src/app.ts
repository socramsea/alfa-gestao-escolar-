import express from 'express';
import { errorHandler } from './middlewares/error-handler.js';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.use((_request, response) => {
  response.status(404).json({ error: 'Rota não encontrada' });
});

app.use(errorHandler);
