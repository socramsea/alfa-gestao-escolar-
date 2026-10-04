import pg from 'pg';
import './env.js';

/** Recria o schema do banco de testes e aplica todas as migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error(`Recusando limpar um banco que não parece de testes: ${url}`);
  }

  const pool = new pg.Pool({ connectionString: url });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const { runMigrations } = await import('../src/database/migrator.js');
  await runMigrations(pool);
  await pool.end();
}
