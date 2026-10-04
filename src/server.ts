import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { logger } from './shared/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info(`API Alfa Gestão Escolar executando na porta ${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} recebido, encerrando...`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
