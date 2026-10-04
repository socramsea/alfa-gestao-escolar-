import 'dotenv/config';
import { runner } from 'node-pg-migrate';
import { administrativeUrl, pool } from '../src/config/admin-db.js';
try {
  await runner({ databaseUrl: administrativeUrl(), dir: 'migrations', direction: 'up',
    migrationsTable: 'pgmigrations', count: Infinity });
} catch (error) {
  console.error('Migration falhou:', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
