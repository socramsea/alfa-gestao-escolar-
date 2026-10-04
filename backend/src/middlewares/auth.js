import { verifyToken } from '../security/token.js';
import { resolveIdentity } from '../security/identity.js';
import { withTenant } from '../security/tenant-context.js';

export async function authMiddleware(req, res, next) {
  let decoded;
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new Error('Token ausente');
    decoded = verifyToken(header.slice(7).trim());
  } catch { return res.status(401).json({ error: 'Token ausente, invalido ou expirado' }); }
  try {
    const user = await resolveIdentity(decoded.sub);
    if (!user || user.school_id !== decoded.school_id) {
      return res.status(401).json({ error: 'Identidade invalida ou acesso bloqueado' });
    }
    req.user = Object.freeze({ sub: user.id, school_id: user.school_id,
      role: user.role, name: user.name, email: user.email });
    req.withTenant = work => withTenant(req.user, work);
    return next();
  } catch (error) { return next(error); }
}
