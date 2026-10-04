import app from './app.js';
import { testDatabaseConnection, pool, authPool } from './config/db.js';
const port = Number(process.env.PORT || 4000);
try {
  await testDatabaseConnection();
  const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`API iniciada na porta ${server.address().port}`);
  });
  server.on('error', async () => {
    console.error('API nao iniciou: verifique disponibilidade da porta configurada.');
    await Promise.all([pool.end(), authPool.end()]);
    process.exitCode = 1;
  });
  const stop = () => server.close(async () => {
    await Promise.all([pool.end(), authPool.end()]);
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch {
  console.error('Inicializacao recusada: verifique conexoes restritas e migrations.');
  await Promise.all([pool.end(), authPool.end()]);
  process.exitCode = 1;
}
