import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const currentFile = fileURLToPath(import.meta.url);
const migrationsDirectory = path.join(path.dirname(currentFile), 'migrations');

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [file],
      );

      if (applied.rowCount) continue;

      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      console.log(`Migration aplicada: ${file}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Falha nas migrations:', error);
  process.exitCode = 1;
});
