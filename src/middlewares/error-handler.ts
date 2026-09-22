import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);

  if (response.headersSent) return;

  response.status(500).json({
    error: 'Erro interno do servidor',
  });
};
