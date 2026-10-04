import { z } from 'zod';
import { authenticateIdentity, publicIdentity } from '../../security/identity.js';
import { issueToken } from '../../security/token.js';

const loginInput = z.object({ email: z.string().trim().email().max(150).refine(v => !v.includes('\u0000')).transform(v => v.toLowerCase()),
  password: z.string().min(1).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72 && !v.includes('\u0000')) }).strict();

export async function login(req, res, next) {
  try {
    const parsed = loginInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Dados de login invalidos' });
    const user = await authenticateIdentity(parsed.data.email, parsed.data.password);
    if (!user) return res.status(401).json({ error: 'Credenciais invalidas' });
    return res.json({ token: issueToken(user), user: publicIdentity(user) });
  } catch (error) { return next(error); }
}

export async function me(req, res, next) {
  try {
    // withTenant revalida id + school_id + active + deleted_at + escola na mesma transacao.
    const user = await req.withTenant(async (_client, currentUser) => publicIdentity(currentUser));
    return res.json({ user });
  } catch (error) { return next(error); }
}
