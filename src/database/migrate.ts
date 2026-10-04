import { runMigrations } from './migrator.js';
import { pool } from './pool.js';

runMigrations(pool, (message) => console.log(message))
  .then(() => console.log('Banco atualizado.'))
  .catch((error) => {
    console.error('Falha nas migrations:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
