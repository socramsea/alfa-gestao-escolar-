import 'dotenv/config';
import pg from 'pg';

export function administrativeUrl() {
  const value = process.env.ADMIN_DATABASE_URL;
  if (!value) throw new Error('ADMIN_DATABASE_URL obrigatoria');
  const url = new URL(value);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (!url.port || url.port === '5432')) {
    throw new Error('Administracao bloqueada na porta local 5432');
  }
  return value;
}
export const pool = new pg.Pool({ connectionString: administrativeUrl(), max: 2 });
