import type { ErrorRequestHandler } from 'express';
import { AppError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

// Códigos do PostgreSQL que indicam dado inválido enviado pelo cliente.
const PG_CLIENT_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'Registro duplicado'],
  '23503': [400, 'Referência inválida'],
  '23514': [400, 'Valor não permitido'],
  '22P02': [400, 'Formato inválido'],
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (response.headersSent) return;

  if (error instanceof AppError) {
    response.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'JSON inválido' });
    return;
  }

  const pgError = typeof error?.code === 'string' ? PG_CLIENT_ERRORS[error.code] : undefined;
  if (pgError) {
    response.status(pgError[0]).json({ error: pgError[1] });
    return;
  }

  logger.error({ err: error, method: request.method, url: request.originalUrl }, 'Erro não tratado');
  response.status(500).json({ error: 'Erro interno do servidor' });
};
