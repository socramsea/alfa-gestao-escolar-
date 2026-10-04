import 'dotenv/config';
import pg from 'pg';
import { pool } from '../src/config/admin-db.js';
// Credenciais recebidas apenas pelo ambiente, nunca por argumentos ou SQL em logs.
try {
  for (const [role, variable] of [['alfa_app', 'DATABASE_URL'], ['alfa_auth', 'AUTH_DATABASE_URL']]) {
    const url = new URL(process.env[variable]);
    if (decodeURIComponent(url.username) !== role || decodeURIComponent(url.password).length < 24) {
      throw new Error(`${variable} exige role ${role} e senha de pelo menos 24 caracteres`);
    }
    await pool.query(`ALTER ROLE ${pg.escapeIdentifier(role)} PASSWORD ${pg.escapeLiteral(decodeURIComponent(url.password))}`);
  }
  console.log('Senhas das roles configuradas sem exibicao.');
} catch {
  console.error('Provisionamento falhou; verifique conexao administrativa e variaveis de runtime.');
  process.exitCode = 1;
} finally { await pool.end(); }
