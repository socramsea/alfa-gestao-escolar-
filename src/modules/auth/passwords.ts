import bcrypt from 'bcryptjs';

const COST = 12;

// Hash usado quando o usuário não existe, para que a resposta leve o mesmo tempo
// e não revele quais e-mails estão cadastrados.
const DUMMY_HASH = bcrypt.hashSync('senha-inexistente', COST);

export const hashPassword = (password: string) => bcrypt.hash(password, COST);

export async function verifyPassword(password: string, hash: string | undefined) {
  const matches = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== undefined && matches;
}

export const passwordRule = (value: string) =>
  value.length >= 10 && /[A-Za-z]/.test(value) && /\d/.test(value);
