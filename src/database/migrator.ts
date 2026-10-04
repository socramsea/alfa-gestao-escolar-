import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Número arbitrário que identifica a trava de migrations no PostgreSQL.
const MIGRATION_LOCK_ID = 727_001;

/**
 * Aplica as migrations pendentes, cada uma em sua própria transação.
 * A trava consultiva impede que duas instâncias migrem o banco ao mesmo tempo.
 */
export async function runMigrations(pool: pg.Pool, log: (message: string) => void = () => {}) {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
    const applied = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (row) => row.version,
      ),
    );

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`Migration aplicada: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falha ao aplicar ${file}`, { cause: error });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
